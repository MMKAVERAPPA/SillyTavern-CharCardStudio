// core/worldinfo.js
// Lorebook (World Info) CRUD with full metadata

import { parseLorebookEntriesFromResponse } from './parser.js';
import { getRequestHeaders } from '../../../../../script.js';

export const WI_POSITION = { BEFORE_CHAR:0, AFTER_CHAR:1, BEFORE_EXAMPLES:2, AFTER_EXAMPLES:3, AN_TOP:4, AN_BOTTOM:5, AT_DEPTH:6, OUTLET:7 };
export const WI_SELECTIVE_LOGIC = { AND_ANY:0, NOT_ANY:1, NOT_ALL:2, AND_ALL:3 };
export const CATEGORY_ICONS = {
    'World/Setting':'🌍','Location':'📍','Character/NPC':'👤','Faction/Organization':'🏛️',
    'Mechanic/System':'⚙️','Relationship/Dynamic':'💬','Character Mode/Variant':'🎭',
    'History/Lore':'📜','Tracker/State':'🎯','General':'📄',
};

export class WorldInfoManager {

    async getLorebookList() {
        try {
            const r = await fetch('/api/worldinfo/list', {
                method: 'GET',
                headers: getRequestHeaders(),
            });
            if (!r.ok) throw new Error('Failed');
            const d = await r.json();
            return d.files || [];
        } catch (err) {
            console.error('[CCS] getLorebookList:', err);
            return [];
        }
    }

    async getLorebookEntries(name) {
        try {
            const r = await fetch('/api/worldinfo/get', {
                method: 'POST',
                headers: Object.assign({ 'Content-Type': 'application/json' }, getRequestHeaders()),
                body: JSON.stringify({ name }),
            });
            if (!r.ok) throw new Error('Failed');
            const d = await r.json();
            return d.entries || {};
        } catch (err) {
            console.error('[CCS] getLorebookEntries:', err);
            return {};
        }
    }

    async saveLorebook(name, entries) {
        const r = await fetch('/api/worldinfo/save', {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, getRequestHeaders()),
            body: JSON.stringify({ name, entries }),
        });
        if (!r.ok) throw new Error(`Save failed: ${r.statusText}`);
        return true;
    }

    async createLorebook(name) {
        if (!name?.trim()) throw new Error('Lorebook name cannot be empty');
        await this.saveLorebook(name.trim(), {});
        return name.trim();
    }

    async addEntries(lorebookName, entriesData) {
        const existing = await this.getLorebookEntries(lorebookName);
        let uid = this._getNextUid(existing);
        const uids = [];
        for (const data of entriesData) {
            existing[String(uid)] = this._buildEntry(uid, data);
            uids.push(uid++);
        }
        await this.saveLorebook(lorebookName, existing);
        return uids;
    }

    async addEmbeddedEntries(characterId, entriesData) {
        const { characters } = SillyTavern.getContext();
        const char = characters[characterId];
        if (!char) throw new Error('Character not found');
        if (!char.data) char.data = {};
        if (!char.data.character_book) {
            char.data.character_book = {
                name: `${char.name} - Lorebook`,
                description: '',
                scan_depth: 50,
                token_budget: 2048,
                recursive_scanning: false,
                extensions: {},
                entries: [],
            };
        }
        const book = char.data.character_book;
        let nextId = book.entries.length ? Math.max(...book.entries.map(e => e.id || 0)) + 1 : 1;
        for (const data of entriesData) {
            book.entries.push(this._buildEmbeddedEntry(nextId++, data));
        }
        const payload = {
            avatar: char.avatar, ch_name: char.name,
            description: char.description || '', personality: char.personality || '',
            scenario: char.scenario || '', first_mes: char.first_mes || '',
            mes_example: char.mes_example || '', data: char.data,
        };
        const r = await fetch('/api/characters/save', {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, getRequestHeaders()),
            body: JSON.stringify(payload),
        });
        if (!r.ok) throw new Error('Failed to save embedded lorebook');
        return true;
    }

    parseAIEntryOutput(text) {
        return parseLorebookEntriesFromResponse(text);
    }

    _buildEntry(uid, data) {
        return {
            uid,
            key: data.keys || [],
            keysecondary: data.secondary_keys || [],
            comment: data.comment || '',
            content: data.content || '',
            constant: data.constant || false,
            selective: data.selective || false,
            selectiveLogic: data.selectiveLogic || WI_SELECTIVE_LOGIC.AND_ANY,
            addMemo: true,
            order: data.insertion_order || 100,
            position: data.position ?? WI_POSITION.AFTER_CHAR,
            disable: false,
            excludeRecursion: data.excludeRecursion || false,
            preventRecursion: data.preventRecursion || false,
            probability: data.probability ?? 100,
            useProbability: true,
            depth: data.depth || 4,
            role: 0,
            vectorized: false,
            extensions: {
                depth: data.depth || 4, weight: 10, addMemo: true,
                displayIndex: uid, useProbability: true,
                characterFilter: null, excludeRecursion: data.excludeRecursion || false,
                preventRecursion: data.preventRecursion || false,
                delay: data.delay || 0,
                cooldown: data.cooldown || 0,
                sticky: data.sticky || 0,
                group: data.group || '',
                groupOverride: false,
                groupWeight: 100,
                filter: data.filterKeys || [],
                filterLogic: data.filterLogic ?? WI_SELECTIVE_LOGIC.AND_ANY,
            },
        };
    }

    _buildEmbeddedEntry(id, data) {
        return {
            id, name: data.comment || '',
            keys: data.keys || [],
            secondary_keys: data.secondary_keys || [],
            content: data.content || '',
            comment: data.comment || '',
            constant: data.constant || false,
            selective: data.selective || false,
            insertion_order: data.insertion_order || 100,
            enabled: true,
            position: data.position ?? WI_POSITION.AFTER_CHAR,
            case_sensitive: data.case_sensitive || false,
            priority: 10,
            probability: data.probability ?? 100,
            selectiveLogic: data.selectiveLogic || WI_SELECTIVE_LOGIC.AND_ANY,
            preventRecursion: data.preventRecursion || false,
            extensions: {
                depth: data.depth || 4, weight: 10, addMemo: true,
                displayIndex: id, useProbability: true,
                characterFilter: null, excludeRecursion: data.excludeRecursion || false,
                preventRecursion: data.preventRecursion || false,
                delay: data.delay || 0,
                cooldown: data.cooldown || 0,
                sticky: data.sticky || 0,
                group: data.group || '',
                groupOverride: false,
                groupWeight: 100,
                filter: data.filterKeys || [],
                filterLogic: data.filterLogic ?? WI_SELECTIVE_LOGIC.AND_ANY,
                linked: false, embedded: true,
            },
        };
    }

    _getNextUid(entries) {
        const uids = Object.keys(entries).map(Number).filter(n => !isNaN(n));
        return uids.length ? Math.max(...uids) + 1 : 1;
    }
}

export const worldInfoManager = new WorldInfoManager();
