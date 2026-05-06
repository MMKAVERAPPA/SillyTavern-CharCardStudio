// core/parser.js
// All text parsing: code blocks, fields, lorebook entries, concept ratings

import { CARD_FIELDS } from './card.js';

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
    const nameMatch = text.match(/💡 Concept:\s*"([^"]+)"/);
    if (nameMatch) result.conceptName = nameMatch[1];
    const axes = ['Hook Strength','Longevity/Depth','Originality','RP Potential','Platform Appeal'];
    for (const axis of axes) {
        const escaped = axis.replace('/', '\\/');
        const match = text.match(new RegExp(escaped + '[^★☆]*([★☆]+)'));
        if (match) result.scores[axis] = (match[1].match(/★/g) || []).length;
    }
    const overallMatch = text.match(/Overall:\s*(.+?)(?:\n|$)/);
    if (overallMatch) result.overall = overallMatch[1].trim();
    const pillarMatches = [...text.matchAll(/□\s+(.+)/g)];
    result.pillars = pillarMatches.map(m => ({ name: m[1].trim(), resolved: false, answer: '' }));
    return result;
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
    const lower = text.toLowerCase();
    const fieldKeywords = {
        description: ['description','desc','who she is','who he is','appearance','backstory','background'],
        personality:  ['personality','traits','character traits'],
        scenario:     ['scenario','setting','scene context','situation','opening context'],
        first_mes:    ['first message','opening message','first mes','intro message','first greeting','opening scene'],
        mes_example:  ['example message','example dialogue','mes example','dialogue example','sample dialogue'],
        system_prompt:['system prompt','ai instructions','behavior instructions','format rules'],
        creator_notes:['creator notes','card description','card page','chub description','download page'],
        alternate_greetings: ['alternate greeting','alt greeting','new greeting','add greeting','another greeting'],
        tags:         ['tags','tag the card','suggest tags','generate tags','card tags'],
        name:         ['character name','what should we name','name her','name him'],
    };
    for (const [field, keywords] of Object.entries(fieldKeywords)) {
        if (keywords.some(k => lower.includes(k))) return field;
    }
    return null;
}

export function isBatchGreetingOp(text) {
    const lower = text.toLowerCase();
    return ['all greetings','all alternate','every greeting','all the greeting','each greeting'].some(s => lower.includes(s));
}

export function isGenerateAllRequest(text) {
    const lower = text.toLowerCase();
    return ['generate all','generate everything','fill all fields','do all fields','full card','write everything'].some(s => lower.includes(s));
}

export function detectPhaseSwitch(text) {
    const lower = text.toLowerCase();
    if (['work on lorebook','lorebook now','start lorebook','build lorebook','add lore entries'].some(s => lower.includes(s))) return 'lorebook';
    if (['go back to building','back to fields','back to card','work on card fields'].some(s => lower.includes(s))) return 'building';
    if (['start building','start writing','let\'s build','begin writing','ready to write','fill the fields','approve'].some(s => lower.includes(s))) return 'build_start';
    return null;
}
