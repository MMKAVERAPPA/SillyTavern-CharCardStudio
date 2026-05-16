// core/parser.js
// All text parsing: code blocks, fields, lorebook entries, concept ratings

import { CARD_FIELDS } from './card.js';
import { intentEngine } from './intent-engine.js';

export function extractCodeBlock(text) {
    if (!text) return '';
    const match = text.match(/```(?:\w+)?\n?([\s\S]*?)```/);
    return match ? match[1].trim() : text.trim();
}

export function extractAllCodeBlocks(text) {
    if (!text) return [];
    const results = [];
    const pattern = /```(\w+)?\n?([\s\S]*?)```/g;
    let match;
    while ((match = pattern.exec(text)) !== null) {
        results.push({ lang: match[1] || 'text', content: match[2].trim() });
    }
    return results;
}

export function parseMultiFieldResponse(text) {
    const result = {};
    const pattern = /##\s+(\w+)\s*\n```(?:\w+)?\n?([\s\S]*?)```/g;
    let match;
    while ((match = pattern.exec(text)) !== null) {
        const fieldName = match[1].toLowerCase().trim();
        if (CARD_FIELDS.includes(fieldName)) {
            result[fieldName] = match[2].trim();
        }
    }
    return result;
}

export function parseBatchGreetingResponse(text) {
    const results = [];
    const pattern = /\*?\*?\[(\d+)\]\*?\*?[:\s]*```(?:\w+)?\n?([\s\S]*?)```/g;
    let match;
    while ((match = pattern.exec(text)) !== null) {
        results.push({ index: parseInt(match[1]), content: match[2].trim() });
    }
    if (!results.length) {
        extractAllCodeBlocks(text).forEach((b, i) => results.push({ index: i, content: b.content }));
    }
    return results;
}

export function parseLorebookEntryBlock(text) {
    if (!text?.trim()) return null;

    const extract = (pattern, def = '') => {
        const m = text.match(pattern);
        return m ? m[1].trim() : def;
    };
    const extractBool = (pattern) => {
        const m = text.match(pattern);
        return m ? m[1].trim().toLowerCase().startsWith('yes') : false;
    };

    const comment = extract(/\*\*Comment\/Title:\*\*\s*(.+)/);
    if (!comment) return null;

    const primaryKeysRaw  = extract(/\*\*Primary Keys:\*\*\s*(.+)/);
    const secondaryKeysRaw = extract(/\*\*Secondary Keys:\*\*\s*(.+)/);
    const filterRaw       = extract(/\*\*Optional Filter:\*\*\s*(.+)/);
    const positionStr     = extract(/\*\*Position:\*\*\s*(.+)/);
    const depthStr        = extract(/\*\*Depth:\*\*\s*(\d+)/);
    const orderStr        = extract(/\*\*Insertion Order:\*\*\s*(\d+)/);
    const probabilityStr  = extract(/\*\*Probability:\*\*\s*(\d+)/);
    const categoryStr     = extract(/\*\*Category:\*\*\s*(.+)/);
    const isConstant      = extractBool(/\*\*Constant:\*\*\s*(.+)/);
    const caseSensitive   = extractBool(/\*\*Case Sensitive:\*\*\s*(.+)/);
    const excludeRecursion = extractBool(/\*\*Exclude from Recursion:\*\*\s*(.+)/);
    const preventRecursion = extractBool(/\*\*Prevent Further Recursion:\*\*\s*(.+)/);
    const stickyStr       = extract(/\*\*Sticky:\*\*\s*(\d+)/);
    const cooldownStr     = extract(/\*\*Cooldown:\*\*\s*(\d+)/);
    const delayStr        = extract(/\*\*Delay:\*\*\s*(\d+)/);
    const groupStr        = extract(/\*\*Inclusion Group:\*\*\s*(.+)/);

    const contentMatch = text.match(/```(?:\w+)?\n?([\s\S]*?)```/);
    const content = contentMatch ? contentMatch[1].trim() : '';

    const positionMap = {
        'before char defs': 0, 'before char': 0,
        'after char defs': 1, 'after char': 1,
        'before examples': 2, 'before example messages': 2,
        'after examples': 3, 'after example messages': 3,
        'an top': 4, 'top of an': 4,
        'an bottom': 5, 'bottom of an': 5,
        'at depth': 6, 'depth': 6,
        'outlet': 7,
    };
    const position = positionMap[(positionStr || '').toLowerCase().trim()] ?? 1;

    const parseKeys = (raw) => {
        if (!raw || ['none','n/a',''].includes(raw.toLowerCase().trim())) return [];
        return raw.split(',').map(k => k.trim()).filter(Boolean);
    };

    const parsedKeys = parseKeys(primaryKeysRaw);
    const parsedSecondaryKeys = parseKeys(secondaryKeysRaw);

    let filterLogic = 0; // AND ANY
    let filterKeys = [];
    if (filterRaw && !['none','n/a',''].includes(filterRaw.toLowerCase().trim())) {
        const parts = filterRaw.split(':');
        if (parts.length > 1) {
            const logicStr = parts[0].trim().toUpperCase();
            if (logicStr === 'AND ALL') filterLogic = 3;
            else if (logicStr === 'NOT ANY') filterLogic = 1;
            else if (logicStr === 'NOT ALL') filterLogic = 2;
            filterKeys = parseKeys(parts.slice(1).join(':'));
        } else {
            filterKeys = parseKeys(filterRaw);
        }
    }

    return {
        _tempId: Date.now() + Math.random(),
        comment,
        keys: parsedKeys,
        secondary_keys: parsedSecondaryKeys,
        content,
        position,
        depth: parseInt(depthStr) || 4,
        insertion_order: parseInt(orderStr) || 100,
        constant: isConstant,
        probability: parseInt(probabilityStr) || 100,
        case_sensitive: caseSensitive,
        excludeRecursion,
        preventRecursion,
        selective: parsedSecondaryKeys.length > 0,
        selectiveLogic: 0,
        filterLogic,
        filterKeys,
        sticky: parseInt(stickyStr) || 0,
        cooldown: parseInt(cooldownStr) || 0,
        delay: parseInt(delayStr) || 0,
        group: (!groupStr || ['none','n/a',''].includes(groupStr.toLowerCase().trim())) ? '' : groupStr.trim(),
        enabled: true,
        category: categoryStr || 'General',
    };
}

export function parseLorebookEntriesFromResponse(text) {
    if (!text) return [];
    const entries = [];
    const blocks = text.split(/---\s*\n\s*\*\*Entry:/i);
    for (let i = 0; i < blocks.length; i++) {
        const block = i === 0 ? blocks[i] : '**Entry:' + blocks[i];
        try {
            const entry = parseLorebookEntryBlock(block);
            if (entry?.comment) entries.push(entry);
        } catch (e) {
            console.warn('[CCS Parser] Failed to parse entry block:', e);
        }
    }
    if (!entries.length) {
        const single = parseLorebookEntryBlock(text);
        if (single) entries.push(single);
    }
    return entries;
}

export function parseConceptRating(text) {
    if (!text) return null;
    const result = { conceptName: '', scores: {}, overall: '', pillars: [] };

    // BUG-7 FIX: Match quoted AND unquoted concept names, with or without emoji prefix
    const nameMatch = text.match(/(?:💡\s*)?Concept:\s*"([^"]+)"/)
        || text.match(/(?:💡\s*)?Concept:\s*([^\n"]{2,60})/)
        || text.match(/\*\*([^*]{2,60})\*\*/);
    if (nameMatch) result.conceptName = nameMatch[1].trim().replace(/[*_]/g, '');

    // BUG-7 FIX: Accept ★, ⭐, ✦, or numeric ratings like "4/5" or "(4)"
    const countStars = (str) => {
        if (!str) return 0;
        const filled = (str.match(/★|⭐|✦/g) || []).length;
        if (filled) return filled;
        const numeric = str.match(/(\d)\s*\/\s*5/) || str.match(/\((\d)\)/);
        if (numeric) return parseInt(numeric[1]);
        return 0;
    };

    // BUG-7 FIX: Fuzzy axis matching — partial names, case-insensitive, any order
    const axisPatterns = [
        { key: 'Hook Strength',    pats: [/hook\s*strength/i, /hook/i] },
        { key: 'Longevity/Depth',  pats: [/longevity.*depth/i, /longevity/i, /depth/i] },
        { key: 'Originality',      pats: [/original/i] },
        { key: 'RP Potential',     pats: [/rp\s*potential/i, /roleplay\s*potential/i, /rp/i] },
        { key: 'Platform Appeal',  pats: [/platform\s*appeal/i, /platform/i, /appeal/i] },
    ];

    for (const { key, pats } of axisPatterns) {
        for (const pat of pats) {
            // Find the line that matches the axis name
            const lineMatch = text.match(new RegExp(pat.source + '[^\n]*?([★⭐✦☆]+|\\d\\s*\\/\\s*5)', 'i'));
            if (lineMatch) {
                result.scores[key] = countStars(lineMatch[0]);
                break;
            }
        }
    }

    const overallMatch = text.match(/Overall:\s*(.+?)(?:\n|$)/);
    if (overallMatch) result.overall = overallMatch[1].trim();

    // BUG-7 FIX & v3.4 FIX: Anchor pillar parsing to the specific section to avoid catching table rows
    const pillarsSectionMatch = text.match(/structural pillars[^:]*:?([\s\S]*?)(?:\n\n(?:Then|Next|After|---)|$)/i);
    const pillarText = pillarsSectionMatch ? pillarsSectionMatch[1] : text;

    // Try multiple formats
    const pillarMatches = [...pillarText.matchAll(/^[\s]*[□•\-\*▪▫]\s+(.+)/gm)];
    const numberedPillars = [...pillarText.matchAll(/^\s*\d+\.\s+(.+)/gm)];
    const questionMarks = [...pillarText.matchAll(/^[\s]*[❓❔⁇⁈]\s*(.+)/gm)];
    
    // NEW: Table format detection (| Pillar | Description |)
    const tableRows = [...pillarText.matchAll(/^\|\s*([^|]+?)\s*\|[^\n]+$/gm)];
    const tablePillars = tableRows
        .map(m => m[1].trim())
        .filter(name => {
            const lower = name.toLowerCase();
            const cleaned = name.replace(/[*_\-]/g, '').trim();
            
            // Skip if too short/long
            if (cleaned.length < 5 || cleaned.length > 200) return false;
            
            // Skip headers
            if (lower.includes('pillar') || lower.includes('what it') || lower.includes('description')) return false;
            
            // Skip separators (all dashes)
            if (/^[\-=_]+$/.test(cleaned)) return false;
            
            // Skip field names (common card fields)
            const fieldNames = ['description', 'personality', 'scenario', 'first mes', 'first_mes', 
                              'mes example', 'mes_example', 'system prompt', 'system_prompt',
                              'alternate greetings', 'creator notes', 'tags', 'name', 'issue', 
                              'field', 'component', 'status', 'missing', 'incomplete'];
            if (fieldNames.some(f => lower === f || lower.includes(f + ' ('))) return false;
            
            // Skip if looks like a status/label (starts with uppercase word then lowercase)
            if (/^[A-Z][a-z]+\s*\/\s*[A-Z][a-z]+/.test(name)) return false; // "Missing / Incomplete"
            
            return true;
        });
    
    const allPillarLines = [...pillarMatches, ...numberedPillars, ...questionMarks];
    
    console.log('[CCS Parser] Pillar detection:', {
        pillarsSectionFound: !!pillarsSectionMatch,
        bulletMatches: pillarMatches.length,
        numberedMatches: numberedPillars.length,
        questionMatches: questionMarks.length,
        tableMatches: tablePillars.length,
        totalMatches: allPillarLines.length + tablePillars.length
    });
    
    // Combine all formats with strict filtering
    const isValidPillar = (name) => {
        const lower = name.toLowerCase();
        const cleaned = name.replace(/[*_\-]/g, '').trim();
        
        // Skip if too short/long
        if (cleaned.length < 5 || cleaned.length > 200) return false;
        
        // Skip separators (all dashes/equals)
        if (/^[\-=_]+$/.test(cleaned)) return false;
        
        // Skip field names (common card fields)
        const fieldNames = ['description', 'personality', 'scenario', 'first mes', 'first_mes', 
                          'mes example', 'mes_example', 'system prompt', 'system_prompt',
                          'alternate greetings', 'creator notes', 'tags', 'name', 'issue', 
                          'field', 'component', 'status', 'missing', 'incomplete', 'tracker',
                          'total', 'permanent', 'optional'];
        if (fieldNames.some(f => lower === f || lower.startsWith('**' + f))) return false;
        
        // Skip if looks like a status/label
        if (/^[A-Z][a-z]+\s*\/\s*[A-Z][a-z]+/.test(name)) return false; // "Missing / Incomplete"
        
        // Skip if looks like an instruction (starts with "Fix:", "Add:", etc.)
        if (/^(Fix|Add|Create|Update|Remove|Delete|Check|Verify):/i.test(cleaned)) return false;
        
        return true;
    };
    
    result.pillars = [
        ...allPillarLines.map(m => {
            let name = m[1].trim().replace(/[*_]/g, '');
            name = name.replace(/^(What|How|Why|Where|When|Who)\s+(is|are|would|does|do|should|can)/i, (match) => match);
            return { name, resolved: false, answer: '' };
        }),
        ...tablePillars.map(name => ({ name, resolved: false, answer: '' }))
    ].filter(p => isValidPillar(p.name));

    // Fallback: if no pillars found, try to extract questions from text
    if (result.pillars.length === 0) {
        console.log('[CCS Parser] No pillars found via bullets/tables, trying question extraction');
        const questions = [...pillarText.matchAll(/(\w[^?]{10,150}\?)(?:\s|$)/g)];
        result.pillars = questions
            .map(m => ({ name: m[0].trim(), resolved: false, answer: '' }))
            .filter(p => p.name.length > 10)
            .slice(0, 5);
    }

    console.log('[CCS Parser] Final pillars found:', result.pillars.length, result.pillars.map(p => p.name));
    return result;
}

export function parseLorePlan(text) {
    if (!text) return [];
    const entries = [];
    
    // Try structured line format first: - Entry Title | 🌍 World/Setting | Constant | ~80t | description
    const linePattern = /^-\s+(.+?)\s*\|\s*(.+?)\s*\|\s*(Constant|Triggered)\s*\|\s*~?(\d+)t\s*\|\s*(.+)$/gim;
    let match;
    while ((match = linePattern.exec(text)) !== null) {
        entries.push({
            title: match[1].trim(),
            category: match[2].trim(),
            activation: match[3].trim(),
            estimatedTokens: parseInt(match[4]),
            description: match[5].trim(),
        });
    }
    
    // NEW: Try table format if no structured lines found
    if (!entries.length) {
        // Table row format: | Entry Title | Category | Activation | Tokens | Description |
        const tablePattern = /^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*(Constant|Triggered|[^|]+?)\s*\|\s*~?(\d+)t?\s*\|\s*([^|]+?)\s*\|$/gim;
        while ((match = tablePattern.exec(text)) !== null) {
            const title = match[1].trim();
            // Skip header rows
            if (title.toLowerCase().includes('entry') || title.toLowerCase().includes('title') || title === '---') continue;
            entries.push({
                title,
                category: match[2].trim(),
                activation: match[3].trim(),
                estimatedTokens: parseInt(match[4]) || 80,
                description: match[5].trim(),
            });
        }
    }
    
    // Fallback: if no structured entries found, try to extract just titles from bullets/numbers
    if (!entries.length) {
        const bulletPattern = /^[-•*]\s+(.{5,80})$/gm;
        const numberedPattern = /^\d+\.\s+(.{5,80})$/gm;
        let m;
        // Try bullets
        while ((m = bulletPattern.exec(text)) !== null) {
            const line = m[1].trim();
            if (!line.includes('|') && !line.toLowerCase().startsWith('each') && !line.toLowerCase().startsWith('for')) {
                entries.push({ title: line, category: 'General', activation: 'Triggered', estimatedTokens: 80, description: '' });
            }
        }
        // Try numbered
        while ((m = numberedPattern.exec(text)) !== null) {
            const line = m[1].trim();
            if (!line.includes('|') && !line.toLowerCase().startsWith('each') && !line.toLowerCase().startsWith('for')) {
                entries.push({ title: line, category: 'General', activation: 'Triggered', estimatedTokens: 80, description: '' });
            }
        }
    }
    
    console.log(`[CCS Parser] Lorebook plan parsed: ${entries.length} entries found`);
    return entries;
}


export function parseCardReview(text) {
    if (!text) return { raw: text };
    const overallMatch = text.match(/Overall:\s*([★☆]+)/);
    const errorMatch   = text.match(/🔴 Errors Found:\s*(\d+)/);
    const warningMatch = text.match(/🟡 Warnings:\s*(\d+)/);
    const suggMatch    = text.match(/💡 Suggestions?:\s*(\d+)/);
    return {
        raw: text,
        overall: overallMatch?.[1] || '',
        errorCount: parseInt(errorMatch?.[1]) || 0,
        warningCount: parseInt(warningMatch?.[1]) || 0,
        suggestionCount: parseInt(suggMatch?.[1]) || 0,
    };
}

export function detectFieldFromMessage(text) {
    const intent = intentEngine.detect(text);
    if ((intent.type === 'generate_field' || intent.type === 'rewrite_field') && intent.target) {
        return intent.target;
    }
    return null;
}

export function isBatchGreetingOp(text) {
    const intent = intentEngine.detect(text);
    return intent.type === 'batch_greetings';
}

export function isGenerateAllRequest(text) {
    const intent = intentEngine.detect(text);
    return intent.type === 'generate_all';
}

export function detectPhaseSwitch(text) {
    const intent = intentEngine.detect(text);
    if (intent.type === 'phase_switch' && intent.target) {
        return intent.target;
    }
    const lower = text.toLowerCase();
    if (['start building','start writing','let\'s build','begin writing','ready to write','fill the fields','approve'].some(s => lower.includes(s))) return 'build_start';
    return null;
}
