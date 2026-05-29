/**
 * CharCardStudio v4.0.0 — core/background.js
 * Background check queue: conflict detection + token budget analysis.
 *
 * Architecture (Section 10.3):
 * - Sequential queue — one check at a time
 * - 3-second debounce after field generation
 * - Cancellable via AbortController
 * - Cache by field content hash — don't re-check unchanged fields
 * - Results stored in session.conflicts[]
 */

import { getSession, updateSession, hashString } from './session.js';
import { generateTextWithProfile } from './api-router.js';
import { validateField } from './validators.js';

// ─── State ──────────────────────────────────────────────────────────────────

const _queue = [];
let _isProcessing = false;
let _abortController = null;

// Bug D fix: was a single shared _debounceTimer — any rapid sequence of
// enqueueCheck calls (e.g. conflict+token+validation after one draft apply)
// would cancel the previous timer, so only the last call ever fired.
// Per-key map gives each (type,field) pair its own independent debounce.
const _debounceTimers = new Map();

/** Cache: fieldContentHash → check result (avoid re-checking unchanged content) */
const _checkCache = new Map();
const CHECK_CACHE_MAX = 50;

const DEBOUNCE_MS = 3000;
const CHECK_TIMEOUT_MS = 20000; // Skip if takes > 20s

// ─── Prompt Templates ───────────────────────────────────────────────────────

const CONFLICT_CHECK_PROMPT = `You are a character card quality checker. Compare these two fields for semantic contradictions.
A contradiction exists ONLY if the fields express genuinely incompatible concepts.
"sarcastic, dry humor" and "sharp wit, ironic observations" are NOT contradictory — they're synonymous.
Style differences are NOT contradictions. Only flag genuine logical impossibilities.

Field A ([FIELD_A_NAME]): [FIELD_A_CONTENT]

Field B ([FIELD_B_NAME]): [FIELD_B_CONTENT]

Return ONLY valid JSON:
{"has_conflict": boolean, "description": "brief explanation", "severity": "low|medium|high"}`;

const TOKEN_CHECK_PROMPT = `Analyze this character card field for token efficiency.
Field: [FIELD_NAME]
Content: [CONTENT]
Token count: [COUNT]
Token tier: [TIER] (compact <600t, standard 600-1200t, rich 1200t+)

Return ONLY valid JSON:
{"within_budget": boolean, "recommendation": "brief suggestion if over budget"}`;

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Enqueue a background check with per-key debounce.
 * @param {'conflict'|'token'|'validation'} type
 * @param {string} fieldName - The field that was just written/applied
 */
export function enqueueCheck(type, fieldName) {
    // Bug D fix: use (type:fieldName) as the key so each distinct check type
    // gets its own timer and cannot be cancelled by a sibling check type.
    const key = `${type}:${fieldName}`;
    if (_debounceTimers.has(key)) clearTimeout(_debounceTimers.get(key));

    _debounceTimers.set(key, setTimeout(() => {
        _debounceTimers.delete(key);
        _addToQueue(type, fieldName);
    }, DEBOUNCE_MS));
}

/**
 * Cancel all pending and running background checks.
 */
export function cancelAllChecks() {
  _queue.length = 0;
  // Bug D: clear all per-key timers
  for (const timer of _debounceTimers.values()) clearTimeout(timer);
  _debounceTimers.clear();
  if (_abortController) {
    _abortController.abort();
    _abortController = null;
  }
  _isProcessing = false;
}

/**
 * Get the current queue status.
 * @returns {{ pending: number, processing: boolean }}
 */
export function getCheckStatus() {
  return {
    pending: _queue.length,
    processing: _isProcessing,
  };
}

// ─── Queue Processing ───────────────────────────────────────────────────────

function _addToQueue(type, fieldName) {
  // Avoid duplicate checks
  const exists = _queue.some(t => t.type === type && t.fieldName === fieldName);
  if (exists) return;

  _queue.push({ type, fieldName, enqueuedAt: Date.now() });
  _processQueue();
}

async function _processQueue() {
  if (_isProcessing || _queue.length === 0) return;

  _isProcessing = true;
  const task = _queue.shift();

  try {
    _abortController = new AbortController();
    const signal = _abortController.signal;

    // Timeout race
    const timeoutId = setTimeout(() => {
      _abortController?.abort();
      console.log(`[CCS] Background check skipped (slow API): ${task.type}/${task.fieldName}`);
    }, CHECK_TIMEOUT_MS);

    try {
      switch (task.type) {
        case 'conflict':
          await _runConflictCheck(task.fieldName, signal);
          break;
        case 'token':
          await _runTokenCheck(task.fieldName, signal);
          break;
        case 'validation':
          await _runValidationCheck(task.fieldName);
          break;
      }
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      // Cancelled or timed out — silently skip
    } else {
      console.warn(`[CCS] Background check error (${task.type}/${task.fieldName}):`, err.message);
    }
  } finally {
    _isProcessing = false;
    _abortController = null;
    // Process next
    if (_queue.length > 0) {
      _processQueue();
    }
  }
}

// ─── Conflict Check ─────────────────────────────────────────────────────────

async function _runConflictCheck(fieldName, signal) {
  const session = getSession();
  if (!session) return;

  const ctx = SillyTavern?.getContext?.();
  const cardFields = ctx?.getCharacterCardFields?.() || {};

  // Get content of the changed field
  const fieldContent = _getFieldContent(cardFields, fieldName);
  if (!fieldContent) return;

  // Compare against other filled fields
  const fieldsToCompare = ['description', 'personality', 'system', 'scenario', 'firstMessage'];
  const stFieldName = _ccsToStFieldName(fieldName);

  for (const otherStField of fieldsToCompare) {
    if (otherStField === stFieldName) continue;
    const otherContent = cardFields[otherStField];
    if (!otherContent || !String(otherContent).trim()) continue;

    // Cache check
    const cacheKey = `conflict_${hashString(fieldContent)}_${hashString(String(otherContent))}`;
    if (_checkCache.has(cacheKey)) continue;

    if (signal.aborted) return;

    try {
      const prompt = CONFLICT_CHECK_PROMPT
        .replace('[FIELD_A_NAME]', fieldName)
        .replace('[FIELD_A_CONTENT]', fieldContent.substring(0, 800))
        .replace('[FIELD_B_NAME]', _stToDisplayName(otherStField))
        .replace('[FIELD_B_CONTENT]', String(otherContent).substring(0, 800));

      const response = await generateTextWithProfile(
        [{ role: 'user', content: prompt }],
        { name: 'ccs-conflict-check', signal }
      );

      const parsed = _parseJsonResponse(response);
      _cacheResult(cacheKey, parsed);

      if (parsed?.has_conflict) {
        _addConflict(session, {
          fieldA: fieldName,
          fieldB: _stToDisplayName(otherStField),
          description: parsed.description || 'Potential contradiction detected',
          severity: parsed.severity || 'low',
        });
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.warn(`[CCS] Conflict check failed (${fieldName} vs ${otherStField}):`, err.message);
      }
    }
  }
}

// ─── Token Check ────────────────────────────────────────────────────────────

async function _runTokenCheck(fieldName, signal) {
  const session = getSession();
  if (!session) return;

  const ctx = SillyTavern?.getContext?.();
  const cardFields = ctx?.getCharacterCardFields?.() || {};
  const fieldContent = _getFieldContent(cardFields, fieldName);
  if (!fieldContent) return;

  // Cache check
  const cacheKey = `token_${hashString(fieldContent)}`;
  if (_checkCache.has(cacheKey)) return;

  const tokenCount = Math.round(fieldContent.length / 4);

  // Determine tier from session or default
  const tier = tokenCount < 600 ? 'compact' : tokenCount < 1200 ? 'standard' : 'rich';

  try {
    const prompt = TOKEN_CHECK_PROMPT
      .replace('[FIELD_NAME]', fieldName)
      .replace('[CONTENT]', fieldContent.substring(0, 1000))
      .replace('[COUNT]', String(tokenCount))
      .replace('[TIER]', tier);

    const response = await generateTextWithProfile(
      [{ role: 'user', content: prompt }],
      { name: 'ccs-token-check', signal }
    );

    const parsed = _parseJsonResponse(response);
    _cacheResult(cacheKey, parsed);

    if (parsed && !parsed.within_budget) {
      _addConflict(session, {
        fieldA: fieldName,
        fieldB: 'token_budget',
        description: parsed.recommendation || `Field "${fieldName}" may exceed token budget (~${tokenCount}t)`,
        severity: 'low',
      });
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.warn(`[CCS] Token check failed (${fieldName}):`, err.message);
    }
  }
}

// ─── Validation Check (local, no API) ───────────────────────────────────────

async function _runValidationCheck(fieldName) {
  const session = getSession();
  if (!session) return;

  const ctx = SillyTavern?.getContext?.();
  const cardFields = ctx?.getCharacterCardFields?.() || {};
  const fieldContent = _getFieldContent(cardFields, fieldName);
  if (!fieldContent) return;

  const format = session.cardFormat || 'prose';
  const result = validateField(fieldName, fieldContent, format);

  if (!result.valid) {
    for (const warning of result.warnings) {
      _addConflict(session, {
        fieldA: fieldName,
        fieldB: 'validation',
        description: warning,
        severity: 'low',
      });
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function _getFieldContent(cardFields, ccsFieldName) {
  const stFieldMap = {
    description: 'description',
    personality: 'personality',
    system_prompt: 'system',
    scenario: 'scenario',
    first_mes: 'firstMessage',
    mes_example: 'mesExamples',
    creator_notes: 'creatorNotes',
    character_note: 'charDepthPrompt',
  };
  const stKey = stFieldMap[ccsFieldName] || ccsFieldName;
  const val = cardFields[stKey];
  if (Array.isArray(val)) return val.join('\n---\n');
  return val ? String(val).trim() : '';
}

function _ccsToStFieldName(ccsName) {
  const map = {
    description: 'description',
    personality: 'personality',
    system_prompt: 'system',
    scenario: 'scenario',
    first_mes: 'firstMessage',
    mes_example: 'mesExamples',
    creator_notes: 'creatorNotes',
    character_note: 'charDepthPrompt',
  };
  return map[ccsName] || ccsName;
}

function _stToDisplayName(stKey) {
  const map = {
    description: 'Description',
    personality: 'Personality',
    system: 'System Prompt',
    scenario: 'Scenario',
    firstMessage: 'First Message',
    mesExamples: 'Example Messages',
    creatorNotes: 'Creator Notes',
    charDepthPrompt: 'Character Note',
  };
  return map[stKey] || stKey;
}

function _parseJsonResponse(text) {
  if (!text) return null;
  try {
    // Try to extract JSON from response (may have extra text around it)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch {
    console.warn('[CCS] Failed to parse background check JSON:', text.substring(0, 100));
  }
  return null;
}

function _cacheResult(key, result) {
  _checkCache.set(key, result);
  // Evict old entries if cache too large
  if (_checkCache.size > CHECK_CACHE_MAX) {
    const oldest = _checkCache.keys().next().value;
    _checkCache.delete(oldest);
  }
}

function _addConflict(session, { fieldA, fieldB, description, severity }) {
  const conflicts = session.conflicts || [];

  // Don't add duplicate conflicts
  const existing = conflicts.find(c =>
    c.fieldA === fieldA && c.fieldB === fieldB && c.status === 'open'
  );
  if (existing) return;

  // Check false positives
  const falsePositives = session.falsePositives || [];
  const isFP = falsePositives.some(fp =>
    conflicts.some(c => c.id === fp.conflictId && c.fieldA === fieldA && c.fieldB === fieldB)
  );
  if (isFP) return;

  const conflict = {
    id: `conflict_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`,
    fieldA,
    fieldB,
    description,
    severity,
    status: 'open',
    detectedAt: Date.now(),
  };

  conflicts.push(conflict);
  updateSession({ conflicts });

  // Notify UI
  document.dispatchEvent(new CustomEvent('ccs:conflict-detected', { detail: conflict }));
  console.log(`[CCS] Conflict detected: ${fieldA} ↔ ${fieldB} (${severity}): ${description}`);
}
