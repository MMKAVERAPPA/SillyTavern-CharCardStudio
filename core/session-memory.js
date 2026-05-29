/**
 * CharCardStudio v4.0.0 — core/session-memory.js
 * Session memory system: global rules + per-character rules.
 *
 * Global rules persist across all sessions (stored in localforage under 'memory_global').
 * Per-character rules persist per character (stored under 'memory_{avatar}').
 * Session rules are transient and stored only in the active session.
 *
 * Memory is injected into the system prompt as Layer 5.
 */

import { getSession, loadMemory, saveMemory, generateId } from './session.js';

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Add a memory rule.
 * @param {'global_rule'|'session_rule'|'learning'} type
 * @param {string} content - The rule text
 * @param {'user'|'ai'} source - Who added this
 * @returns {Promise<{success: boolean, id: string}>}
 */
export async function addMemoryRule(type, content, source = 'user') {
  const session = getSession();
  if (!session) return { success: false, id: '' };

  const entry = {
    id: generateId('mem'),
    content,
    addedAt: Date.now(),
    source,
  };

  if (type === 'global_rule') {
    const memory = await loadMemory(); // global
    memory.globalRules = memory.globalRules || [];
    memory.globalRules.push(entry);
    await saveMemory(memory); // saves to 'memory_global'
    console.log('[CCS] Global memory rule added:', content.substring(0, 50));
  } else if (type === 'session_rule') {
    const memory = await loadMemory(session.characterAvatar); // per-character
    memory.sessionRules = memory.sessionRules || [];
    memory.sessionRules.push(entry);
    await saveMemory(memory, session.characterAvatar);
    console.log('[CCS] Per-character memory rule added:', content.substring(0, 50));
  } else if (type === 'learning') {
    const memory = await loadMemory(session.characterAvatar);
    memory.learnings = memory.learnings || [];
    memory.learnings.push(entry);
    await saveMemory(memory, session.characterAvatar);
    console.log('[CCS] Learning added:', content.substring(0, 50));
  }

  return { success: true, id: entry.id };
}

/**
 * Remove a memory rule by content match or ID.
 * @param {'global_rule'|'session_rule'|'learning'} type
 * @param {string} contentOrId - The content text or ID to match
 * @returns {Promise<boolean>}
 */
export async function removeMemoryRule(type, contentOrId) {
  const session = getSession();
  if (!session) return false;

  const isGlobal = type === 'global_rule';
  const avatar = isGlobal ? undefined : session.characterAvatar;
  const memory = await loadMemory(avatar);

  const listKey = type === 'global_rule' ? 'globalRules'
    : type === 'session_rule' ? 'sessionRules'
    : 'learnings';

  const list = memory[listKey] || [];
  const idx = list.findIndex(e =>
    e.id === contentOrId || e.content.toLowerCase().includes(contentOrId.toLowerCase())
  );

  if (idx === -1) return false;

  const removed = list.splice(idx, 1)[0];
  memory[listKey] = list;
  await saveMemory(memory, avatar);
  console.log(`[CCS] Memory rule removed (${type}):`, removed.content.substring(0, 50));
  return true;
}

/**
 * Build the Layer 5 memory block for system prompt injection.
 * Combines global rules + per-character rules + learnings.
 * @param {object} session - Current session
 * @returns {Promise<string>} Memory block text (empty string if no rules)
 */
export async function buildMemoryBlock(session) {
  if (!session) return '';

  const globalMemory = await loadMemory(); // global
  const charMemory = await loadMemory(session.characterAvatar); // per-character

  const parts = [];

  // Global rules
  const globalRules = globalMemory.globalRules || [];
  if (globalRules.length > 0) {
    parts.push('GLOBAL RULES (apply to all characters):');
    globalRules.forEach((r, i) => parts.push(`  ${i + 1}. ${r.content}`));
  }

  // Per-character rules
  const sessionRules = charMemory.sessionRules || [];
  if (sessionRules.length > 0) {
    parts.push('CHARACTER-SPECIFIC RULES:');
    sessionRules.forEach((r, i) => parts.push(`  ${i + 1}. ${r.content}`));
  }

  // Learnings
  const learnings = charMemory.learnings || [];
  if (learnings.length > 0) {
    parts.push('OBSERVATIONS:');
    learnings.forEach((r, i) => parts.push(`  ${i + 1}. ${r.content}`));
  }

  if (parts.length === 0) return '';

  return '\n━━━ SESSION MEMORY ━━━\n' + parts.join('\n') + '\n';
}

/**
 * Get all memory entries for display in the UI.
 * @param {object} session - Current session
 * @returns {Promise<{global: object[], character: object[], learnings: object[]}>}
 */
export async function getAllMemory(session) {
  if (!session) return { global: [], character: [], learnings: [] };

  const globalMemory = await loadMemory();
  const charMemory = await loadMemory(session.characterAvatar);

  return {
    global: globalMemory.globalRules || [],
    character: charMemory.sessionRules || [],
    learnings: charMemory.learnings || [],
  };
}
