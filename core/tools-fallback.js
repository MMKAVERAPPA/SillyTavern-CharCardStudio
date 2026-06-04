/**
 * CharCardStudio v4.0.0 — Tool Call Fallback Parser
 * 
 * Parses <tool_call> XML blocks from AI response text.
 * This is the PRIMARY tool calling method — works across all backends.
 * 
 * Strategies:
 *   A) Well-formed: <tool_call>{ JSON with "name" }</tool_call>
 *   B) Unclosed: <tool_call>{ JSON with "name" } (no closing tag)
 *   C) Multiple tool calls in one response
 */

/**
 * Parse all tool calls from a response string.
 * @param {string} text - Full AI response text
 * @returns {{ toolCalls: Array<{name: string, parameters: object}>, prose: string }}
 */
export function parseToolCalls(text) {
  if (!text || !text.includes('<tool_call>')) {
    return { toolCalls: [], prose: text || '' };
  }

  const toolCalls = [];
  const segments = text.split('<tool_call>');
  
  // Everything before the first <tool_call> is prose
  let prose = segments[0] || '';

  for (let i = 1; i < segments.length; i++) {
    const segment = segments[i];
    
    // Remove closing tag if present
    let jsonPart = segment;
    const closeIdx = segment.indexOf('</tool_call>');
    if (closeIdx !== -1) {
      jsonPart = segment.substring(0, closeIdx);
      // Any text after </tool_call> is also prose
      const afterClose = segment.substring(closeIdx + '</tool_call>'.length);
      if (afterClose.trim()) prose += '\n' + afterClose;
    }

    // Clean up the JSON
    jsonPart = jsonPart.trim();
    
    // Try to parse it
    const parsed = _tryParseToolCall(jsonPart);
    if (parsed) {
      toolCalls.push(parsed);
    }
  }

  // Normalise any tool names the model may have mangled
  for (const tc of toolCalls) {
    tc.name = _normalizeToolName(tc.name);
  }

  return { toolCalls, prose: prose.trim() };
}

/**
 * Try to parse a single tool call JSON block.
 * Handles multiple formats models actually produce:
 *   A) Standard: {"name": "tool_name", "parameters": {...}}
 *   B) Name outside JSON: tool_name {"param": "value"}
 *   C) Name outside JSON with parens: tool_name({"param": "value"})
 *   D) Just extract { } and look for "name" key
 */
function _tryParseToolCall(raw) {
  if (!raw) return null;

  // Clean whitespace
  raw = raw.trim();

  // Strategy A: Direct JSON parse — standard format
  try {
    const obj = JSON.parse(raw);
    if (obj.name) return { name: obj.name, parameters: obj.parameters || obj.arguments || {} };
  } catch (e) { /* continue */ }

  // Strategy B: tool_name {params} or tool_name({params})
  // Match: optional word characters, then JSON object
  const nameJsonMatch = raw.match(/^([a-z_][a-z0-9_]*)\s*\(?\s*(\{[\s\S]*\})\s*\)?$/i);
  if (nameJsonMatch) {
    const toolName = nameJsonMatch[1];
    try {
      const params = JSON.parse(nameJsonMatch[2]);
      return { name: toolName, parameters: params };
    } catch (e) { /* continue */ }
  }

  // Strategy C: Extract JSON object from anywhere in the text
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const jsonStr = raw.substring(firstBrace, lastBrace + 1);
    try {
      const obj = JSON.parse(jsonStr);
      // If it has a "name" key, it's the standard format
      if (obj.name) return { name: obj.name, parameters: obj.parameters || obj.arguments || {} };
      
      // If no "name" key, check if there's a tool name before the brace
      const prefix = raw.substring(0, firstBrace).trim();
      const prefixName = prefix.match(/([a-z_][a-z0-9_]*)\s*\(?\s*$/i);
      if (prefixName) {
        return { name: prefixName[1], parameters: obj };
      }
    } catch (e) { /* continue */ }
  }

  // Strategy D: Multi-line — tool name on first line, JSON on subsequent lines
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length >= 2) {
    const potentialName = lines[0].replace(/[^a-z0-9_]/gi, '');
    const restJson = lines.slice(1).join('\n');
    const fb = restJson.indexOf('{');
    const lb = restJson.lastIndexOf('}');
    if (fb !== -1 && lb >= fb && potentialName.startsWith('ccs_')) {
      try {
        const params = JSON.parse(restJson.substring(fb, lb + 1));
        return { name: potentialName, parameters: params };
      } catch (e) { /* give up */ }
    }
  }

  // Strategy E: XML-style <arg_key>...</arg_key><arg_value>...</arg_value>
  // Common for GLM and some other models that natively intercept <tool_call>
  if (raw.includes('<arg_key>')) {
    const xmlNameMatch = raw.match(/^([a-z_][a-z0-9_]*)/i);
    if (xmlNameMatch) {
      const toolName = xmlNameMatch[1];
      const params = {};
      const keyRegex = /<arg_key>([^<]+)<\/arg_key>\s*<arg_value>([\s\S]*?)<\/arg_value>/gi;
      let match;
      let hasArgs = false;
      while ((match = keyRegex.exec(raw)) !== null) {
        params[match[1]] = match[2];
        hasArgs = true;
      }
      if (hasArgs) {
        return { name: toolName, parameters: params };
      }
    }
  }

  // Strategy F: Generic XML tags <name>tool</name> <param1>value1</param1>
  const xmlToolMatch = raw.match(/<(?:name|tool_name|tool)>\s*(ccs_[a-z0-9_]+)\s*<\/(?:name|tool_name|tool)>/i);
  if (xmlToolMatch) {
    const toolName = xmlToolMatch[1];
    const params = {};
    const paramRegex = /<([a-z_][a-z0-9_]*)>([\s\S]*?)<\/\1>/gi;
    let match;
    while ((match = paramRegex.exec(raw)) !== null) {
      const key = match[1];
      if (['name', 'tool_name', 'tool'].includes(key.toLowerCase())) continue;
      params[key] = match[2].trim();
    }
    return { name: toolName, parameters: params };
  }

  // Strategy G: Tool name as XML tag <ccs_write_field><param1>...</param1></ccs_write_field>
  const toolAsTagMatch = raw.match(/<(ccs_[a-z0-9_]+)>([\s\S]*?)<\/\1>/i);
  if (toolAsTagMatch) {
    const toolName = toolAsTagMatch[1];
    const innerContent = toolAsTagMatch[2];
    const params = {};
    const paramRegex = /<([a-z_][a-z0-9_]*)>([\s\S]*?)<\/\1>/gi;
    let match;
    let hasArgs = false;
    while ((match = paramRegex.exec(innerContent)) !== null) {
      params[match[1]] = match[2].trim();
      hasArgs = true;
    }
    if (hasArgs) {
       return { name: toolName, parameters: params };
    }
  }

  return null;
}

// ─── Tool Name Normalizer ────────────────────────────────────────────────────

/**
 * Map common model misspellings / variations to the canonical tool name.
 * Some models drop underscores, pluralise, or vary capitalisation.
 * @param {string} name
 * @returns {string}
 */
function _normalizeToolName(name) {
  if (!name) return name;

  // Lowercase and strip leading/trailing whitespace first
  const n = name.toLowerCase().trim();

  const MAP = {
    // write_field variants
    'ccs_writefield':              'ccs_write_field',
    'ccs_write_fields':            'ccs_write_field',
    'ccs_writefiled':              'ccs_write_field',
    'ccs_write_filed':             'ccs_write_field',
    'ccs_writefieldcontent':       'ccs_write_field',
    // read_field variants
    'ccs_readfield':               'ccs_read_field',
    'ccs_read_fields':             'ccs_read_field',
    'ccs_readfields':              'ccs_read_field',
    // update_pillar variants
    'ccs_updatepillar':            'ccs_update_pillar',
    'ccs_update_pillars':          'ccs_update_pillar',
    'ccs_pillar_update':           'ccs_update_pillar',
    // batch_pillars variants
    'ccs_batchpillars':            'ccs_batch_pillars',
    'ccs_batch_pillar':            'ccs_batch_pillars',
    'ccs_pillars_batch':           'ccs_batch_pillars',
    'ccs_batch_update_pillars':    'ccs_batch_pillars',
    // switch_phase variants
    'ccs_switchphase':             'ccs_switch_phase',
    'ccs_switch_phases':           'ccs_switch_phase',
    'ccs_phase_switch':            'ccs_switch_phase',
    'ccs_changephase':             'ccs_switch_phase',
    'ccs_change_phase':            'ccs_switch_phase',
    'ccs_setphase':                'ccs_switch_phase',
    'ccs_set_phase':               'ccs_switch_phase',
    // write_brief variants
    'ccs_writebrief':              'ccs_write_brief',
    'ccs_write_briefs':            'ccs_write_brief',
    'ccs_updatebrief':             'ccs_write_brief',
    'ccs_update_brief':            'ccs_write_brief',
    'ccs_concept_brief':           'ccs_write_brief',
    'ccs_write_concept_brief':     'ccs_write_brief',
    // read_brief variants
    'ccs_readbrief':               'ccs_read_brief',
    'ccs_get_brief':               'ccs_read_brief',
    'ccs_read_concept_brief':      'ccs_read_brief',
    // update_memory variants
    'ccs_updatememory':            'ccs_update_memory',
    'ccs_update_memories':         'ccs_update_memory',
    'ccs_save_memory':             'ccs_update_memory',
    'ccs_savememory':              'ccs_update_memory',
    'ccs_add_memory':              'ccs_update_memory',
    // lore entry variants
    'ccs_create_lore':             'ccs_create_lore_entry',
    'ccs_createloreentry':         'ccs_create_lore_entry',
    'ccs_add_lore_entry':          'ccs_create_lore_entry',
    'ccs_addloreentry':            'ccs_create_lore_entry',
    'ccs_read_lore':               'ccs_read_lore_entries',
    'ccs_readloreentries':         'ccs_read_lore_entries',
    'ccs_get_lore_entries':        'ccs_read_lore_entries',
    'ccs_update_lore':             'ccs_update_lore_entry',
    'ccs_updateloreentry':         'ccs_update_lore_entry',
    'ccs_delete_lore':             'ccs_delete_lore_entry',
    'ccs_deleteloreentry':         'ccs_delete_lore_entry',
    'ccs_remove_lore_entry':       'ccs_delete_lore_entry',
    // semantic_search variants
    'ccs_semanticsearch':          'ccs_semantic_search',
    'ccs_search':                  'ccs_semantic_search',
    'ccs_keyword_search':          'ccs_semantic_search',
    'ccs_find':                    'ccs_semantic_search',
    // set_card_type variants
    'ccs_setcardtype':             'ccs_set_card_type',
    'ccs_set_type':                'ccs_set_card_type',
    'ccs_cardtype':                'ccs_set_card_type',
    // set_platform variants
    'ccs_setplatform':             'ccs_set_platform',
    'ccs_platform':                'ccs_set_platform',
    // optimize_tokens
    'ccs_optimizetokens':          'ccs_optimize_tokens',
    'ccs_optimize':                'ccs_optimize_tokens',
    'ccs_token_optimize':          'ccs_optimize_tokens',
    // audit / review
    'ccs_auditcard':               'ccs_audit_card',
    'ccs_audit':                   'ccs_audit_card',
    'ccs_reviewcard':              'ccs_audit_card',
    'ccs_submitreview':            'ccs_submit_review',
    'ccs_submit_scorecard':        'ccs_submit_review',
    // lore graph
    'ccs_readloregraph':           'ccs_read_lore_graph',
    'ccs_lore_graph':              'ccs_read_lore_graph',
    'ccs_suggestloreconnections':  'ccs_suggest_lore_connections',
    'ccs_lore_connections':        'ccs_suggest_lore_connections',
    'ccs_suggest_connections':     'ccs_suggest_lore_connections',
    // resolve_conflict
    'ccs_resolveconflict':         'ccs_resolve_conflict',
    'ccs_resolve':                 'ccs_resolve_conflict',
    // generate_avatar_prompt
    'ccs_generateavatarprompt':    'ccs_generate_avatar_prompt',
    'ccs_avatar_prompt':           'ccs_generate_avatar_prompt',
    'ccs_generate_avatar':         'ccs_generate_avatar_prompt',
    'ccs_avatar':                  'ccs_generate_avatar_prompt',
    // write_lore_plan
    'ccs_writeloreplan':           'ccs_write_lore_plan',
    'ccs_save_lore_plan':          'ccs_write_lore_plan',
    'ccs_saveloreplan':            'ccs_write_lore_plan',
    'ccs_lore_plan':               'ccs_write_lore_plan',
    'ccs_update_lore_plan':        'ccs_write_lore_plan',
    // read_lore_plan
    'ccs_readloreplan':            'ccs_read_lore_plan',
    'ccs_get_lore_plan':           'ccs_read_lore_plan',
    'ccs_getloreplan':             'ccs_read_lore_plan',
    // read_lore_entries (common missing s-variant)
    'ccs_read_lore_entry':         'ccs_read_lore_entries',
    'ccs_list_lore_entries':       'ccs_read_lore_entries',
    'ccs_listloreentries':         'ccs_read_lore_entries',
  };

  return MAP[n] || n;
}

/**
 * Strip tool call blocks from text, returning only the prose content.
 * @param {string} text - Full AI response
 * @returns {string} Text with all <tool_call>...</tool_call> blocks removed
 */
export function stripToolCallBlocks(text) {
  if (!text) return '';
  const { prose } = parseToolCalls(text);
  return prose;
}

/**
 * Build the tool call instruction text for injection into prompts.
 * Reminds the AI how to format tool calls.
 */
export function getToolCallInstructions() {
  return `When you need to perform an action, output a tool_call block:
<tool_call>
{"name": "tool_name", "parameters": {"key": "value"}}
</tool_call>
You may include explanatory text before or after tool calls.`;
}
