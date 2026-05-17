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

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Initialize the agent and wire it to the chat UI.
 * Called once at extension startup.
 */
export function initAgent(setOnSendCallback) {
  setOnSendCallback(handleUserMessage);
  console.log('[CCS] Agent initialized.');
}

/**
 * Handle a user message — runs the full agent loop.
 * This is the callback registered with ui/chat.js.
 * @param {string} text - User's message text
 * @param {object} callbacks - { appendAssistantMessage, renderDraft, setTyping }
 */
export async function handleUserMessage(text, callbacks) {
  const { appendAssistantMessage, renderDraft, setTyping } = callbacks;
  
  const session = getSession();
  if (!session) {
    appendAssistantMessage('No session active. Please open the studio with a character selected.');
    return;
  }

  setTyping(true, 'Thinking...');

  try {
    await runCancellableGeneration({
      name: 'agent-response',
      run: async (signal) => {
        await _agentLoop(text, session, signal, { appendAssistantMessage, renderDraft, setTyping });
      },
    });
  } catch (err) {
    if (err.name === 'AbortError' || err.message?.includes('abort') || err.message?.includes('cancel')) {
      appendAssistantMessage('*Generation cancelled.*');
    } else {
      console.error('[CCS] Agent error:', err);
      appendAssistantMessage(`Something went wrong: ${err.message}\n\nPlease try again.`);
    }
  } finally {
    setTyping(false);
  }
}

// ─── Agent Loop ─────────────────────────────────────────────────────────────

async function _agentLoop(userText, session, signal, callbacks) {
  const { appendAssistantMessage, renderDraft, setTyping } = callbacks;

  // Build system prompt
  const systemPrompt = buildSystemPrompt(session);

  // Assemble message history for the LLM
  const messages = _buildMessageArray(systemPrompt, session);
  
  // Add the current user message
  messages.push({ role: 'user', content: userText });

  let lastReasoning = '';
  let finalResponseText = '';

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

    // Update typing label with iteration info
    if (iteration > 0) {
      setTyping(true, `Working... (step ${iteration + 1})`);
    }

    // Call the LLM
    const response = await _callLLM(messages, signal);
    
    // Extract reasoning if present
    if (response.reasoning) {
      lastReasoning = response.reasoning;
    }

    const responseText = response.text || '';

    // Handle empty response
    if (!responseText.trim()) {
      if (iteration < MAX_ITERATIONS - 1) {
        // Nudge the AI to produce content
        messages.push({
          role: 'user',
          content: '[System: Your last response was empty. Please provide your response now.]'
        });
        continue;
      }
      // Last iteration — give up gracefully
      finalResponseText = lastReasoning 
        ? 'I processed your request but had trouble formulating a response. Could you rephrase?'
        : 'I wasn\'t able to generate a response. Please try again.';
      break;
    }

    // Parse for tool calls
    const { toolCalls, prose } = parseToolCalls(responseText);

    if (toolCalls.length === 0) {
      // No tool calls — this is the final prose response
      finalResponseText = responseText;
      break;
    }

    // Execute tool calls
    // Add the AI's response (with tool calls) to the message history
    messages.push({ role: 'assistant', content: responseText });

    for (const call of toolCalls) {
      const { result, draft } = await executeToolCall(call);

      // Add tool result as a system message in the conversation
      messages.push({
        role: 'user', 
        content: `[Tool Result for ${call.name}]:\n${result}`
      });

      // If this produced a draft, notify the UI
      if (draft) {
        renderDraft(draft);
      }
    }

    // Add a reminder about tool usage for next iteration
    if (iteration < MAX_ITERATIONS - 2) {
      messages.push({
        role: 'user',
        content: TOOL_REMINDER
      });
    }

    // If there was prose alongside the tool calls, save it
    if (prose.trim()) {
      finalResponseText = prose;
    }
  }

  // Clean final response
  const cleanResponse = stripToolCallBlocks(finalResponseText).trim();

  if (cleanResponse) {
    // Build meta for the message
    const meta = {};
    if (lastReasoning) meta.reasoning = lastReasoning;

    // addMessage expects a full message object, not (role, content, meta)
    const assistantMsg = {
      role: 'assistant',
      content: cleanResponse,
      timestamp: Date.now(),
      meta,
    };
    await addMessage(assistantMsg);
    appendAssistantMessage(cleanResponse, meta);
  }
}

// ─── Message Assembly ───────────────────────────────────────────────────────

function _buildMessageArray(systemPrompt, session) {
  const messages = [{ role: 'system', content: systemPrompt }];

  // Add recent history (skip the current message, which we'll add separately)
  const history = getSession()?.messages || [];
  const recent = history.slice(-MAX_HISTORY_MESSAGES);

  for (const msg of recent) {
    const role = msg.role === 'user' ? 'user' : 'assistant';
    messages.push({ role, content: msg.content });
  }

  return messages;
}

// ─── LLM Generation ────────────────────────────────────────────────────────

/**
 * Call the LLM via silent-generation.js (which handles abort, retries, job tracking).
 * Extracts <think> reasoning blocks from the response.
 * @param {Array} messages - Chat message array
 * @param {AbortSignal} signal - Abort signal from the cancellable generation
 * @returns {Promise<{ text: string, reasoning: string }>}
 */
async function _callLLM(messages, signal) {
  // Use generateText from silent-generation.js — it handles abort, job tracking,
  // and calls ctx.generateRaw({ prompt: messages }) internally.
  let text = await generateText(messages, {
    name: 'ccs-agent',
    signal,
  });

  let reasoning = '';

  // Extract reasoning from <think> tags if present (thinking models)
  const thinkMatch = text.match(/<think>([\s\S]*?)<\/think>/);
  if (thinkMatch) {
    reasoning = thinkMatch[1].trim();
    text = text.replace(/<think>[\s\S]*?<\/think>/, '').trim();
  }

  return { text, reasoning };
}
