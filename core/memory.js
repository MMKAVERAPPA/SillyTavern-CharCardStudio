// core/memory.js
// Session state, idea memory, field versions, lorebook log, snippet library

const SETTINGS_KEY = 'CharCardStudio';
const MAX_FIELD_VERSIONS = 5;
const DEFAULT_COMPRESSION_THRESHOLD = 15;

export class MemoryManager {
    constructor() {
        this.settings = null;
    }

    init() {
        const { extensionSettings } = SillyTavern.getContext();
        if (!extensionSettings[SETTINGS_KEY]) {
            extensionSettings[SETTINGS_KEY] = this._defaultSettings();
        }
        // Migrate old settings that may be missing new keys
        const s = extensionSettings[SETTINGS_KEY];
        if (!s.globalSettings.utilityApiMode) s.globalSettings.utilityApiMode = 'same';
        if (!s.globalSettings.utilityEndpoint) s.globalSettings.utilityEndpoint = '';
        if (!s.globalSettings.utilityApiKey) s.globalSettings.utilityApiKey = '';
        if (!s.globalSettings.utilityModel) s.globalSettings.utilityModel = '';
        if (!s.globalSettings.platformTarget) s.globalSettings.platformTarget = 'chub';
        if (!s.globalSettings.voiceToneProfile) s.globalSettings.voiceToneProfile = this._defaultToneProfile();
        if (s.globalSettings.parallelApiCalls === undefined) s.globalSettings.parallelApiCalls = true;
        if (!s.snippets) s.snippets = [];
        this.settings = extensionSettings[SETTINGS_KEY];
    }

    _defaultSettings() {
        return {
            sessions: {},
            globalSettings: {
                // Primary API
                apiMode: 'current',
                selectedProfile: '',
                customEndpoint: '',
                customApiKey: '',
                customModel: '',
                // Utility API (for fast background calls)
                utilityApiMode: 'same',      // 'same' | 'custom'
                utilityEndpoint: '',
                utilityApiKey: '',
                utilityModel: '',
                // Output
                outputFormat: 'auto',
                detailLevel: 'standard',
                plistMode: false,
                customSystemPromptRules: '',
                // Session
                autoSaveInterval: 5,
                compressionThreshold: DEFAULT_COMPRESSION_THRESHOLD,
                // Parallel API calls
                parallelApiCalls: true,       // false = run variations/batch ops sequentially
                // Platform
                platformTarget: 'chub',      // 'chub' | 'fictionlab' | 'janitor' | 'personal'
                // Voice/Tone
                voiceToneProfile: this._defaultToneProfile(),
            },
            snippets: [],   // [{ id, name, content, category }]
        };
    }

    _defaultToneProfile() {
        return {
            pov: 'third',           // 'first' | 'third'
            actionFormat: 'asterisk', // 'asterisk' | 'italic' | 'none'
            proseDensity: 'balanced', // 'terse' | 'balanced' | 'rich'
            formalityRegister: 'neutral', // 'casual' | 'neutral' | 'formal'
        };
    }

    save() {
        const { saveSettingsDebounced } = SillyTavern.getContext();
        saveSettingsDebounced();
    }

    getGlobalSettings() { return this.settings.globalSettings; }

    updateGlobalSettings(updates) {
        Object.assign(this.settings.globalSettings, updates);
        this.save();
    }

    // ── Session management ──────────────────────────────────────────────────

    getSessionKey(characterId) { return `char_${characterId}`; }

    hasIncompleteSession(characterId) {
        const s = this.settings.sessions[this.getSessionKey(characterId)];
        return s && !s.completed && (s.conversationHistory?.length > 0);
    }

    getSessionInfo(characterId) {
        const s = this.settings.sessions[this.getSessionKey(characterId)];
        if (!s) return null;
        return {
            messageCount: s.conversationHistory?.length || 0,
            lastActive: s.lastActive,
            characterName: s.characterName,
            phase: s.currentPhase,
            conceptName: s.ideaMemory?.conceptName || 'Unknown concept',
        };
    }

    loadSession(characterId) {
        return this.settings.sessions[this.getSessionKey(characterId)] || this.createNewSession(characterId);
    }

    createNewSession(characterId) {
        const key = this.getSessionKey(characterId);
        const { characters } = SillyTavern.getContext();
        const char = characters[characterId];
        const session = {
            characterId,
            characterName: char?.name || 'Unknown',
            currentPhase: 'ideation',
            completed: false,
            lastActive: Date.now(),
            conversationHistory: [],
            sessionBriefs: [],
            ideaMemory: {
                conceptName: '',
                conceptRating: null,
                pillars: [],
                keyDecisions: [],
                proposedProfileApproved: false,
                distributionStrategy: {},
                platformTarget: this.settings.globalSettings.platformTarget,
            },
            fieldLog: this._emptyFieldLog(),
            lorebookLog: {
                targetBook: '',
                embedded: true,
                entryList: [],
                acceptedEntries: [],
                pendingEntries: [],
            },
            generationQueue: [],     // queued field names
            reviewMode: false,       // true when loading existing card for review
        };
        this.settings.sessions[key] = session;
        this.save();
        return session;
    }

    _emptyFieldLog() {
        const fields = ['name','description','personality','scenario','first_mes',
                        'mes_example','system_prompt','creator_notes','alternate_greetings','tags'];
        const log = {};
        for (const f of fields) log[f] = { versions: [], acceptedAt: null };
        return log;
    }

    saveSession(characterId, sessionData) {
        sessionData.lastActive = Date.now();
        this.settings.sessions[this.getSessionKey(characterId)] = sessionData;
        this.save();
    }

    clearSession(characterId) {
        delete this.settings.sessions[this.getSessionKey(characterId)];
        this.save();
    }

    // ── Conversation ────────────────────────────────────────────────────────

    addMessage(session, role, content) {
        session.conversationHistory.push({ role, content, timestamp: Date.now() });
        const threshold = this.settings.globalSettings.compressionThreshold || DEFAULT_COMPRESSION_THRESHOLD;
        return session.conversationHistory.length >= threshold;
    }

    compressOldMessages(session, brief) {
        const toCompress = session.conversationHistory.slice(0, -5);
        session.sessionBriefs.push({ brief, messageCount: toCompress.length, timestamp: Date.now() });
        session.conversationHistory = session.conversationHistory.slice(-5);
    }

    editMessage(session, index, newContent) {
        if (session.conversationHistory[index]) {
            session.conversationHistory[index].content = newContent;
            session.conversationHistory[index].editedAt = Date.now();
            // Truncate everything after the edited message so history stays coherent
            session.conversationHistory = session.conversationHistory.slice(0, index + 1);
        }
    }

    // ── Field versions ──────────────────────────────────────────────────────

    saveFieldVersion(session, fieldName, content, summary = '') {
        if (!session.fieldLog[fieldName]) {
            session.fieldLog[fieldName] = { versions: [], acceptedAt: null };
        }
        const log = session.fieldLog[fieldName];
        log.versions.push({ content, summary, timestamp: Date.now() });
        if (log.versions.length > MAX_FIELD_VERSIONS) {
            log.versions = log.versions.slice(-MAX_FIELD_VERSIONS);
        }
        log.acceptedAt = Date.now();
    }

    getFieldVersions(session, fieldName) {
        return session.fieldLog[fieldName]?.versions || [];
    }

    getFieldVersion(session, fieldName, idx) {
        return session.fieldLog[fieldName]?.versions[idx]?.content || null;
    }

    // ── Lorebook ────────────────────────────────────────────────────────────

    addPendingEntry(session, entry) {
        session.lorebookLog.pendingEntries.push({ ...entry, addedAt: Date.now() });
    }

    acceptLoreEntry(session, entry) {
        const idx = session.lorebookLog.pendingEntries.findIndex(e => e._tempId === entry._tempId);
        if (idx !== -1) session.lorebookLog.pendingEntries.splice(idx, 1);
        session.lorebookLog.acceptedEntries.push({ ...entry, acceptedAt: Date.now() });
    }

    buildLorebookIndex(session) {
        const entries = session.lorebookLog.acceptedEntries;
        if (!entries.length) return '';
        let index = `[LOREBOOK_INDEX — ${entries.length} entries]\n`;
        const byCat = {};
        for (const e of entries) {
            const cat = e.category || 'General';
            if (!byCat[cat]) byCat[cat] = [];
            byCat[cat].push(e);
        }
        for (const [cat, es] of Object.entries(byCat)) {
            index += `\n${cat}:\n`;
            for (const e of es) {
                const keys = (e.keys || []).slice(0, 4).join(', ');
                const tok = Math.round((e.content || '').length / 4);
                index += `  [${e.uid || '?'}] ${e.comment || 'Untitled'} | Keys: ${keys} | ~${tok}t\n`;
            }
        }
        return index;
    }

    buildIdeaMemorySummary(session) {
        const idea = session.ideaMemory;
        if (!idea.conceptName && !idea.pillars.length) return '';
        let s = '[IDEA_MEMORY]\n';
        if (idea.conceptName) s += `Concept: ${idea.conceptName}\n`;
        const resolved = idea.pillars.filter(p => p.resolved);
        const pending = idea.pillars.filter(p => !p.resolved);
        if (resolved.length) {
            s += '\nResolved Decisions:\n';
            for (const p of resolved) s += `  ✓ ${p.name}: ${p.answer}\n`;
        }
        if (pending.length) {
            s += '\nPending Pillars:\n';
            for (const p of pending) s += `  □ ${p.name}\n`;
        }
        if (idea.keyDecisions.length) {
            s += '\nKey Decisions:\n';
            for (const d of idea.keyDecisions.slice(-5)) s += `  - ${d.decision}\n`;
        }
        s += '[/IDEA_MEMORY]';
        return s;
    }

    buildSessionBriefs(session) {
        if (!session.sessionBriefs.length) return '';
        const latest = session.sessionBriefs[session.sessionBriefs.length - 1];
        return `[SESSION_BRIEF]\n${latest.brief}\n[/SESSION_BRIEF]`;
    }

    // ── Snippets ────────────────────────────────────────────────────────────

    getSnippets() { return this.settings.snippets || []; }

    addSnippet(name, content, category = 'General') {
        const snippet = { id: Date.now().toString(), name, content, category };
        this.settings.snippets.push(snippet);
        this.save();
        return snippet;
    }

    deleteSnippet(id) {
        this.settings.snippets = this.settings.snippets.filter(s => s.id !== id);
        this.save();
    }

    updateSnippet(id, updates) {
        const s = this.settings.snippets.find(s => s.id === id);
        if (s) { Object.assign(s, updates); this.save(); }
    }

    // ── Context helpers ─────────────────────────────────────────────────────

    getToneProfilePrompt() {
        const p = this.settings.globalSettings.voiceToneProfile;
        if (!p) return '';
        return `[VOICE_TONE_PROFILE]
POV: ${p.pov === 'first' ? 'First person (I, me, my)' : 'Third person (she/he/they)'}
Action Format: ${p.actionFormat === 'asterisk' ? 'Asterisks (*action*)' : p.actionFormat === 'italic' ? 'Italics (_action_)' : 'No special formatting'}
Prose Density: ${p.proseDensity}
Formality: ${p.formalityRegister}
[/VOICE_TONE_PROFILE]`;
    }

    getPlatformPrompt() {
        const pt = this.settings.globalSettings.platformTarget;
        const platforms = {
            chub: 'Target platform: Chub.ai — Supports longer cards, HTML in creator_notes, detailed lorebooks. Users expect polished, detailed cards.',
            fictionlab: 'Target platform: FictionLab — Field character limits apply. Creator notes support HTML. Cards often shared with scenario-style framing.',
            janitor: 'Target platform: JanitorAI — Keep first_mes shorter. Simpler lorebooks preferred. Standard SFW-friendly tags expected.',
            personal: 'Target platform: Personal use — No platform constraints. Optimize purely for quality and your personal preferences.',
        };
        return platforms[pt] || platforms.chub;
    }
}

export const memoryManager = new MemoryManager();
