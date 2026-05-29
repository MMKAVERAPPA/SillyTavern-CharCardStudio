/**
 * CharCardStudio v5.0.0 — Tool Implementations
 *
 * All 13 tools that the agent can call. Each tool receives parameters
 * and returns a result string that gets injected back into the conversation.
 *
 * Write operations are STAGED — they create drafts that the user must approve.
 */

import { getSession, updateSession, hashString } from './session.js';
import { getCtx } from './st-context.js'; // Bug E: was '../index.js' — broke circular chain
import { updatePillar, addWorldPillar, markPillarDoneByField, calculateProgress } from './pillars.js';
import { getLorebookEntries, createLorebookEntry, updateLorebookEntry, deleteLorebookEntry, getLorebookTokenBudget } from './lorebook.js';
import { enqueueCheck } from './background.js';
import { addMemoryRule, removeMemoryRule } from './session-memory.js';
import { pushFieldVersion } from './field-history.js';

// ─── Field Name Mapping ─────────────────────────────────────────────────────

/** Map CCS field names → ST merge-attributes keys */
const CCS_TO_MERGE = {
  description:         'description',
  personality:         'personality',
  scenario:            'scenario',
  first_mes:           'first_mes',
  mes_example:         'mes_example',
  system_prompt:       'system_prompt',
  creator_notes:       'creator_notes',
  character_note:      'depth_prompt',          // handled specially in applyDraftToCard (nested extensions.depth_prompt.prompt)
  alternate_greetings: 'alternate_greetings',
  tags:                'tags',
};

/** Map ST getCharacterCardFields() keys → CCS field names */
const ST_READ_TO_CCS = {
  description:       'description',
  personality:       'personality',
  scenario:          'scenario',
  firstMessage:      'first_mes',
  mesExamples:       'mes_example',
  system:            'system_prompt',
  creatorNotes:      'creator_notes',
  charDepthPrompt:   'character_note',
  alternateGreetings:'alternate_greetings',
};

const VALID_FIELDS = new Set(Object.keys(CCS_TO_MERGE));

// ─── Tool Registry ──────────────────────────────────────────────────────────

const TOOLS = {
  ccs_write_field:       toolWriteField,
  ccs_read_field:        toolReadField,
  ccs_update_pillar:     toolUpdatePillar,
  ccs_create_lore_entry: toolCreateLoreEntry,
  ccs_read_lore_entries: toolReadLoreEntries,
  ccs_update_lore_entry: toolUpdateLoreEntry,
  ccs_delete_lore_entry: toolDeleteLoreEntry,
  ccs_resolve_conflict:  toolResolveConflict,
  ccs_update_memory:     toolUpdateMemory,
  ccs_audit_card:        toolAuditCard,
  ccs_submit_review:     toolSubmitReview,
  ccs_set_card_type:     toolSetCardType,
  ccs_set_platform:      toolSetPlatform,
  ccs_write_brief:       toolWriteBrief,
  ccs_read_brief:        toolReadBrief,
  ccs_optimize_tokens:        toolOptimizeTokens,
  ccs_semantic_search:        toolSemanticSearch,
  ccs_read_lore_graph:        toolReadLoreGraph,
  ccs_suggest_lore_connections: toolSuggestLoreConnections,
  ccs_generate_avatar_prompt:   toolGenerateAvatarPrompt,
};

/**
 * Execute a tool call by name.
 * @param {{ name: string, parameters: object }} call
 * @returns {Promise<{ result: string, draft?: object }>}
 */
export async function executeToolCall(call) {
  const session = getSession();
  const mode = session?.mode || 'studio';

  if (mode !== 'studio' && call.name !== 'ccs_read_field') {
    return { result: `Error: Tool "${call.name}" is not available in ${mode} mode. Only ccs_read_field is allowed in read-only mode.` };
  }

  const handler = TOOLS[call.name];
  if (!handler) {
    return { result: `Error: Unknown tool "${call.name}". Available: ${Object.keys(TOOLS).join(', ')}` };
  }
  try {
    return await handler(call.parameters || {});
  } catch (err) {
    console.error(`[CCS] Tool ${call.name} error:`, err);
    return { result: `Error executing ${call.name}: ${err.message}` };
  }
}

// ─── Tool 1: Write Field (Staged Draft) ─────────────────────────────────────

async function toolWriteField(params) {
  const { field, content, greeting_index } = params;
  console.log('[CCS] toolWriteField called:', field, 'content length:', content?.length);
  
  if (!field || !VALID_FIELDS.has(field)) {
    return { result: `Error: Invalid field "${field}". Valid fields: ${[...VALID_FIELDS].join(', ')}` };
  }
  if (!content) {
    return { result: 'Error: content parameter is required.' };
  }

  // Count tokens if available
  let tokenCount = null;
  try {
    const ctx = getCtx();
    if (ctx?.getTokenCountAsync) {
      tokenCount = await ctx.getTokenCountAsync(content);
    }
  } catch (e) { /* token counting is optional */ }

  const session = getSession();
  const drafts = session.cardDrafts || {};
  const key = field === 'alternate_greetings' ? `${field}_${greeting_index || 0}` : field;
  const existing = drafts[key];

  // Version entry
  const version = {
    content,
    tokenCount: tokenCount || Math.round(content.length / 4),
    source: 'ai',
    createdAt: Date.now(),
  };

  let draft;

  if (existing && existing.status === 'pending') {
    // Append as new version to existing draft
    existing.versions = existing.versions || [{ content: existing.content, tokenCount: existing.tokenCount, source: 'ai', createdAt: existing.createdAt }];
    existing.versions.push(version);
    existing.activeVersion = existing.versions.length - 1;
    existing.content = content;
    existing.tokenCount = tokenCount;
    draft = existing;
    console.log(`[CCS] Version ${existing.activeVersion + 1} added to draft for "${field}"`);
  } else {
    // Create new draft with versions
    draft = {
      id: `draft_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      field,
      content,
      greetingIndex: greeting_index,
      status: 'pending',
      tokenCount,
      versions: [version],
      activeVersion: 0,
      createdAt: Date.now(),
    };
    drafts[key] = draft;
  }

  await updateSession({ cardDrafts: drafts });

  const versionLabel = draft.versions ? `v${draft.activeVersion + 1}/${draft.versions.length}` : '';
  console.log('[CCS] Draft created:', {
    id: draft.id,
    field: draft.field,
    contentLength: draft.content?.length,
    tokenCount: draft.tokenCount,
    versions: draft.versions?.length || 1,
    status: draft.status,
  });

  return {
    result: `Draft created for "${field}" (${draft.tokenCount || '?'} tokens${versionLabel ? ', ' + versionLabel : ''}). Waiting for user approval.`,
    draft,
  };
}

// ─── Tool 2: Read Field ─────────────────────────────────────────────────────

async function toolReadField(params) {
  // Handle both { fields: [...] } and { field: "..." } patterns
  let fields = params.fields || (params.field ? [params.field] : ['all']);
  if (typeof fields === 'string') fields = [fields];

  const ctx = getCtx();
  if (!ctx) return { result: 'Error: SillyTavern context not available.' };

  const cardFields = ctx.getCharacterCardFields?.();
  if (!cardFields) return { result: 'Error: No character loaded.' };

  const readAll = fields.includes('all');
  const results = {};

  for (const [stKey, ccsKey] of Object.entries(ST_READ_TO_CCS)) {
    if (!readAll && !fields.includes(ccsKey)) continue;
    
    let value = cardFields[stKey];
    if (value === undefined || value === null) value = '';
    if (Array.isArray(value)) value = JSON.stringify(value);
    
    results[ccsKey] = {
      content: String(value).substring(0, 3000), // Cap to avoid huge context
      length: String(value).length,
    };
  }

  // Format as readable string
  const lines = [];
  for (const [field, info] of Object.entries(results)) {
    const preview = info.content.length > 500 
      ? info.content.substring(0, 500) + '...[truncated]' 
      : info.content;
    lines.push(`[${field}] (${info.length} chars):\n${preview || '(empty)'}`);
  }

  return { result: lines.join('\n\n') };
}

// ─── Tool 3: Update Pillar ──────────────────────────────────────────────────

async function toolUpdatePillar(params) {
  const { pillar_id, status, summary, name } = params;
  if (!pillar_id || !status) {
    return { result: 'Error: pillar_id and status are required.' };
  }

  // Try updating existing pillar first
  const result = updatePillar(pillar_id, status, summary);
  
  if (result.success) {
    const session = getSession();
    const progress = calculateProgress(session.pillarStates);
    return { result: `Pillar "${result.pillar.name}" updated to ${status}. Progress: ${progress.done}/${progress.total - progress.skipped} (${progress.percent}%).` };
  }

  // If not found and it's a world pillar, create it
  if (result.error?.includes('not found')) {
    const pillar = addWorldPillar(name || pillar_id, summary);
    if (pillar) {
      pillar.status = status;
      updateSession({ pillarStates: getSession().pillarStates });
      const session = getSession();
      const progress = calculateProgress(session.pillarStates);
      return { result: `World pillar "${pillar.name}" created with status ${status}. Progress: ${progress.done}/${progress.total - progress.skipped} (${progress.percent}%).` };
    }
  }

  return { result: result.error || 'Error updating pillar.' };
}

// ─── Tool 4: Create Lore Entry (Staged) ─────────────────────────────────────

async function toolCreateLoreEntry(params) {
  const { name, content, keys } = params;
  if (!name || !content || !keys?.length) {
    return { result: 'Error: name, content, and keys are required.' };
  }

  const session = getSession();
  const draft = {
    id: `lore_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type: 'create',
    name,
    content,
    keys,
    secondaryKeys: params.secondary_keys || [],
    category: params.category || '',
    constant: params.constant || false,
    position: params.position || 'after_char',
    depth: params.depth ?? 4,
    order: params.order || 100,
    preventRecursion: params.prevent_recursion || false,
    status: 'pending',
    createdAt: Date.now(),
  };

  // Count tokens
  try {
    const ctx = getCtx();
    if (ctx?.getTokenCountAsync) {
      draft.tokenCount = await ctx.getTokenCountAsync(content);
    }
  } catch (e) { /* optional */ }

  const loreDrafts = session.loreDrafts || [];
  loreDrafts.push(draft);
  await updateSession({ loreDrafts });

  return {
    result: `Lore entry "${name}" staged for approval (${draft.tokenCount || '?'}t). Keys: [${keys.join(', ')}]. ${params.constant ? '📌 Constant' : '⚡ Triggered'}`,
    draft,
  };
}

// ─── Tool 5: Read Lore Entries ──────────────────────────────────────────────

async function toolReadLoreEntries(params) {
  try {
    const { entries } = await getLorebookEntries(); // Bug A fix: getLorebookEntries returns { entries, bookName }
    if (!entries || entries.length === 0) {
      return { result: 'No lorebook entries found for this character.' };
    }

    const lines = entries.map(e => {
      const keyArr = Array.isArray(e.key) ? e.key : (e.key ? [e.key] : []);
      const keys = keyArr.join(', ') || 'none';
      const content = params.include_content !== false 
        ? `\n  Content: ${String(e.content).substring(0, 300)}` 
        : '';
      return `• ${e.comment || e.name || 'Untitled'} (uid: ${e.uid}) [keys: ${keys}]${content}`;
    });

    return { result: `${entries.length} lorebook entries:\n${lines.join('\n')}` };
  } catch (err) {
    return { result: `Error reading lorebook: ${err.message}` };
  }
}

// ─── Tool 6: Update Lore Entry (Staged) ─────────────────────────────────────

async function toolUpdateLoreEntry(params) {
  if (!params.uid) return { result: 'Error: uid is required.' };

  const session = getSession();
  const draft = {
    id: `lore_upd_${Date.now()}`,
    type: 'update',
    uid: params.uid,
    changes: {},
    status: 'pending',
    createdAt: Date.now(),
  };
  if (params.content !== undefined) draft.changes.content = params.content;
  if (params.keys !== undefined) draft.changes.keys = params.keys;
  if (params.name !== undefined) draft.changes.name = params.name;

  const loreDrafts = session.loreDrafts || [];
  loreDrafts.push(draft);
  await updateSession({ loreDrafts });

  return { result: `Lore entry update staged for uid "${params.uid}".`, draft };
}

// ─── Tool 7: Delete Lore Entry (Staged) ─────────────────────────────────────

async function toolDeleteLoreEntry(params) {
  if (!params.uid) return { result: 'Error: uid is required.' };

  const session = getSession();
  const draft = {
    id: `lore_del_${Date.now()}`,
    type: 'delete',
    uid: params.uid,
    reason: params.reason || '',
    status: 'pending',
    createdAt: Date.now(),
  };

  const loreDrafts = session.loreDrafts || [];
  loreDrafts.push(draft);
  await updateSession({ loreDrafts });

  return { result: `Lore entry "${params.uid}" staged for deletion.${params.reason ? ` Reason: ${params.reason}` : ''}`, draft };
}

// ─── Tool 8: Resolve Conflict ───────────────────────────────────────────────

async function toolResolveConflict(params) {
  const { conflict_id, resolution, fix_content } = params;
  if (!conflict_id) return { result: 'Error: conflict_id is required.' };

  const session = getSession();
  const conflicts = session.conflicts || [];
  const conflict = conflicts.find(c => c.id === conflict_id);
  if (!conflict) return { result: `Conflict "${conflict_id}" not found.` };

  switch (resolution) {
    case 'fix':
      conflict.status = 'resolved';
      conflict.resolvedAt = Date.now();
      break;
    case 'ignore':
      conflict.status = 'ignored';
      // Add to false positives so it doesn't reappear
      const fps = session.falsePositives || [];
      fps.push({ conflictId: conflict_id, markedAt: Date.now(), sessionOnly: false });
      await updateSession({ conflicts, falsePositives: fps });
      return { result: `Conflict ignored: ${conflict.description}` };
    case 'defer':
      conflict.status = 'snoozed';
      break;
    default:
      return { result: `Unknown resolution: ${resolution}. Use: fix, ignore, or defer.` };
  }

  await updateSession({ conflicts });
  return { result: `Conflict ${resolution}: ${conflict.description}` };
}

// ─── Tool 9: Update Memory ─────────────────────────────────────────────────

async function toolUpdateMemory(params) {
  const { type, content, action = 'add' } = params;
  if (!type || !content) {
    return { result: 'Error: type and content are required.' };
  }

  if (action === 'remove') {
    const removed = await removeMemoryRule(type, content);
    return { result: removed ? `Memory removed: ${content}` : `No matching memory found for: ${content}` };
  }

  const { success, id } = await addMemoryRule(type, content, 'ai');
  if (!success) return { result: 'Error: Could not save memory rule.' };
  return { result: `Memory saved (${type}): ${content}` };
}

// ─── Tool 10: Audit Card ───────────────────────────────────────────────────

async function toolAuditCard(params) {
  const readResult = await toolReadField({ fields: ['all'] });
  return { 
    result: `Card audit data:\n${readResult.result}\n\n[Analyze the above fields and provide your assessment.]` 
  };
}

// ─── Apply Draft to ST Card ─────────────────────────────────────────────────

/**
 * Apply a staged draft to the actual ST character card.
 * Called when user clicks "Apply" on a draft card in chat.
 * @param {string} draftId
 * @returns {Promise<boolean>}
 */
export async function applyDraftToCard(draftId) {
  console.log('[CCS] applyDraftToCard called:', draftId);
  const session = getSession();
  const drafts = session.cardDrafts || {};
  
  // Find the draft
  let draft = null;
  let draftKey = null;
  for (const [key, d] of Object.entries(drafts)) {
    if (d.id === draftId) {
      draft = d;
      draftKey = key;
      break;
    }
  }
  
  if (!draft) {
    console.error('[CCS] Draft not found:', draftId, 'Available drafts:', Object.keys(drafts));
    return false;
  }
  console.log('[CCS] Found draft:', draft.field, 'status:', draft.status);

  const ctx = getCtx();
  if (!ctx) {
    console.error('[CCS] No ST context available');
    return false;
  }

  const charId = ctx.characterId;
  const char = ctx.characters?.[charId];
  if (!char?.avatar) {
    console.error('[CCS] No character loaded. charId:', charId, 'char:', char?.name);
    return false;
  }
  console.log('[CCS] Applying to character:', char.name, 'avatar:', char.avatar);

  // Push the current value to history before applying the draft
  try {
    const stFields = ctx.getCharacterCardFields() || {};
    const stKey = Object.keys(ST_READ_TO_CCS).find(k => ST_READ_TO_CCS[k] === draft.field);
    let currentValue = '';
    if (draft.field === 'alternate_greetings') {
      currentValue = JSON.stringify(char.data?.alternate_greetings || []);
    } else if (stKey) {
      currentValue = stFields[stKey] || '';
      if (Array.isArray(currentValue)) {
        currentValue = currentValue.join('\n---\n');
      }
    }
    pushFieldVersion(session, draft.field, currentValue, 'draft_applied');
  } catch (historyErr) {
    console.warn('[CCS] Failed to push field history during apply:', historyErr);
  }

  try {
    // Build the merge payload
    const mergeKey = CCS_TO_MERGE[draft.field];
    if (!mergeKey) {
      console.error('[CCS] No merge key for field:', draft.field);
      return false;
    }

    let body;
    
    if (draft.field === 'character_note') {
      // Character note is nested: data.extensions.depth_prompt.prompt
      body = JSON.stringify({
        avatar: char.avatar,
        data: {
          extensions: {
            depth_prompt: {
              prompt: draft.content,
              depth: 4,
              role: 'system',
            }
          }
        }
      });
    } else if (draft.field === 'alternate_greetings') {
      // Alt greetings: merge into array
      const existing = char.data?.alternate_greetings || [];
      const idx = draft.greetingIndex || 0;
      const updated = [...existing];
      updated[idx] = draft.content;
      body = JSON.stringify({
        avatar: char.avatar,
        data: { alternate_greetings: updated }
      });
    } else if (draft.field === 'tags') {
      // Tags: array of strings
      const tags = typeof draft.content === 'string' 
        ? draft.content.split(',').map(t => t.trim()).filter(Boolean)
        : draft.content;
      body = JSON.stringify({
        avatar: char.avatar,
        data: { tags }
      });
    } else {
      // Standard flat fields
      body = JSON.stringify({
        avatar: char.avatar,
        data: { [mergeKey]: draft.content }
      });
    }

    console.log('[CCS] Merge request body:', body.substring(0, 300));

    const headers = {
      'Content-Type': 'application/json',
      ...ctx.getRequestHeaders(),
    };
    console.log('[CCS] Request headers:', Object.keys(headers));

    const resp = await fetch('/api/characters/merge-attributes', {
      method: 'POST',
      headers,
      body,
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('[CCS] Merge failed:', resp.status, errText);
      return false;
    }

    console.log('[CCS] Merge SUCCESS for field:', draft.field);

    // Mark draft as applied
    draft.status = 'applied';
    await updateSession({ cardDrafts: drafts });

    // Refresh ST's in-memory character data so the editor shows the update
    try {
        const refreshCtx = SillyTavern.getContext();
        await refreshCtx.getOneCharacter(char.avatar);
        // Notify ST UI that the character was edited
        if (refreshCtx.eventSource && refreshCtx.event_types) {
            await refreshCtx.eventSource.emit(refreshCtx.event_types.CHARACTER_EDITED, {
                detail: { id: refreshCtx.this_chid, character: refreshCtx.characters[refreshCtx.this_chid] }
            });
        }
        console.log('[CCS] ST character data refreshed after apply');
    } catch (refreshErr) {
        console.warn('[CCS] Could not refresh ST data after apply:', refreshErr);
    }

    // Notify CCS panels to re-render with fresh data
    document.dispatchEvent(new CustomEvent('ccs:card-updated'));

    // Auto-mark the corresponding pillar as done
    markPillarDoneByField(draft.field, `Applied ${draft.tokenCount || '?'}t draft`);

    // Store field hash for manual edit detection
    const fieldHashes = session.fieldHashes || {};
    fieldHashes[draft.field] = hashString(draft.content);
    await updateSession({ fieldHashes });

    // Enqueue background checks (conflict + token + validation)
    enqueueCheck('conflict', draft.field);
    enqueueCheck('token', draft.field);
    enqueueCheck('validation', draft.field);
    
    console.log(`[CCS] Applied draft for ${draft.field}`);
    return true;
  } catch (err) {
    console.error('[CCS] Apply draft error:', err);
    return false;
  }
}

/**
 * Direct save to character card without drafting.
 * Used for inline editing in the card fields UI.
 *
 * @param {string} fieldName - CCS field name
 * @param {string} content - New content to save
 * @param {number} [greetingIndex] - Greeting index for alternate greetings
 * @returns {Promise<boolean>}
 */
export async function saveFieldDirect(fieldName, content, greetingIndex = null) {
  console.log('[CCS] saveFieldDirect called:', fieldName);
  const session = getSession();
  const ctx = getCtx();
  if (!ctx) {
    console.error('[CCS] No ST context available');
    return false;
  }

  const charId = ctx.characterId;
  const char = ctx.characters?.[charId];
  if (!char?.avatar) {
    console.error('[CCS] No character loaded');
    return false;
  }

  try {
    // 1. Get current value and push to history
    const stFields = ctx.getCharacterCardFields() || {};
    const stKey = Object.keys(ST_READ_TO_CCS).find(k => ST_READ_TO_CCS[k] === fieldName);
    let currentValue = '';
    if (fieldName === 'alternate_greetings') {
      currentValue = JSON.stringify(char.data?.alternate_greetings || []);
    } else if (stKey) {
      currentValue = stFields[stKey] || '';
      if (Array.isArray(currentValue)) {
        currentValue = currentValue.join('\n---\n');
      }
    }
    pushFieldVersion(session, fieldName, currentValue, 'direct_edit');

    // 2. Build the merge payload
    const mergeKey = CCS_TO_MERGE[fieldName];
    if (!mergeKey) {
      console.error('[CCS] No merge key for field:', fieldName);
      return false;
    }

    let body;
    if (fieldName === 'character_note') {
      body = JSON.stringify({
        avatar: char.avatar,
        data: {
          extensions: {
            depth_prompt: {
              prompt: content,
              depth: 4,
              role: 'system',
            }
          }
        }
      });
    } else if (fieldName === 'alternate_greetings') {
      let updated;
      if (greetingIndex === null) {
        updated = content.split('\n---\n').map(g => g.trim()).filter(Boolean);
      } else {
        const existing = char.data?.alternate_greetings || [];
        updated = [...existing];
        updated[greetingIndex] = content;
      }
      body = JSON.stringify({
        avatar: char.avatar,
        data: { alternate_greetings: updated }
      });
    } else if (fieldName === 'tags') {
      const tags = typeof content === 'string'
        ? content.split(',').map(t => t.trim()).filter(Boolean)
        : content;
      body = JSON.stringify({
        avatar: char.avatar,
        data: { tags }
      });
    } else {
      body = JSON.stringify({
        avatar: char.avatar,
        data: { [mergeKey]: content }
      });
    }

    const headers = {
      'Content-Type': 'application/json',
      ...ctx.getRequestHeaders(),
    };

    const resp = await fetch('/api/characters/merge-attributes', {
      method: 'POST',
      headers,
      body,
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('[CCS] Merge failed direct:', resp.status, errText);
      return false;
    }

    // 3. Refresh ST character data
    try {
        const refreshCtx = SillyTavern.getContext();
        await refreshCtx.getOneCharacter(char.avatar);
        if (refreshCtx.eventSource && refreshCtx.event_types) {
            await refreshCtx.eventSource.emit(refreshCtx.event_types.CHARACTER_EDITED, {
                detail: { id: refreshCtx.this_chid, character: refreshCtx.characters[refreshCtx.this_chid] }
            });
        }
    } catch (refreshErr) {
        console.warn('[CCS] Could not refresh ST data after direct save:', refreshErr);
    }

    // 4. Notify UI to update
    document.dispatchEvent(new CustomEvent('ccs:card-updated'));

    // 5. Update field hash for manual edit detection
    const fieldHashes = session.fieldHashes || {};
    fieldHashes[fieldName] = hashString(content);
    await updateSession({ fieldHashes });

    // 6. Run background validators
    enqueueCheck('conflict', fieldName);
    enqueueCheck('token', fieldName);
    enqueueCheck('validation', fieldName);

    console.log(`[CCS] Direct saved field: ${fieldName}`);
    return true;
  } catch (err) {
    console.error('[CCS] Direct save error:', err);
    return false;
  }
}

/**
 * Apply a staged lore draft to the ST lorebook.
 * Dispatches to the appropriate CRUD function based on draft.type.
 * @param {string} draftId 
 * @returns {Promise<boolean>}
 */
export async function applyLoreDraft(draftId) {
  const session = getSession();
  const loreDrafts = session.loreDrafts || [];
  const draft = loreDrafts.find(d => d.id === draftId);
  if (!draft) {
    console.error('[CCS] Lore draft not found:', draftId);
    return false;
  }

  try {
    let result;

    switch (draft.type) {
      case 'create': {
        result = await createLorebookEntry({
          name: draft.name,
          content: draft.content,
          keys: draft.keys,
          secondaryKeys: draft.secondaryKeys,
          constant: draft.constant,
          position: draft.position,
          depth: draft.depth,
          order: draft.order,
          preventRecursion: draft.preventRecursion,
        });
        if (!result.success) {
          console.error('[CCS] Lore create failed:', result.error);
          return false;
        }
        console.log(`[CCS] Lore entry created: "${draft.name}" (uid: ${result.uid})`);
        break;
      }
      case 'update': {
        result = await updateLorebookEntry(draft.uid, draft.changes || {});
        if (!result.success) {
          console.error('[CCS] Lore update failed:', result.error);
          return false;
        }
        console.log(`[CCS] Lore entry updated: uid ${draft.uid}`);
        break;
      }
      case 'delete': {
        result = await deleteLorebookEntry(draft.uid);
        if (!result.success) {
          console.error('[CCS] Lore delete failed:', result.error);
          return false;
        }
        console.log(`[CCS] Lore entry deleted: uid ${draft.uid}`);
        break;
      }
      default: {
        console.error('[CCS] Unknown lore draft type:', draft.type);
        return false;
      }
    }

    // Mark draft as applied
    draft.status = 'applied';
    await updateSession({ loreDrafts });

    // Notify panels to refresh
    document.dispatchEvent(new CustomEvent('ccs:card-updated'));

    return true;
  } catch (err) {
    console.error('[CCS] Apply lore draft error:', err);
    return false;
  }
}

// ─── Tool 11: Submit Review ─────────────────────────────────────────────────

async function toolSubmitReview(params) {
  const { overall_rating, categories, strengths, weaknesses, suggestions } = params;
  
  if (!overall_rating || !categories) {
    return { result: `Error: overall_rating and categories are required.` };
  }

  const reviewData = {
    rating: overall_rating,
    categories: categories || [],
    strengths: strengths || [],
    weaknesses: weaknesses || [],
    suggestions: suggestions || [],
    timestamp: Date.now()
  };

  await updateSession({ aiReview: reviewData });
  
  // Bug C fix: renderApp is not exported from app.js. Dispatch the ccs:card-updated
  // event instead — bindAppEvents() already listens to this and triggers re-renders.
  try {
    document.dispatchEvent(new CustomEvent('ccs:card-updated'));
  } catch (e) {
    console.warn('[CCS] Failed to dispatch card-updated after review submit:', e);
  }

  return { result: `Success: Review scorecard saved and displayed in the Concept panel.` };
}

// ─── Tool 12: Set Card Type ──────────────────────────────────────────────────

/**
 * Record the identified card type into session state.
 * Called during ideation when the card type is identified.
 */
async function toolSetCardType(params) {
  const { card_type, description } = params;
  const VALID_TYPES = ['A', 'B', 'C', 'D', 'E'];

  if (!card_type || !VALID_TYPES.includes(String(card_type).toUpperCase())) {
    return { result: `Error: card_type must be one of: ${VALID_TYPES.join(', ')}` };
  }

  const type = String(card_type).toUpperCase();
  const TYPE_NAMES = {
    A: 'Single Character',
    B: 'Multi-Character Cast',
    C: 'Scenario / World Card',
    D: 'NPC Support Card',
    E: 'Universe / Campaign',
  };

  await updateSession({
    cardType: type,
    cardTypeDescription: description || TYPE_NAMES[type],
  });

  return { result: `Success: Card type set to Type ${type} — ${TYPE_NAMES[type]}. ${description ? `Note: ${description}` : ''}` };
}

// ─── Tool 13: Set Platform ───────────────────────────────────────────────────

/**
 * Record the target platform (SillyTavern or JanitorAI) into session state.
 * Called during ideation when the platform is identified.
 */
async function toolSetPlatform(params) {
  const { platform, note } = params;
  const VALID_PLATFORMS = ['sillyTavern', 'janitorai'];

  if (!platform || !VALID_PLATFORMS.includes(platform)) {
    return { result: `Error: platform must be one of: ${VALID_PLATFORMS.join(', ')}` };
  }

  await updateSession({
    targetPlatform: platform,
    platformNote: note || null,
  });

  const label = platform === 'sillyTavern' ? 'SillyTavern' : 'JanitorAI';
  return { result: `Success: Target platform set to ${label}.${note ? ` Note: ${note}` : ''} Platform-specific rules and token budgets will now apply during Build phase.` };
}

// ─── Tool 14: Write Concept Brief ─────────────────────────────────────────

/**
 * Write or update the concept brief — a living markdown document the AI
 * maintains during the Ideate phase. Stored in session.conceptBrief.
 */
async function toolWriteBrief(params) {
  const { content, mode = 'replace' } = params;

  if (!content || typeof content !== 'string') {
    return { result: 'Error: content parameter is required.' };
  }

  const session = getSession();
  let newBrief;

  if (mode === 'append' && session?.conceptBrief) {
    newBrief = session.conceptBrief + '\n\n' + content;
  } else {
    newBrief = content;
  }

  await updateSession({ conceptBrief: newBrief });

  // Bug C fix: renderApp is not exported from app.js. Use ccs:card-updated event.
  try {
    document.dispatchEvent(new CustomEvent('ccs:card-updated'));
  } catch (e) {
    console.warn('[CCS] Failed to dispatch card-updated after brief update:', e);
  }

  const wordCount = newBrief.split(/\s+/).length;
  return { result: `Success: Concept Brief updated (${wordCount} words). The Brief panel is now visible in the Concept Tab.` };
}

// ─── Tool 15: Read Concept Brief ─────────────────────────────────────────

/**
 * Read the current concept brief back for context.
 */
async function toolReadBrief() {
  const session = getSession();
  const brief = session?.conceptBrief;

  if (!brief) {
    return { result: 'No Concept Brief exists yet. Use ccs_write_brief to create one.' };
  }

  return { result: `Concept Brief (${brief.split(/\s+/).length} words):\n\n${brief}` };
}

// ─── Tool 16: Optimize Tokens ───────────────────────────────────────────

/**
 * Stage a token-optimized rewrite of a card field.
 * The AI generates the compressed content and passes it here;
 * this tool stages it as a draft (same as ccs_write_field) with a token summary.
 */
async function toolOptimizeTokens(params) {
  const { field, optimized_content, target_tokens, original_tokens } = params;

  if (!field || !optimized_content) {
    return { result: 'Error: field and optimized_content are required.' };
  }

  // Delegate to the staged write system — same approval flow as regular writes
  const writeResult = await toolWriteField({ field, content: optimized_content });

  if (writeResult.result.startsWith('Error')) {
    return writeResult;
  }

  const newTokens = Math.round(optimized_content.split(/\s+/).length * 0.75); // rough estimate
  const saved = (original_tokens || 0) - (target_tokens || newTokens);
  const savedStr = saved > 0 ? ` (saved ~${saved}t)` : '';

  return {
    result: `Success: Optimized ${field} staged for approval${savedStr}. Review the draft in the Card Tab — click Apply when ready.`,
    draft: writeResult.draft,
  };
}

// ─── Tool 17: Semantic Search ───────────────────────────────────────────────

/**
 * Pure-JS semantic search across all card fields and lorebook entries.
 * No API call needed — this is a local substring/keyword search.
 * Returns matching excerpts with field/entry context.
 */
async function toolSemanticSearch(params) {
  const { query, max_results = 10 } = params;

  if (!query || typeof query !== 'string') {
    return { result: 'Error: query parameter is required.' };
  }

  const ctx = getCtx();
  const results = [];
  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);

  if (terms.length === 0) {
    return { result: 'Error: query must contain at least one term longer than 2 characters.' };
  }

  // Helper: score a text block against all query terms
  const scoreText = (text) => {
    if (!text) return 0;
    const lower = text.toLowerCase();
    return terms.reduce((sum, term) => {
      const idx = lower.indexOf(term);
      return idx >= 0 ? sum + 1 : sum;
    }, 0);
  };

  // Helper: extract excerpt around first match
  const excerpt = (text, maxLen = 200) => {
    if (!text) return '';
    const lower = text.toLowerCase();
    let bestIdx = -1;
    for (const term of terms) {
      const idx = lower.indexOf(term);
      if (idx >= 0 && (bestIdx < 0 || idx < bestIdx)) bestIdx = idx;
    }
    if (bestIdx < 0) return text.slice(0, maxLen);
    const start = Math.max(0, bestIdx - 60);
    const end = Math.min(text.length, bestIdx + maxLen - 60);
    return (start > 0 ? '…' : '') + text.slice(start, end).trim() + (end < text.length ? '…' : '');
  };

  // ── Search card fields ────────────────────────────────────────────────────
  try {
    const fields = ctx?.getCharacterCardFields?.();
    if (fields) {
      const fieldMap = {
        description: fields.description,
        personality: fields.personality,
        scenario: fields.scenario,
        first_mes: fields.firstMessage,
        mes_example: fields.mesExamples,
        system_prompt: fields.system,
        creator_notes: fields.creatorNotes,
        character_note: fields.charDepthPrompt,
      };

      for (const [field, text] of Object.entries(fieldMap)) {
        const content = Array.isArray(text) ? text.join('\n') : (text || '');
        const score = scoreText(content);
        if (score > 0) {
          results.push({ type: 'field', id: field, score, excerpt: excerpt(content) });
        }
      }

      // Alt greetings
      if (Array.isArray(fields.alternateGreetings)) {
        fields.alternateGreetings.forEach((g, i) => {
          const score = scoreText(g);
          if (score > 0) results.push({ type: 'field', id: `alt_greeting_${i + 1}`, score, excerpt: excerpt(g) });
        });
      }
    }
  } catch (e) {
    console.warn('[CCS] Semantic search: card field read failed:', e.message);
  }

  // ── Search lorebook entries ───────────────────────────────────────────────
  try {
    const session = getSession();
    if (session?.lorebookName) {
      const { entries } = await getLorebookEntries(false); // Bug A fix: was passing object as forceRefresh arg
      for (const entry of (entries || [])) {
        const combined = [entry.name, entry.content, ...(entry.keys || [])].join(' ');
        const score = scoreText(combined);
        if (score > 0) {
          results.push({
            type: 'lore',
            id: entry.uid || entry.name,
            name: entry.name,
            category: entry.category,
            score,
            excerpt: excerpt(entry.content),
          });
        }
      }
    }
  } catch (e) {
    console.warn('[CCS] Semantic search: lorebook read failed:', e.message);
  }

  // ── Sort and format results ───────────────────────────────────────────────
  results.sort((a, b) => b.score - a.score);
  const topResults = results.slice(0, max_results);

  if (topResults.length === 0) {
    return { result: `No matches found for: "${query}"` };
  }

  const lines = [`Search results for "${query}" (${topResults.length} match${topResults.length !== 1 ? 'es' : ''}):`, ''];
  for (const r of topResults) {
    if (r.type === 'field') {
      lines.push(`[FIELD: ${r.id}] — ${r.excerpt}`);
    } else {
      const cat = r.category ? ` [${r.category}]` : '';
      lines.push(`[LORE: ${r.name}${cat}] — ${r.excerpt}`);
    }
  }

  return { result: lines.join('\n') };
}

// ─── Tool 19: Read Lore Graph ─────────────────────────────────────────────────

/**
 * Return the current lorebook's graph topology as a readable summary.
 * Used by the AI to reason about connectivity before suggesting improvements.
 */
async function toolReadLoreGraph() {
  try {
    const { getLoreGraphData } = await import('../ui/lore-graph-v2.js');
    const { entries } = await getLorebookEntries(false); // Bug A fix: destructure return value
    if (!entries || entries.length === 0) {
      return { result: 'No lorebook entries found. Select a lorebook first.' };
    }
    const graphData = getLoreGraphData(entries);
    const summary = [
      `Lore Graph Topology (${graphData.stats.totalEntries} entries, ${graphData.edges.length} edges):`,
      ``,
      `Stats:`,
      `  Total entries: ${graphData.stats.totalEntries}`,
      `  Total edges (activation links): ${graphData.edges.length}`,
      `  Orphaned entries (no connections): ${graphData.stats.orphanedCount}`,
      `  Circular chains detected: ${graphData.stats.circularChainCount}`,
      `  Total token weight: ~${graphData.stats.totalTokens}t`,
      `  Most connected entry: ${graphData.stats.mostConnected ? `"${graphData.stats.mostConnected.name}" (${graphData.stats.mostConnected.edgeCount} edges)` : 'N/A'}`,
      ``,
      `Orphaned entries:`,
      ...(graphData.orphaned.length > 0
        ? graphData.orphaned.map(uid => {
          const e = graphData.entries.find(en => en.uid === uid);
          return `  - "${e?.name || uid}" [${e?.category || '?'}] (~${e?.tokens || 0}t) — no keyword connections`;
        })
        : ['  None']),
      ``,
      `Circular chains:`,
      ...(graphData.circularChains.length > 0
        ? graphData.circularChains.map((chain, i) => `  ${i + 1}. ${chain.join(' → ')}`)
        : ['  None']),
      ``,
      `Entry list (name | category | keys | tokens | in/out edges):`,
      ...graphData.entries.map(e => {
        const outgoing = graphData.edges.filter(ed => ed.from === e.uid).length;
        const incoming = graphData.edges.filter(ed => ed.to === e.uid).length;
        const flags = [
          e.constant ? 'CONSTANT' : null,
          !e.enabled ? 'DISABLED' : null,
          (e.flags?.probability ?? 100) < 100 ? `${e.flags.probability}%` : null,
        ].filter(Boolean);
        return `  [${e.category}] "${e.name}" | keys: ${e.keys.join(', ') || 'none'} | ~${e.tokens}t | in:${incoming} out:${outgoing}${flags.length ? ' | ' + flags.join(', ') : ''}`;
      }),
    ];
    return { result: summary.join('\n') };
  } catch (e) {
    return { result: `Error reading lore graph: ${e.message}` };
  }
}

// ─── Tool 20: Suggest Lore Connections ──────────────────────────────────────────

/**
 * Pure-JS analysis of lorebook connectivity. Returns concrete suggestions.
 */
async function toolSuggestLoreConnections() {
  try {
    const { getLoreGraphData } = await import('../ui/lore-graph-v2.js');
    const { entries } = await getLorebookEntries(false); // Bug A fix: destructure return value
    if (!entries || entries.length === 0) {
      return { result: 'No lorebook entries found. Select a lorebook first.' };
    }
    const graphData = getLoreGraphData(entries);
    const suggestions = [];

    // 1. Orphaned entries
    for (const uid of graphData.orphaned) {
      const orphan = graphData.entries.find(e => e.uid === uid);
      if (!orphan) continue;
      if (orphan.keys.length === 0) {
        suggestions.push(`⚠ Entry "${orphan.name}" [${orphan.category}] has NO keywords. It will never activate. Add at least one trigger keyword.`);
      } else {
        const potentialLinkers = entries.filter(e => {
          if (e.uid === uid) return false;
          const content = (e.content || '').toLowerCase();
          return orphan.keys.some(k => content.includes(k.toLowerCase()));
        });
        if (potentialLinkers.length > 0) {
          suggestions.push(`🔗 Entry "${orphan.name}" appears referenced in "${potentialLinkers[0].name || 'another entry'}" but has no inbound edges. Check that the keyword spelling matches.`);
        } else {
          suggestions.push(`🏝 Entry "${orphan.name}" [${orphan.category}] is isolated (keys: ${orphan.keys.join(', ')}). Add its keywords to a related hub entry to pull it into the activation network.`);
        }
      }
    }

    // 2. Circular chains
    for (const chain of graphData.circularChains) {
      suggestions.push(`🔄 Circular activation chain detected: ${chain.join(' → ')}. Consider enabling "Prevent further recursion" on the last entry to avoid runaway activation.`);
    }

    // 3. Heavy entries (>250t)
    const heavyEntries = graphData.entries.filter(e => e.tokens > 250 && e.enabled);
    for (const e of heavyEntries) {
      suggestions.push(`🏋 Entry "${e.name}" [${e.category}] is heavy (~${e.tokens}t). If constant, this costs tokens on every message. Consider splitting it or making it conditional.`);
    }

    // 4. No keys and not constant
    const noKeyEntries = graphData.entries.filter(e => e.keys.length === 0 && !e.constant && e.enabled);
    for (const e of noKeyEntries) {
      suggestions.push(`❓ Entry "${e.name}" [${e.category}] is not constant and has no keywords — it will never activate. Add trigger keywords or make it constant.`);
    }

    // 5. Hub nodes with prevent-further-recursion (would block many chains)
    const outgoingCounts = {};
    for (const edge of graphData.edges) {
      outgoingCounts[edge.from] = (outgoingCounts[edge.from] || 0) + 1;
    }
    const blockingHubs = graphData.entries.filter(e => (outgoingCounts[e.uid] || 0) >= 4 && e.flags?.preventFurtherRecursion);
    for (const e of blockingHubs) {
      suggestions.push(`⛔ Entry "${e.name}" has ${outgoingCounts[e.uid]} outgoing connections but "Prevent further recursion" is on — it blocks all cascade activations from it. Is this intentional?`);
    }

    if (suggestions.length === 0) {
      return { result: 'The lorebook graph looks well-connected! No major structural issues found.\n\nAll entries have keywords, no orphans, and no circular chains.' };
    }

    return { result: [
      `Lore Connection Analysis — ${suggestions.length} suggestion${suggestions.length !== 1 ? 's' : ''}:`,
      '',
      ...suggestions.map((s, i) => `${i + 1}. ${s}`),
      '',
      'Tip: Open the Lore Graph overlay (🗺️ button in the Lore tab) to see these connections visualized interactively.',
    ].join('\n') };
  } catch (e) {
    return { result: `Error analyzing lore connections: ${e.message}` };
  }
}

// ─── Tool 19: Generate Avatar Prompt ────────────────────────────────────────

/**
 * Reads the current card's description, personality, and concept brief,
 * then constructs an optimised image-generation prompt (positive + negative)
 * and stages it in the chat as an interactive avatar-prompt card.
 *
 * The user can then edit the prompt or click "Generate Avatar" to trigger ST's
 * `/sd` slash command. No image is generated automatically.
 *
 * @param {{ style?: string, emphasis?: string, extra_tags?: string[] }} params
 */
async function toolGenerateAvatarPrompt(params) {
  const {
    style = 'cinematic',
    emphasis = 'bust',
    extra_tags = [],
  } = params;

  const session = getSession();
  if (!session) return { result: 'Error: No active session.' };

  // ── 1. Gather character data ──────────────────────────────────────────────
  // Bug B fix: session.cardFields doesn't exist. Read from ST context instead
  // (same pattern used by toolReadField, toolWriteField, etc.)
  const _ctx = getCtx();
  const _cardFields = _ctx?.getCharacterCardFields?.() || {};
  const description   = _cardFields.description || '';
  const personality   = _cardFields.personality || '';
  const brief         = session?.conceptBrief || '';
  const charName      = session?.characterName || 'the character';

  // ── 2. Build framing tags from style / emphasis ───────────────────────────
  const STYLE_TAGS = {
    cinematic:  'cinematic portrait, dramatic lighting, film grain, shallow depth of field, professional photography',
    anime:      'anime style, cel shaded, clean lineart, vibrant colors, studio quality',
    painterly:  'oil painting, detailed brushwork, classical art style, rich textures, gallery quality',
    realistic:  'photorealistic, ultra detailed, hyperrealistic, 8k resolution, RAW photo',
  };
  const EMPHASIS_TAGS = {
    face:      'close-up portrait, face focus, detailed eyes',
    bust:      'bust shot, upper body, detailed face',
    full_body: 'full body, standing, detailed outfit and background',
  };

  const styleTags    = STYLE_TAGS[style]    || STYLE_TAGS.cinematic;
  const emphasisTags = EMPHASIS_TAGS[emphasis] || EMPHASIS_TAGS.bust;

  // ── 3. Extract visual traits from the description text ────────────────────
  // Pull out common visual descriptors using simple heuristics.
  // The AI will have written these in the description — we just extract them.
  const visualText = [description, personality, brief].join(' ').substring(0, 2000);

  // Common appearance keywords to look for (extend as needed)
  const TRAIT_PATTERNS = [
    /(?:has?|with)\s+([\w\-]+(?:\s+[\w]+)?\s+(?:hair|eyes?|skin|complexion|build|height|body|figure|ears?|tail|horns?|wings?|fur))/gi,
    /([\w\-]+\s+(?:hair|eyes?|skin))/gi,
    /(?:is|appears?|looks?)\s+([\w\-]+(?:\s+[\w]+)?)/gi,
    /wearing\s+([^,\.]+)/gi,
    /dressed\s+in\s+([^,\.]+)/gi,
  ];

  const traits = new Set();
  for (const pattern of TRAIT_PATTERNS) {
    let m;
    pattern.lastIndex = 0;
    while ((m = pattern.exec(visualText)) !== null) {
      const trait = m[1].trim().toLowerCase().replace(/\s+/g, ' ');
      if (trait.length >= 3 && trait.length <= 40) traits.add(trait);
      if (traits.size >= 12) break;
    }
  }

  const extractedTraits = [...traits].slice(0, 10).join(', ');

  // ── 4. Assemble positive prompt ───────────────────────────────────────────
  const positiveParts = [
    extractedTraits,
    styleTags,
    emphasisTags,
    'highly detailed',
    'masterpiece',
    ...(extra_tags || []),
  ].filter(Boolean);

  const positivePrompt = positiveParts.join(', ');

  // ── 5. Standard negative prompt ───────────────────────────────────────────
  const negativePrompt = [
    'deformed', 'bad anatomy', 'extra limbs', 'missing limbs',
    'blurry', 'low quality', 'lowres', 'watermark', 'signature',
    'text', 'error', 'cropped', 'out of frame', 'ugly', 'bad hands',
    'extra fingers', 'mutation', 'mutated',
  ].join(', ');

  // ── 6. Stage the avatar prompt card in the chat ───────────────────────────
  const avatarPrompt = { positivePrompt, negativePrompt, style, emphasis, charName };

  try {
    const { renderAvatarPromptCard } = await import('../ui/chat.js');
    renderAvatarPromptCard(avatarPrompt);
  } catch (e) {
    console.error('[CCS] Failed to render avatar prompt card:', e);
    // Fallback: return the prompts as text
    return {
      result: [
        `🖼️ **Avatar Prompt Ready for ${charName}**`,
        '',
        `**Style:** ${style} | **Emphasis:** ${emphasis}`,
        '',
        `**Positive:** ${positivePrompt}`,
        '',
        `**Negative:** ${negativePrompt}`,
        '',
        '_Open the Lore Graph → Avatar tab, or paste the positive prompt into ST\'s /sd command to generate._',
      ].join('\n'),
    };
  }

  return {
    result: `Avatar prompt card rendered in the chat for **${charName}**. The user can now edit the prompts or click "Generate Avatar" to create the image.`,
  };
}
