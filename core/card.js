// core/card.js
// Character card V3 read/write, token counting, diff, field validation

import { getRequestHeaders, eventSource, event_types } from '../../../../../script.js';

const $ = window.jQuery;

export const CARD_FIELDS = [
    'name','description','personality','scenario','first_mes','mes_example',
    'system_prompt','post_history_instructions','creator_notes','tags',
    'alternate_greetings','creator','character_version','character_book',
];

export const FIELD_LABELS = {
    name: 'Name',
    description: 'Description',
    personality: 'Personality',
    scenario: 'Scenario',
    first_mes: 'First Message',
    mes_example: 'Example Messages',
    system_prompt: 'System Prompt',
    post_history_instructions: 'Post History Instructions',
    creator_notes: 'Creator Notes',
    tags: 'Tags',
    alternate_greetings: 'Alternate Greetings',
    creator: 'Creator',
    character_version: 'Version',
    character_book: 'Embedded Lorebook',
};

// Fields excluded from the status board (user-managed)
export const EXCLUDED_FROM_BOARD = ['post_history_instructions','character_book','creator','character_version'];

// Token warning thresholds per field
const TOKEN_LIMITS = {
    description:    { warn: 600, danger: 1200 },
    personality:    { warn: 200, danger: 400 },
    scenario:       { warn: 300, danger: 600 },
    first_mes:      { warn: 400, danger: 800 },
    mes_example:    { warn: 400, danger: 800 },
    system_prompt:  { warn: 300, danger: 600 },
};

export class CardManager {

    readCurrentCard() {
        const { characters, characterId } = SillyTavern.getContext();
        if (characterId === undefined || characterId === null || characterId < 0) return null;
        const char = characters[characterId];
        if (!char) return null;
        return {
            _characterId: characterId,
            _avatarFileName: char.avatar,
            name: char.name || '',
            description: char.description || '',
            personality: char.personality || '',
            scenario: char.scenario || '',
            first_mes: char.first_mes || '',
            mes_example: char.mes_example || '',
            system_prompt: char.data?.system_prompt || '',
            post_history_instructions: char.data?.post_history_instructions || '',
            creator_notes: char.data?.creator_notes || '',
            tags: char.data?.tags || [],
            alternate_greetings: char.data?.alternate_greetings || [],
            creator: char.data?.creator || '',
            character_version: char.data?.character_version || '',
            character_book: char.data?.character_book || null,
        };
    }

    async writeField(fieldName, value) {
        const { characterId, characters } = SillyTavern.getContext();
        if (characterId === undefined || characterId < 0) throw new Error('No character selected');
        const char = characters[characterId];
        if (!char) throw new Error('Character not found');

        // Apply the field update directly to the character object
        this._updateLocalChar(char, fieldName, value);
        
        // Trigger ST's character save mechanism via event
        // This ensures all ST's internal state management runs properly
        eventSource.emit(event_types.CHARACTER_EDITED, { id: characterId, field: fieldName });
        
        // Trigger the actual save (clicks the save button programmatically)
        $('#create_button').trigger('click');
        
        // Wait a bit for the save to complete
        await new Promise(resolve => setTimeout(resolve, 100));
        
        return true;
    }

    async writeMultipleFields(fieldsObj) {
        const { characterId, characters } = SillyTavern.getContext();
        if (characterId === undefined || characterId < 0) throw new Error('No character selected');
        const char = characters[characterId];
        if (!char) throw new Error('Character not found');

        // Apply all field updates directly to the character object
        for (const [f, v] of Object.entries(fieldsObj)) {
            this._updateLocalChar(char, f, v);
        }
        
        // Trigger ST's character save mechanism
        eventSource.emit(event_types.CHARACTER_EDITED, { id: characterId, fields: Object.keys(fieldsObj) });
        
        // Trigger the actual save
        $('#create_button').trigger('click');
        
        // Wait for save to complete
        await new Promise(resolve => setTimeout(resolve, 100));
        
        return true;
    }

    async writeAlternateGreeting(index, content) {
        const { characterId, characters } = SillyTavern.getContext();
        const char = characters[characterId];
        if (!char) throw new Error('Character not found');
        const greetings = [...(char.data?.alternate_greetings || [])];
        if (index === -1 || index >= greetings.length) greetings.push(content);
        else greetings[index] = content;
        return this.writeField('alternate_greetings', greetings);
    }

    async deleteAlternateGreeting(index) {
        const { characterId, characters } = SillyTavern.getContext();
        const char = characters[characterId];
        if (!char) throw new Error('Character not found');
        const greetings = [...(char.data?.alternate_greetings || [])];
        greetings.splice(index, 1);
        return this.writeField('alternate_greetings', greetings);
    }

    estimateTokens(text) {
        if (!text) return 0;
        const ctx = SillyTavern.getContext();
        if (ctx.getTokenCount) {
            try { return ctx.getTokenCount(text); } catch {}
        }
        return Math.ceil(text.length / 4);
    }

    getTokenCounts(cardFields) {
        const counts = {};
        let total = 0;
        for (const field of CARD_FIELDS) {
            const value = cardFields[field];
            if (Array.isArray(value)) {
                const perItem = value.map(g => this.estimateTokens(g));
                const fieldTotal = perItem.reduce((a, b) => a + b, 0);
                counts[field] = { total: fieldTotal, perItem };
                total += fieldTotal;
            } else if (typeof value === 'string') {
                counts[field] = this.estimateTokens(value);
                total += counts[field];
            } else {
                counts[field] = 0;
            }
        }
        counts._total = total;
        return counts;
    }

    getTokenStatus(fieldName, count) {
        const limit = TOKEN_LIMITS[fieldName];
        if (!limit) return 'green';
        if (count > limit.danger) return 'red';
        if (count > limit.warn) return 'yellow';
        return 'green';
    }

    // Total token budget assessment
    getBudgetAssessment(totalTokens) {
        return {
            tokens: totalTokens,
            pct4k: Math.round((totalTokens / 4096) * 100),
            pct8k: Math.round((totalTokens / 8192) * 100),
            pct16k: Math.round((totalTokens / 16384) * 100),
            pct32k: Math.round((totalTokens / 32768) * 100),
            status: totalTokens > 8000 ? 'danger' : totalTokens > 4000 ? 'warn' : 'ok',
        };
    }

    computeDiff(oldText, newText) {
        const { DiffMatchPatch } = SillyTavern.libs || {};
        if (!DiffMatchPatch) {
            return [{ type: 'delete', text: oldText || '' }, { type: 'insert', text: newText || '' }];
        }
        const dmp = new DiffMatchPatch();
        const diffs = dmp.diff_main(oldText || '', newText || '');
        dmp.diff_cleanupSemantic(diffs);
        return diffs.map(([op, text]) => ({
            type: op === 1 ? 'insert' : op === -1 ? 'delete' : 'equal',
            text,
        }));
    }

    // Validate {{char}} and {{user}} macro usage
    validateMacros(fieldName, content) {
        const warnings = [];
        if (!content) return warnings;

        const { characters, characterId } = SillyTavern.getContext();
        const charName = characters?.[characterId]?.name || '';

        // Check for raw character name instead of {{char}}
        if (charName && charName.length > 2) {
            const nameRegex = new RegExp(`\\b${charName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
            const matches = content.match(nameRegex);
            if (matches && matches.length > 1) {
                warnings.push(`⚠️ Raw name "${charName}" used ${matches.length} times — consider {{char}} instead`);
            }
        }

        // Check description for second-person "you" addressing
        if (fieldName === 'description' && /\byou\b|\byour\b/i.test(content)) {
            warnings.push('⚠️ "you/your" detected in description — use third-person or {{user}} instead');
        }

        // Check first_mes for {{user}} actions
        if (fieldName === 'first_mes' && /\{\{user\}\}[^:]*(?:says|does|feels|thinks|looks)/i.test(content)) {
            warnings.push('⚠️ Possible {{user}} action in first_mes — never write for {{user}}');
        }

        // Check mes_example for behavioral rules
        if (fieldName === 'mes_example') {
            const behaviorPatterns = ['always respond','never break','you must','do not','make sure to',
                'remember to','format your','response length','stay in character'];
            for (const p of behaviorPatterns) {
                if (content.toLowerCase().includes(p)) {
                    warnings.push(`⚠️ Behavioral rule in mes_example ("${p}") — move to system_prompt`);
                    break;
                }
            }
        }

        return warnings;
    }

    // Auto-correct mes_example format
    fixMesExampleFormat(content) {
        // Ensure <START> tags are present
        if (!content.includes('<START>')) {
            const lines = content.trim().split('\n');
            return '<START>\n' + lines.join('\n');
        }
        return content;
    }

    // ── Private ─────────────────────────────────────────────────────────────

    _buildSavePayload(char, fieldName, value) {
        const payload = {
            avatar: char.avatar,
            ch_name: char.name,
            description: char.description || '',
            personality: char.personality || '',
            scenario: char.scenario || '',
            first_mes: char.first_mes || '',
            mes_example: char.mes_example || '',
            data: { ...(char.data || {}) },
        };
        this._applyFieldToPayload(payload, fieldName, value);
        return payload;
    }

    _applyFieldToPayload(payload, fieldName, value) {
        const topLevel = ['description','personality','scenario','first_mes','mes_example'];
        if (fieldName === 'name') {
            payload.ch_name = value;
        } else if (topLevel.includes(fieldName)) {
            payload[fieldName] = value;
        } else {
            if (!payload.data) payload.data = {};
            payload.data[fieldName] = value;
        }
    }

    _updateLocalChar(char, fieldName, value) {
        const topLevel = ['description','personality','scenario','first_mes','mes_example'];
        if (fieldName === 'name') char.name = value;
        else if (topLevel.includes(fieldName)) char[fieldName] = value;
        else {
            if (!char.data) char.data = {};
            char.data[fieldName] = value;
        }
    }
}

export const cardManager = new CardManager();
