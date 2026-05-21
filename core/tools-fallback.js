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
    if (obj.name) return { name: obj.name, parameters: obj.parameters || {} };
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
      if (obj.name) return { name: obj.name, parameters: obj.parameters || {} };
      
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

  return null;
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
