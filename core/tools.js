/**
 * CharCardStudio v4.0.0 — Tool Implementations
 * 
 * All 10 tools that the agent can call. Each tool receives parameters
 * and returns a result string that gets injected back into the conversation.
 * 
 * Write operations are STAGED — they create drafts that the user must approve.
 */

import { getSession, updateSession, hashString } from './session.js';
import { getCtx } from '../index.js';
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
  ccs_write_field:      toolWriteField,
  ccs_read_field:       toolReadField,
  ccs_update_pillar:    toolUpdatePillar,
  ccs_create_lore_entry:toolCreateLoreEntry,
  ccs_read_lore_entries:toolReadLoreEntries,
  ccs_update_lore_entry:toolUpdateLoreEntry,
  ccs_delete_lore_entry:toolDeleteLoreEntry,
  ccs_resolve_conflict: toolResolveConflict,
  ccs_update_memory:    toolUpdateMemory,
  ccs_audit_card:       toolAuditCard,
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
    const entries = await getLorebookEntries();
    
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
