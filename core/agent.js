/**
 * CharCardStudio v4.0.0 — Agent Core
 * 
 * The agent loop: builds prompts, calls the LLM, parses tool calls,
 * executes tools, and returns the final response to the chat UI.
 * 
 * Flow: user message → system prompt + history → generateRaw → parse tools →
 *       execute tools → re-prompt (max 8 iterations) → final prose response
 */

import { getSession, addMessage, updateSession } from './session.js';
import { runCancellableGeneration, generateText } from './silent-generation.js';
import { parseToolCalls, stripToolCallBlocks } from './tools-fallback.js';
import { executeToolCall } from './tools.js';
import { buildSystemPrompt, TOOL_REMINDER } from '../prompts/phase-instructions.js';
import { getMainProfileId } from './api-router.js';
import { generateChat } from './silent-generation.js';

const DEBUG = false;
const log = (...args) => DEBUG && console.log(...args);

const MAX_ITERATIONS = 8;
const MAX_HISTORY_MESSAGES = 30;
const TOOL_RESULT_TRIM_THRESHOLD = 200;
const KEEP_RECENT = 15;          // messages kept when summarizing history
const SUMMARIZE_CHAR_THRESHOLD = 40000; // ~10,500 tokens — triggers summarization

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Initialize the agent and wire it to the chat UI.
 * Called once at extension startup.
 */
export function initAgent(setOnSendCallback) {
  setOnSendCallback(handleUserMessage);
  log('[CCS] Agent initialized — onSend callback registered.');
}

/**
 * Handle a user message — runs the full agent loop.
 * This is the callback registered with ui/chat.js.
 * @param {string} text - User's message text
 * @param {object} callbacks - { appendAssistantMessage, renderDraft, setTyping, setToolStatus, clearToolStatus }
 */
export async function handleUserMessage(text, callbacks) {
  const { appendAssistantMessage, renderDraft, setTyping, setToolStatus, clearToolStatus } = callbacks;
  
  log('[CCS] handleUserMessage called:', text.substring(0, 80));
  log('[CCS] Callbacks received:', {
    hasAppendMsg: typeof appendAssistantMessage === 'function',
    hasRenderDraft: typeof renderDraft === 'function',
    hasSetTyping: typeof setTyping === 'function',
  });

  const session = getSession();
  if (!session) {
    console.warn('[CCS] No active session');
    appendAssistantMessage('No session active. Please open the studio with a character selected.');
    return;
  }

  setTyping(true, 'Thinking...');

  // Store last user message so toolSwitchPhase can check for explicit confirmation
  try { await updateSession({ lastUserMessage: text }); } catch (_) {}

  try {
    await runCancellableGeneration({
      name: 'agent-response',
      run: async (signal) => {
        await _agentLoop(text, session, signal, callbacks);
      },
    });
  } catch (err) {
    if (err.name === 'AbortError' || err.message?.includes('abort') || err.message?.includes('cancel')) {
      log('[CCS] Generation cancelled by user.');
      appendAssistantMessage('*Generation cancelled.*');
    } else {
      console.error('[CCS] Agent error:', err);
      appendAssistantMessage(`Something went wrong: ${err.message}\n\nPlease try again.`);
    }
  } finally {
    setTyping(false);
    log('[CCS] Agent turn complete.');
  }
}

// ─── Agent Loop ─────────────────────────────────────────────────────────────

async function _agentLoop(userText, session, signal, callbacks) {
  const { appendAssistantMessage, renderDraft, setTyping, setToolStatus, clearToolStatus } = callbacks;

  // Build the full system prompt once (stable prefix + dynamic suffix).
  // On subsequent tool-call iterations we rebuild ONLY the dynamic suffix
  // (session context, brief, lorebook, memory) to maximise prompt cache hits.
  const systemPrompt = await buildSystemPrompt(session);
  log('[CCS] System prompt built:', systemPrompt.length, 'chars');

  // Escape {{...}} macros so ST's substituteParams() doesn't replace them
  // before the LLM sees the prompt. ST regex: /\{\{(\w+)\}\}/g — the BOM
  // prefix (\uFEFF) causes it to not match, but the AI sees plain {{char}}.
  const escapedPrompt = systemPrompt.replace(/\{\{/g, '\uFEFF{{');

  // Cache the stable prefix length so we can splice a fresh dynamic suffix later.
  // We detect it via the ━━━ SESSION CONTEXT ━━━ separator.
  const dynSepMarker = '\n\n━━━ SESSION CONTEXT ━━━';
  const prefixEnd = escapedPrompt.indexOf(dynSepMarker);
  const stablePrefix = prefixEnd >= 0 ? escapedPrompt.slice(0, prefixEnd) : escapedPrompt;

  // Assemble message history for the LLM
  const messages = _buildMessageArray(escapedPrompt, session);
  log('[CCS] Message array built:', messages.length, 'messages');

  let lastReasoning = '';
  let finalResponseText = '';
  let toolIterationCount = 0; // track how many tool-call rounds we've done
  const recentCallSigs = []; // GAP 8: stuck-loop detection — last N call signatures
  const toolsUsedThisTurn = []; // GAP 7: tool metadata for session message

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

    log(`[CCS] === Iteration ${iteration + 1}/${MAX_ITERATIONS} ===`);

    // On iterations 2+: refresh only the dynamic suffix of the system prompt.
    // The stable prefix (identity, field knowledge, phase, tools) is unchanged.
    if (iteration > 0) {
      setTyping(true, `Working... (step ${iteration + 1})`);
      try {
        const freshDynamic = await buildSystemPrompt(session, { dynamicOnly: true });
        // freshDynamic starts with "\n━━━ SESSION CONTEXT ━━━...".
        // Add an extra \n so the reconstructed prompt matches the original
        // stablePrefix + '\n' + '\n━━━ SESSION CONTEXT...' = two newlines = blank line separator.
        messages[0] = { role: 'system', content: stablePrefix + '\n' + freshDynamic };
        log('[CCS] Refreshed dynamic suffix, total prompt:', messages[0].content.length, 'chars');
      } catch (err) {
        console.warn('[CCS] Failed to refresh dynamic suffix:', err.message);
      }
    }

    // Trim old tool results before sending to LLM to reduce token bloat
    const trimmedMessages = [..._trimToolHistory(messages)];

    // Inject TOOL_REMINDER at the end of the context on iteration 0. 
    // Models with long contexts often forget XML formatting if instructions are only at the top.
    if (iteration === 0 && trimmedMessages.length > 0) {
      const lastIdx = trimmedMessages.length - 1;
      const lastMsg = trimmedMessages[lastIdx];
      if (lastMsg.role === 'user') {
        trimmedMessages[lastIdx] = { ...lastMsg, content: lastMsg.content + '\n\n' + TOOL_REMINDER };
      } else {
        trimmedMessages.push({ role: 'user', content: TOOL_REMINDER });
      }
    }

    // GAP 3: Estimate context size from char count (generateRaw doesn't return token counts).
    // Trigger early background summarization if context is getting large.
    const contextCharCount = trimmedMessages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
    log(`[CCS] Context estimate: ~${Math.round(contextCharCount / 3.8)} tokens (${contextCharCount} chars)`);
    if (iteration === 0 && contextCharCount > 50000) {
      const history = getSession()?.messages || [];
      log('[CCS] Large context detected — triggering background summarization');
      _autoSummarize(history, KEEP_RECENT).catch(() => {});
    }

    // Call the LLM
    const response = await _callLLM(trimmedMessages, signal);

    // Check abort after LLM returns
    if (signal.aborted) {
      log(`[CCS] Generation aborted by user after LLM call at iteration ${iteration + 1}`);
      break;
    }
    log('[CCS] LLM response received:', {
      textLength: response.text?.length || 0,
      hasReasoning: !!response.reasoning,
      textPreview: (response.text || '').substring(0, 120),
    });
    
    // Extract reasoning if present
    if (response.reasoning) {
      lastReasoning = response.reasoning;
    }

    const responseText = response.text || '';

    // Handle empty response
    if (!responseText.trim()) {
      console.warn('[CCS] Empty response from LLM');
      
      // If we already have prose accumulated from a previous iteration (e.g. before a tool call),
      // an empty response simply means the AI is done. Break safely.
      if (finalResponseText.trim()) {
        log('[CCS] Empty response received, but we have accumulated prose. Stopping iteration safely.');
        break;
      }

      if (iteration < MAX_ITERATIONS - 1) {
        messages.push({
          role: 'user',
          content: '[System: Your last response was empty. Please provide your response now.]'
        });
        continue;
      }
      finalResponseText = lastReasoning 
        ? 'I processed your request but had trouble formulating a response. Could you rephrase?'
        : 'I wasn\'t able to generate a response. Please try again.';
      break;
    }

    // Parse for tool calls
    const { toolCalls, prose } = parseToolCalls(responseText);
    log('[CCS] Parse result:', {
      toolCallCount: toolCalls.length,
      tools: toolCalls.map(t => t.name),
      proseLength: prose.length,
    });

    if (toolCalls.length === 0) {
      // No tool calls — this is the final prose response
      log('[CCS] No tool calls — final prose response.');
      finalResponseText = responseText;
      break;
    }

    // Execute tool calls
    messages.push({ role: 'assistant', content: responseText });

    const toolResultParts = [];
    for (const call of toolCalls) {
      log(`[CCS] Executing tool: ${call.name}`, JSON.stringify(call.parameters).substring(0, 200));

      // GAP 8: Stuck-loop detection — break if the exact same call has been made 3+ times
      const sig = `${call.name}:${JSON.stringify(call.parameters)}`;
      const sigCount = recentCallSigs.filter(s => s === sig).length;
      if (sigCount >= 2) {
        log(`[CCS] Stuck-loop detected: ${call.name} called identically ${sigCount + 1} times — breaking`);
        toolResultParts.push(
          `[System: Tool "${call.name}" was called with identical parameters ${sigCount + 1} times in a row. ` +
          `Stopping this repeated call. Please proceed with your response using the information already obtained.`
        );
        continue;
      }
      recentCallSigs.push(sig);
      if (recentCallSigs.length > 12) recentCallSigs.shift(); // keep bounded

      // Show tool activity in context bar
      if (setToolStatus) setToolStatus(call.name);
      setTyping(true, `Running ${call.name}...`);

      let result = '';
      let draft = null;
      try {
        const res = await executeToolCall(call);
        result = res.result;
        draft = res.draft;
      } catch (err) {
        console.error(`[CCS] Tool execution error for ${call.name}:`, err);
        result = `Error executing tool ${call.name}: ${err.message}`;
      }
      log(`[CCS] Tool ${call.name} result:`, result.substring(0, 150));

      // Dispatch tool log event for UI
      try {
        document.dispatchEvent(new CustomEvent('ccs:tool-log', {
          detail: {
            name: call.name,
            params: call.parameters,
            timestamp: Date.now()
          }
        }));
      } catch (e) { /* ignore */ }

      // GAP 7: Track tool names used this turn for session metadata
      toolsUsedThisTurn.push(call.name);

      // Clear tool badge after execution
      if (clearToolStatus) clearToolStatus();

      toolResultParts.push(`[Tool: ${call.name}]\n${result}`);

      // Check abort after each tool execution
      if (signal.aborted) {
        log(`[CCS] Generation aborted by user during tool execution at iteration ${iteration + 1}`);
        break;
      }

      // If this produced a draft, notify the UI
      if (draft) {
        log(`[CCS] 🎯 Draft produced! id=${draft.id} field=${draft.field} tokens=${draft.tokenCount}`);
        try {
          renderDraft(draft);
          log('[CCS] renderDraft callback called successfully.');
        } catch (renderErr) {
          console.error('[CCS] renderDraft FAILED:', renderErr);
        }
      } else {
        log(`[CCS] Tool ${call.name} returned no draft.`);
      }
    }

    // If we were aborted mid-tool-execution, break out
    if (signal.aborted) break;

    toolIterationCount++;

    // GAP 2: Structured tool result block — clear delimiter prevents model from
    // misinterpreting tool results as user messages in the conversation history.
    // Only inject TOOL_REMINDER on the first tool iteration.
    let toolResultMessage = `━━━ TOOL RESULTS ━━━\n${toolResultParts.join('\n\n')}\n━━━ END RESULTS ━━━`;
    if (toolIterationCount === 1) {
      toolResultMessage += '\n\n' + TOOL_REMINDER;
    }
    messages.push({ role: 'user', content: toolResultMessage });

    // If there was prose alongside the tool calls, save it
    if (prose.trim()) {
      finalResponseText = prose;
    }
  }

  // Clean final response
  const cleanResponse = stripToolCallBlocks(finalResponseText).trim();
  log('[CCS] Final response:', cleanResponse.length, 'chars, reasoning:', !!lastReasoning);

  if (cleanResponse) {
    const meta = {};
    if (lastReasoning) meta.reasoning = lastReasoning;
    // GAP 7: Store which tools were used this turn — non-intrusive metadata for session history
    if (toolsUsedThisTurn.length > 0) {
      meta.toolsUsed = [...new Set(toolsUsedThisTurn)]; // deduplicated
      meta.toolRounds = toolIterationCount;
    }

    const assistantMsg = {
      role: 'assistant',
      content: cleanResponse,
      timestamp: Date.now(),
      meta,
    };
    addMessage(assistantMsg);
    log('[CCS] Message added to session:', assistantMsg.id || '(auto-id)');
    
    appendAssistantMessage(cleanResponse, meta);
    log('[CCS] appendAssistantMessage callback called.');
  } else {
    console.warn('[CCS] No final response to display (cleanResponse empty).');
  }
}

// ─── Message Assembly ───────────────────────────────────────────────────────

function _buildMessageArray(systemPrompt, session) {
  const messages = [{ role: 'system', content: systemPrompt }];

  const history = getSession()?.messages || [];

  // GAP 9: Use character-count (not message-count) to decide when to summarise.
  // message-count is a crude proxy — a 15-msg session with full ccs_read_field
  // results can dwarf a 30-msg session of short replies.
  // ~40,000 chars ≈ 10,500 tokens (chars / 3.8).
  const totalHistoryChars = history.reduce((sum, m) => sum + (m.content?.length || 0), 0);
  const shouldSummarize = totalHistoryChars > SUMMARIZE_CHAR_THRESHOLD;

  if (shouldSummarize && session?.autoSummary) {
    // Inject stored summary as context
    messages.push({
      role: 'user',
      content: `[Previous conversation summary: ${session.autoSummary}]`,
    });
    // Only include recent messages
    const recent = history.slice(-KEEP_RECENT);
    for (const msg of recent) {
      const role = msg.role === 'user' ? 'user' : 'assistant';
      messages.push({ role, content: msg.content });
    }
  } else {
    // Normal: include all history up to MAX_HISTORY_MESSAGES
    const recent = history.slice(-MAX_HISTORY_MESSAGES);
    for (const msg of recent) {
      const role = msg.role === 'user' ? 'user' : 'assistant';
      messages.push({ role, content: msg.content });
    }
  }

  // Trigger background summarization when:
  // (a) history is large enough, AND
  // (b) no summary exists yet, OR >= 8,000 new chars since last summary
  const charsSinceLastSummary = totalHistoryChars - (session?.autoSummaryCharCount || 0);
  if (shouldSummarize && (!session?.autoSummary || charsSinceLastSummary >= 8000)) {
    _autoSummarize(history, KEEP_RECENT).catch(err =>
      console.warn('[CCS] Auto-summarize failed:', err.message)
    );
  }

  return messages;
}

/**
 * Auto-summarize old messages and store in session.autoSummary.
 * Runs in background (does not block the agent loop).
 */
async function _autoSummarize(history, keepRecent) {
  const session = getSession();
  if (!session) return;

  const oldMessages = history.slice(0, -keepRecent);
  let contentToSummarize = '';
  const lastSummary = session.autoSummary || '';

  if (lastSummary) {
    // Incremental: summarize previous summary + new unseen messages
    contentToSummarize += `Previous Summary: ${lastSummary}\n\n`;
    const lastCharCount = session.autoSummaryCharCount || 0;
    // Approximate: find messages whose cumulative chars exceed the last saved count
    let cumChars = 0;
    const newMessages = [];
    for (const m of history.slice(0, -keepRecent)) {
      cumChars += (m.content?.length || 0);
      if (cumChars > lastCharCount) newMessages.push(m);
    }
    const condensedNew = newMessages
      .filter(m => m.role === 'user' || m.role === 'ai' || m.role === 'assistant')
      .map(m => `${m.role === 'user' ? 'User' : 'AI'}: ${m.content.substring(0, 200)}`)
      .join('\n');
    if (!condensedNew.trim()) return; // No new messages to summarize
    contentToSummarize += `New Messages to incorporate:\n${condensedNew}`;
  } else {
    contentToSummarize = oldMessages
      .filter(m => m.role === 'user' || m.role === 'ai' || m.role === 'assistant')
      .map(m => `${m.role === 'user' ? 'User' : 'AI'}: ${m.content.substring(0, 200)}`)
      .join('\n');
  }

  if (!contentToSummarize.trim()) return;

  try {
    const summary = await generateText(
      [
        { role: 'system', content: 'Summarize the conversation history concisely in 2-4 sentences. Focus on key decisions, character details, and context. If a previous summary is provided, integrate the new messages into it to produce a single, updated summary.' },
        { role: 'user', content: contentToSummarize.substring(0, 4000) },
      ],
      { name: 'ccs-auto-summarize' }
    );

    if (summary && summary.trim()) {
      // Save autoSummaryCharCount: total chars processed so far (history minus keepRecent)
      const processedChars = history.slice(0, -keepRecent).reduce((sum, m) => sum + (m.content?.length || 0), 0);
      await updateSession({
        autoSummary: summary.trim(),
        autoSummaryCharCount: processedChars,
      });
      log('[CCS] Incremental auto-summary saved:', summary.substring(0, 100));
    }
  } catch (err) {
    console.warn('[CCS] Auto-summarize error:', err.message);
  }
}

// ─── Tool History Trimming ──────────────────────────────────────────────────

/**
 * Trim old tool result messages to reduce token bloat.
 * 
 * Each tool iteration adds 2 messages (AI response + tool result). After 5
 * iterations, that's 10 extra messages, often including full card content
 * (3800+ chars per ccs_read_field). The LLM already consumed these — sending
 * them again wastes tokens.
 * 
 * Strategy:
 * - System message (index 0): always keep in full
 * - Real user messages: always keep in full
 * - Assistant messages: always keep in full (they contain the AI's reasoning)
 * - Tool result messages: truncate OLD ones to 200 chars; keep the LATEST in full
 * 
 * Tool results are identified by content starting with '━━━ TOOL RESULTS' (new format)
 * or '[Tool Result for' (old format — kept for backward compat with existing sessions).
 * This works on a COPY — the original messages array is not mutated.
 */
function _trimToolHistory(messages) {
  // Find all tool result indices — match both new structured format and legacy format
  const toolResultIndices = [];
  for (let i = 0; i < messages.length; i++) {
    const c = messages[i].content;
    if (messages[i].role === 'user' && (c?.startsWith('━━━ TOOL RESULTS') || c?.startsWith('[Tool Result for'))) {
      toolResultIndices.push(i);
    }
  }

  // Nothing to trim if there are 0 or 1 tool results
  if (toolResultIndices.length <= 1) return messages;

  // The last tool result index should be kept in full
  const lastToolResultIdx = toolResultIndices[toolResultIndices.length - 1];
  let totalCharsRemoved = 0;

  // Build a shallow copy with old tool results truncated
  const trimmed = messages.map((msg, idx) => {
    if (toolResultIndices.includes(idx) && idx !== lastToolResultIdx) {
      const original = msg.content;
      if (original.length > TOOL_RESULT_TRIM_THRESHOLD) {
        const truncated = original.substring(0, TOOL_RESULT_TRIM_THRESHOLD)
          + `\n[...truncated, ${original.length} chars total]`;
        totalCharsRemoved += original.length - truncated.length;
        return { ...msg, content: truncated };
      }
    }
    return msg;
  });

  if (totalCharsRemoved > 0) {
    log(`[CCS] Trimmed tool history: ${messages.length} messages, removed ~${totalCharsRemoved} chars from ${toolResultIndices.length - 1} old tool result(s)`);
  }

  return trimmed;
}

// ─── LLM Generation ────────────────────────────────────────────────────────

/**
 * Call the LLM via silent-generation.js.
 * 
 * NOTE on reasoning: Many "thinking" models (GLM-4.7, DeepSeek, o1) return
 * their reasoning in a separate `reasoning` field of the API response object,
 * NOT in <think> tags within the content. ST's `generateRaw` discards this
 * field and returns only the content string. To display reasoning from these
 * models, we would need `generateRawData` which returns the full response.
 * For now, we only extract <think> tags from content (works with models that
 * embed reasoning in the content field).
 */
async function _callLLM(messages, signal) {
  log('[CCS] Calling LLM with', messages.length, 'messages');

  const mainProfileId = getMainProfileId();
  let result;

  try {
    if (mainProfileId) {
      // Route through the user's chosen main connection profile
      log('[CCS] Using main API profile:', mainProfileId);
      result = await generateChat(messages, {
        name: 'ccs-agent',
        profileId: mainProfileId,
        signal,
        returnObject: true,
      });
    } else {
      // Default: ST's active connection via generateRaw
      result = await generateText(messages, {
        name: 'ccs-agent',
        signal,
        returnObject: true,
      });
    }
  } catch (err) {
    if (err && err.message && (err.message.includes('No message generated') || err.message.includes('No text returned'))) {
      log('[CCS] LLM returned empty response / No message generated. Returning gracefully.');
      return { text: '', reasoning: '' };
    }
    throw err;
  }

  let text = result.text || '';
  let reasoning = result.reasoning || '';

  // Fallback: Extract reasoning from <think> tags if present in the text
  const thinkMatch = text.match(/<think>([\s\S]*?)<\/think>/);
  if (thinkMatch) {
    reasoning = (reasoning ? reasoning + '\n' : '') + thinkMatch[1].trim();
    text = text.replace(/<think>[\s\S]*?<\/think>/, '').trim();
    log('[CCS] Extracted <think> reasoning:', thinkMatch[1].trim().length, 'chars');
  }

  return { text, reasoning };
}

