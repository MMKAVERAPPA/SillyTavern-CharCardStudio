/**
 * CharCardStudio v4.0.0 — Tool Implementations
 * 
 * All 10 tools that the agent can call. Each tool receives parameters
 * and returns a result string that gets injected back into the conversation.
 * 
 * Write operations are STAGED — they create drafts that the user must approve.
 */

import { getSession, updateSession } from './session.js';
import { getCtx } from '../index.js';

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
  character_note:      'depth_prompt_prompt',   // nested in depth_prompt object
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
  
  if (!field || !VALID_FIELDS.has(field)) {
    return { result: `Error: Invalid field "${field}". Valid fields: ${[...VALID_FIELDS].join(', ')}` };
  }
  if (!content) {
    return { result: 'Error: content parameter is required.' };
  }

  const session = getSession();
  const draft = {
    id: `draft_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    field,
    content,
    greetingIndex: greeting_index,
    status: 'pending',
    createdAt: Date.now(),
  };

  // Count tokens if available
  try {
    const ctx = getCtx();
    if (ctx?.getTokenCountAsync) {
      draft.tokenCount = await ctx.getTokenCountAsync(content);
    }
  } catch (e) { /* token counting is optional */ }

  // Save draft to session
  const drafts = session.cardDrafts || {};
  const key = field === 'alternate_greetings' ? `${field}_${greeting_index || 0}` : field;
  drafts[key] = draft;
  await updateSession({ cardDrafts: drafts });

  return {
    result: `Draft created for "${field}" (${draft.tokenCount || '?'} tokens). Waiting for user approval.`,
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
  const { pillar_id, status, summary } = params;
  if (!pillar_id || !status) {
    return { result: 'Error: pillar_id and status are required.' };
  }

  const session = getSession();
  const pillars = session.pillarStates || [];
  
  let pillar = pillars.find(p => p.id === pillar_id);
  if (!pillar) {
    // Create new pillar
    pillar = { id: pillar_id, status, summary: summary || '' };
    pillars.push(pillar);
  } else {
    pillar.status = status;
    if (summary) pillar.summary = summary;
  }

  await updateSession({ pillarStates: pillars });
  return { result: `Pillar "${pillar_id}" updated to ${status}.` };
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
    category: params.category || '',
    constant: params.constant || false,
    position: params.position || 'after_char',
    order: params.order || 100,
    status: 'pending',
    createdAt: Date.now(),
  };

  const loreDrafts = session.loreDrafts || [];
  loreDrafts.push(draft);
  await updateSession({ loreDrafts });

  return {
    result: `Lore entry "${name}" staged for approval. Keys: [${keys.join(', ')}]. ${params.constant ? '(Constant)' : '(Triggered)'}`,
    draft,
  };
}

// ─── Tool 5: Read Lore Entries ──────────────────────────────────────────────

async function toolReadLoreEntries(params) {
  const ctx = getCtx();
  if (!ctx) return { result: 'Error: SillyTavern context not available.' };

  // Try to get character's lorebook
  try {
    const charId = ctx.characterId;
    const char = ctx.characters?.[charId];
    if (!char) return { result: 'No character loaded.' };

    // Access world info / lorebook data
    const book = char.data?.character_book;
    if (!book?.entries?.length) {
      return { result: 'No lorebook entries found for this character.' };
    }

    const entries = Object.values(book.entries);
    const lines = entries.map(e => {
      const keys = e.keys?.join(', ') || 'none';
      const content = params.include_content !== false 
        ? `\n  Content: ${String(e.content).substring(0, 300)}` 
        : '';
      return `• ${e.comment || e.name || 'Untitled'} [keys: ${keys}]${content}`;
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
  // Stub for Phase B — conflict detection is Phase E
  return { result: `Conflict resolution noted. This feature will be fully available in a future update.` };
}

// ─── Tool 9: Update Memory ─────────────────────────────────────────────────

async function toolUpdateMemory(params) {
  const { type, content, action = 'add' } = params;
  if (!type || !content) {
    return { result: 'Error: type and content are required.' };
  }

  const session = getSession();
  const memory = session.memory || { global: '', perCharacter: '' };

  const target = type === 'global_rule' ? 'global' : 'perCharacter';

  if (action === 'add') {
    memory[target] = memory[target] 
      ? `${memory[target]}\n- ${content}` 
      : `- ${content}`;
  } else if (action === 'remove') {
    const lines = memory[target].split('\n').filter(l => !l.includes(content));
    memory[target] = lines.join('\n');
  }

  await updateSession({ memory });
  return { result: `Memory ${action === 'add' ? 'added' : 'removed'}: ${content}` };
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
    console.error('[CCS] Draft not found:', draftId);
    return false;
  }

  const ctx = getCtx();
  if (!ctx) return false;

  const charId = ctx.characterId;
  const char = ctx.characters?.[charId];
  if (!char?.avatar) return false;

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

    const resp = await fetch('/api/characters/merge-attributes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...ctx.getRequestHeaders(),
      },
      body,
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('[CCS] Merge failed:', resp.status, errText);
      return false;
    }

    // Mark draft as applied
    draft.status = 'applied';
    await updateSession({ cardDrafts: drafts });
    
    console.log(`[CCS] Applied draft for ${draft.field}`);
    return true;
  } catch (err) {
    console.error('[CCS] Apply draft error:', err);
    return false;
  }
}

/**
 * Apply a staged lore draft to the ST lorebook.
 * @param {string} draftId 
 * @returns {Promise<boolean>}
 */
export async function applyLoreDraft(draftId) {
  const session = getSession();
  const loreDrafts = session.loreDrafts || [];
  const draft = loreDrafts.find(d => d.id === draftId);
  if (!draft) return false;

  // Lore CRUD uses ST world-info APIs — stub for now
  // Will be fully implemented in Phase C
  draft.status = 'applied';
  await updateSession({ loreDrafts });
  console.log(`[CCS] Lore draft ${draft.type} applied (stub):`, draft.name || draft.uid);
  return true;
}
