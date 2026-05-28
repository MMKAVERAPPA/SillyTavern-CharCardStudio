/**
 * CharCardStudio v4.0.0 — core/validators.js
 * Field validation rules (Section 10.1) and quality star rating (Section 10.2).
 *
 * validateField(fieldName, content, format) → { valid, warnings[] }
 * calculateStarRating(session) → { stars, modifiers[], details }
 */

import { getLorebookEntries } from './lorebook.js';
import { countTokensSync } from './token-utils.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const PLACEHOLDER_PATTERNS = [
  /\bTBD\b/i,
  /\bTODO\b/i,
  /\bPLACEHOLDER\b/i,
  /\bFILL IN\b/i,
  /\bINSERT HERE\b/i,
  /\bCOMING SOON\b/i,
  /\[\.\.\.?\]/,
];

const USER_IMPERSONATION_PATTERNS = [
  /\{\{user\}\}\s+(feels?|thinks?|decides?|walks?|enters?|sits?|looks?|says?|nods?|smiles?|frowns?)/i,
  /you\s+(feel|think|decide|walk|enter|sit|look|say|nod|smile|frown)/i,
];

const NEGATIVE_PHRASING = [
  /\bdon'?t\b/i,
  /\bnever\b/i,
  /\bdo not\b/i,
  /\bshouldn'?t\b/i,
  /\bmust not\b/i,
  /\bcannot\b/i,
  /\bcan'?t\b/i,
];

// ─── Field Validation (Section 10.1) ────────────────────────────────────────

/**
 * Validate a single card field against type-specific rules.
 * @param {string} fieldName - CCS field name
 * @param {string} content - Field content
 * @param {'prose'|'plist'} format - Active card format
 * @returns {{ valid: boolean, warnings: string[] }}
 */
export function validateField(fieldName, content, format = 'prose') {
  const warnings = [];

  if (!content || !content.trim()) {
    return { valid: true, warnings: [] }; // Empty fields aren't invalid, just incomplete
  }

  // Universal checks
  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(content)) {
      warnings.push('Contains placeholder text (TBD/TODO)');
      break;
    }
  }

  // Field-specific checks
  switch (fieldName) {
    case 'description':
      _validateDescription(content, format, warnings);
      break;
    case 'personality':
      _validatePersonality(content, warnings);
      break;
    case 'system_prompt':
      _validateSystemPrompt(content, warnings);
      break;
    case 'scenario':
      _validateScenario(content, warnings);
      break;
    case 'first_mes':
      _validateFirstMessage(content, warnings);
      break;
    case 'mes_example':
      _validateExampleMessages(content, warnings);
      break;
  }

  return {
    valid: warnings.length === 0,
    warnings,
  };
}

function _validateDescription(content, format, warnings) {
  // Prose format: expect multiple paragraphs
  if (format === 'prose') {
    const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim());
    if (paragraphs.length < 3) {
      warnings.push('Prose description should have 3-5 paragraphs (has ' + paragraphs.length + ')');
    }
  }

  // PList format: expect Ali:Chat style
  if (format === 'plist') {
    if (!content.includes('{{char}}') && !content.includes('Interviewer')) {
      warnings.push('PList mode — Description should use Ali:Chat interview format');
    }
  }

  // No {{user}} impersonation in Ali:Chat
  for (const pattern of USER_IMPERSONATION_PATTERNS) {
    if (pattern.test(content)) {
      warnings.push('Description appears to describe {{user}}\'s actions');
      break;
    }
  }
}

function _validatePersonality(content, warnings) {
  // Should be brief
  const tokens = countTokensSync(content);
  if (tokens > 300) {
    warnings.push(`Personality is long (~${tokens}t) — should be brief (2-5 sentences)`);
  }
}

function _validateSystemPrompt(content, warnings) {
  // No negative phrasing
  const negatives = [];
  for (const pattern of NEGATIVE_PHRASING) {
    const match = content.match(pattern);
    if (match) negatives.push(match[0]);
  }
  if (negatives.length > 0) {
    warnings.push(`System prompt uses negative phrasing: "${negatives.slice(0, 3).join('", "')}". Use positive instructions instead.`);
  }

  // No {{user}} actions
  for (const pattern of USER_IMPERSONATION_PATTERNS) {
    if (pattern.test(content)) {
      warnings.push('System prompt should not describe {{user}}\'s actions');
      break;
    }
  }

  // Token check
  const tokens = countTokensSync(content);
  if (tokens > 200) {
    warnings.push(`System prompt is ~${tokens}t — ideally under 200t`);
  }
}

function _validateScenario(content, warnings) {
  // Should not be event-specific (hard to detect reliably, use heuristics)
  for (const pattern of USER_IMPERSONATION_PATTERNS) {
    if (pattern.test(content)) {
      warnings.push('Scenario implies {{user}} actions — should be a permanent world-frame, not a specific event');
      break;
    }
  }
}

function _validateFirstMessage(content, warnings) {
  // Must not describe {{user}}
  for (const pattern of USER_IMPERSONATION_PATTERNS) {
    if (pattern.test(content)) {
      warnings.push('First message describes {{user}}\'s actions or feelings — use the flipped scenario technique');
      break;
    }
  }

  // Should have open-ended hook
  const lastSentence = content.trim().split(/[.!?]\s+/).pop() || '';
  const hasQuestion = /\?/.test(lastSentence) || /\?/.test(content.slice(-200));
  const hasOpenEnded = /\.{3}|—|–|\*[^*]+\*\s*$/.test(content.trim());
  if (!hasQuestion && !hasOpenEnded) {
    warnings.push('First message may lack an open-ended hook — consider ending with a question or open action');
  }
}

function _validateExampleMessages(content, warnings) {
  // Must have <START> separators
  if (!content.includes('<START>')) {
    warnings.push('Example messages should have <START> separators between exchanges');
  }

  // Must have {{user}} and {{char}} labels
  if (!content.includes('{{char}}')) {
    warnings.push('Example messages should include {{char}}: labels');
  }

  // Check for {{user}} impersonation within {{char}} lines
  const charLines = content.split('\n').filter(l => l.trim().startsWith('{{char}}'));
  for (const line of charLines) {
    for (const pattern of USER_IMPERSONATION_PATTERNS) {
      if (pattern.test(line)) {
        warnings.push('{{char}} line appears to describe {{user}}\'s actions');
        break;
      }
    }
  }

  // Should cover 2+ situations
  const startCount = (content.match(/<START>/g) || []).length;
  if (startCount < 2) {
    warnings.push('Example messages should cover at least 2 different emotional situations');
  }
}

// ─── Star Rating (Section 10.2) ─────────────────────────────────────────────

/**
 * Calculate quality star rating for the current card state.
 * @param {object} session - Current session state
 * @param {object} [cardFields] - Card fields from ST (optional, will read from context if not provided)
 * @returns {{ stars: number, modifiers: string[], details: string }}
 */
export function calculateStarRating(session, cardFields) {
  if (!cardFields) {
    try {
      const ctx = SillyTavern?.getContext?.();
      cardFields = ctx?.getCharacterCardFields?.() || {};
    } catch {
      cardFields = {};
    }
  }

  let baseScore = 0;
  const modifiers = [];

  // Field presence check
  const has = (field) => {
    const val = cardFields[field];
    if (Array.isArray(val)) return val.length > 0;
    return val && String(val).trim().length > 0;
  };

  const coreFields = ['description', 'firstMessage'];
  const standardFields = ['personality', 'system', 'scenario'];
  const optionalFields = ['mesExamples', 'creatorNotes', 'charDepthPrompt', 'alternateGreetings'];

  const corePresent = coreFields.filter(has).length;
  const standardPresent = standardFields.filter(has).length;
  const optionalPresent = optionalFields.filter(has).length;

  // Base score calculation
  if (corePresent === 0) {
    baseScore = 1;
  } else if (corePresent < coreFields.length) {
    baseScore = 1.5;
  } else if (standardPresent < standardFields.length) {
    baseScore = 2 + (standardPresent / standardFields.length);
  } else if (optionalPresent < optionalFields.length) {
    baseScore = 3 + (optionalPresent / optionalFields.length) * 0.5;
  } else {
    // All fields present
    baseScore = 4;
  }

  // Pre-calculate validation results for all relevant fields
  const format = session?.cardFormat || 'prose';
  const validationResults = {};
  for (const [stKey, ccsKey] of [
    ['description', 'description'], ['firstMessage', 'first_mes'],
    ['personality', 'personality'], ['system', 'system_prompt'],
  ]) {
    const val = cardFields[stKey];
    if (val) {
      validationResults[ccsKey] = validateField(ccsKey, String(val), format);
    }
  }

  if (baseScore === 4) {
    // Check for quality (no placeholder, no validation issues)
    let hasIssues = false;
    for (const res of Object.values(validationResults)) {
      if (!res.valid) {
        hasIssues = true;
        break;
      }
    }
    if (!hasIssues) baseScore = 5;
  }

  // Modifiers
  // +0.5 for linked lorebook with ≥3 entries
  const loreCats = session?.loreCategories || [];
  const loreEntryCount = loreCats.reduce((sum, c) => sum + (c.entries?.length || 0), 0);
  // Also check pillar-tracked lore
  const pillarLore = session?.pillarStates?.filter(p => p.category === 'world' && p.status === 'done').length || 0;
  if (loreEntryCount >= 3 || pillarLore >= 3) {
    baseScore += 0.5;
    modifiers.push('+0.5 lorebook (≥3 entries)');
  }

  // +0.5 for alternate greetings
  if (has('alternateGreetings')) {
    baseScore += 0.5;
    modifiers.push('+0.5 alternate greetings');
  }

  // -0.5 per active conflict
  const activeConflicts = (session?.conflicts || []).filter(c => c.status === 'open').length;
  if (activeConflicts > 0) {
    const penalty = activeConflicts * 0.5;
    baseScore -= penalty;
    modifiers.push(`-${penalty} conflicts (${activeConflicts} active)`);
  }

  // -1.0 per validation failure in core fields
  let coreFailures = 0;
  for (const ccsKey of ['description', 'first_mes', 'personality']) {
    const res = validationResults[ccsKey];
    if (res && !res.valid) {
      coreFailures++;
    }
  }
  if (coreFailures > 0) {
    baseScore -= coreFailures;
    modifiers.push(`-${coreFailures} core field validation failures`);
  }

  // Clamp
  const stars = Math.max(1, Math.min(5, Math.round(baseScore * 2) / 2)); // Round to nearest 0.5

  // Human-readable details
  const detailParts = [];
  detailParts.push(`Core: ${corePresent}/${coreFields.length}`);
  detailParts.push(`Standard: ${standardPresent}/${standardFields.length}`);
  detailParts.push(`Optional: ${optionalPresent}/${optionalFields.length}`);
  if (activeConflicts) detailParts.push(`Conflicts: ${activeConflicts}`);

  return {
    stars,
    modifiers,
    details: detailParts.join(' | '),
  };
}

/**
 * Render star rating as HTML string.
 * @param {number} stars - Rating (1-5, supports 0.5 increments)
 * @returns {string} HTML with filled/half/empty stars
 */
export function renderStarHtml(stars) {
  let html = '';
  for (let i = 1; i <= 5; i++) {
    if (stars >= i) {
      html += '<i class="fa-solid fa-star" style="color: var(--ccs-warning)"></i>';
    } else if (stars >= i - 0.5) {
      html += '<i class="fa-solid fa-star-half-stroke" style="color: var(--ccs-warning)"></i>';
    } else {
      html += '<i class="fa-regular fa-star" style="color: var(--ccs-text-muted)"></i>';
    }
  }
  return html;
}
