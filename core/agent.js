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

const MAX_ITERATIONS = 8;
const MAX_HISTORY_MESSAGES = 30;
const TOOL_RESULT_TRIM_THRESHOLD = 200;

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Initialize the agent and wire it to the chat UI.
 * Called once at extension startup.
 */
export function initAgent(setOnSendCallback) {
  setOnSendCallback(handleUserMessage);
  console.log('[CCS] Agent initialized — onSend callback registered.');
}

/**
 * Handle a user message — runs the full agent loop.
 * This is the callback registered with ui/chat.js.
 * @param {string} text - User's message text
 * @param {object} callbacks - { appendAssistantMessage, renderDraft, setTyping }
 */
export async function handleUserMessage(text, callbacks) {
  const { appendAssistantMessage, renderDraft, setTyping } = callbacks;
  
  console.log('[CCS] handleUserMessage called:', text.substring(0, 80));
  console.log('[CCS] Callbacks received:', {
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

  try {
    await runCancellableGeneration({
      name: 'agent-response',
      run: async (signal) => {
        await _agentLoop(text, session, signal, callbacks);
      },
    });
  } catch (err) {
    if (err.name === 'AbortError' || err.message?.includes('abort') || err.message?.includes('cancel')) {
      console.log('[CCS] Generation cancelled by user.');
      appendAssistantMessage('*Generation cancelled.*');
    } else {
      console.error('[CCS] Agent error:', err);
      appendAssistantMessage(`Something went wrong: ${err.message}\n\nPlease try again.`);
    }
  } finally {
    setTyping(false);
    console.log('[CCS] Agent turn complete.');
  }
}

// ─── Agent Loop ─────────────────────────────────────────────────────────────

async function _agentLoop(userText, session, signal, callbacks) {
  const { appendAssistantMessage, renderDraft, setTyping } = callbacks;

  // Build system prompt
  const systemPrompt = buildSystemPrompt(session);
  console.log('[CCS] System prompt built:', systemPrompt.length, 'chars');

  // Assemble message history for the LLM
  // Note: The user message is already in session.messages (added by chat.js before calling us)
  const messages = _buildMessageArray(systemPrompt, session);
  console.log('[CCS] Message array built:', messages.length, 'messages');

  let lastReasoning = '';
  let finalResponseText = '';

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

    console.log(`[CCS] === Iteration ${iteration + 1}/${MAX_ITERATIONS} ===`);

    // Update typing label with iteration info
    if (iteration > 0) {
      setTyping(true, `Working... (step ${iteration + 1})`);
    }

    // Trim old tool results before sending to LLM to reduce token bloat
    const trimmedMessages = _trimToolHistory(messages);

    // Call the LLM
    const response = await _callLLM(trimmedMessages, signal);

    // Check abort after LLM returns
    if (signal.aborted) {
      console.log(`[CCS] Generation aborted by user after LLM call at iteration ${iteration + 1}`);
      break;
    }
    console.log('[CCS] LLM response received:', {
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
    console.log('[CCS] Parse result:', {
      toolCallCount: toolCalls.length,
      tools: toolCalls.map(t => t.name),
      proseLength: prose.length,
    });

    if (toolCalls.length === 0) {
      // No tool calls — this is the final prose response
      console.log('[CCS] No tool calls — final prose response.');
      finalResponseText = responseText;
      break;
    }

    // Execute tool calls
    messages.push({ role: 'assistant', content: responseText });

    const toolResultParts = [];
    for (const call of toolCalls) {
      console.log(`[CCS] Executing tool: ${call.name}`, JSON.stringify(call.parameters).substring(0, 200));
      const { result, draft } = await executeToolCall(call);
      console.log(`[CCS] Tool ${call.name} result:`, result.substring(0, 150));

      toolResultParts.push(`[Tool Result for ${call.name}]:\n${result}`);

      // Check abort after each tool execution
      if (signal.aborted) {
        console.log(`[CCS] Generation aborted by user during tool execution at iteration ${iteration + 1}`);
        break;
      }

      // If this produced a draft, notify the UI
      if (draft) {
        console.log(`[CCS] 🎯 Draft produced! id=${draft.id} field=${draft.field} tokens=${draft.tokenCount}`);
        try {
          renderDraft(draft);
          console.log('[CCS] renderDraft callback called successfully.');
        } catch (renderErr) {
          console.error('[CCS] renderDraft FAILED:', renderErr);
        }
      } else {
        console.log(`[CCS] Tool ${call.name} returned no draft.`);
      }
    }

    // If we were aborted mid-tool-execution, break out
    if (signal.aborted) break;

    // Add combined tool results as a single user message
    let toolResultMessage = toolResultParts.join('\n\n');
    if (iteration < MAX_ITERATIONS - 2) {
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
  console.log('[CCS] Final response:', cleanResponse.length, 'chars, reasoning:', !!lastReasoning);

  if (cleanResponse) {
    const meta = {};
    if (lastReasoning) meta.reasoning = lastReasoning;

    const assistantMsg = {
      role: 'assistant',
      content: cleanResponse,
      timestamp: Date.now(),
      meta,
    };
    addMessage(assistantMsg);
    console.log('[CCS] Message added to session:', assistantMsg.id || '(auto-id)');
    
    appendAssistantMessage(cleanResponse, meta);
    console.log('[CCS] appendAssistantMessage callback called.');
  } else {
    console.warn('[CCS] No final response to display (cleanResponse empty).');
  }
}

// ─── Message Assembly ───────────────────────────────────────────────────────

function _buildMessageArray(systemPrompt, session) {
  const messages = [{ role: 'system', content: systemPrompt }];

  const history = getSession()?.messages || [];
  const recent = history.slice(-MAX_HISTORY_MESSAGES);

  for (const msg of recent) {
    const role = msg.role === 'user' ? 'user' : 'assistant';
    messages.push({ role, content: msg.content });
  }

  return messages;
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
 * Tool results are identified by content starting with '[Tool Result for'.
 * This works on a COPY — the original messages array is not mutated.
 */
function _trimToolHistory(messages) {
  // Find all tool result indices
  const toolResultIndices = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'user' && messages[i].content?.startsWith('[Tool Result for')) {
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
    console.log(`[CCS] Trimmed tool history: ${messages.length} messages, removed ~${totalCharsRemoved} chars from ${toolResultIndices.length - 1} old tool result(s)`);
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
  console.log('[CCS] Calling LLM with', messages.length, 'messages');
  
  let text = await generateText(messages, {
    name: 'ccs-agent',
    signal,
  });

  let reasoning = '';

  // Extract reasoning from <think> tags if present
  const thinkMatch = text.match(/<think>([\s\S]*?)<\/think>/);
  if (thinkMatch) {
    reasoning = thinkMatch[1].trim();
    text = text.replace(/<think>[\s\S]*?<\/think>/, '').trim();
    console.log('[CCS] Extracted <think> reasoning:', reasoning.length, 'chars');
  }

  return { text, reasoning };
}
