// core/memory.js
// Session state, idea memory, field versions, lorebook log, snippet library

const SETTINGS_KEY = 'CharCardStudio';
const MAX_FIELD_VERSIONS = 5;
const DEFAULT_COMPRESSION_THRESHOLD = 30; // Compress when conversation reaches 30 messages

export class MemoryManager {
    constructor() {
        this.settings = null;
        this._saveTimer = null; // For throttled session auto-save
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
        if (s.globalSettings.inputLimitEnabled === undefined) s.globalSettings.inputLimitEnabled = true;
        if (!s.globalSettings.theme) s.globalSettings.theme = 'dark';
        if (s.globalSettings.hapticFeedback === undefined) s.globalSettings.hapticFeedback = false;
        if (s.globalSettings.historyLimit === undefined) s.globalSettings.historyLimit = 20; // NEW: Message limit
        if (!s.snippets) s.snippets = [];
        // v3.3: undo/redo stacks are in-memory only (not persisted)
        this._undoStacks = {}; // { sessionKey: [{ fieldName, prevValue }] }
        this._redoStacks = {};
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
                historyLimit: 20,            // Keep last N messages uncompressed
                // Parallel API calls
                parallelApiCalls: true,       // false = run variations/batch ops sequentially
                inputLimitEnabled: true,      // false = disable 12,000 char message length cap
                // Platform
                platformTarget: 'chub',      // 'chub' | 'fictionlab' | 'janitor' | 'personal'
                // Voice/Tone
                voiceToneProfile: this._defaultToneProfile(),
                // Appearance
                theme: 'dark',               // 'dark' | 'midnight' | 'sepia' | 'light'
                // Haptic feedback (mobile)
                hapticFeedback: false,
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
                conceptName: (char?.description || char?.first_mes) ? `${char.name} - Existing Card` : '',
                conceptRating: null,
                pillars: [],
                keyDecisions: [],
                proposedProfileApproved: false,
                proposedProfileGenerated: false,
                distributionStrategy: {},
                platformTarget: this.settings.globalSettings.platformTarget,
                loreEntryPlan: [],        // [{ title, description, category, activation, estimatedTokens }]
                // v3.0 additions
                cardType: 'single',       // 'single' | 'multi' | 'scenario'
                format: 'prose',          // 'prose' | 'plist_alichat'
                voiceProfile: '',         // Confirmed voice description from calibration
                voiceSamples: [],         // Array of confirmed voice sample strings
                psychProfile: {           // Psychological depth profile
                    coreMotivation: '',
                    primaryFear: '',
                    hiddenDesire: '',
                    centralContradiction: '',
                    theWound: '',
                    stressBehavior: '',
                    socialMask: '',
                    emotionalTriggers: [],
                },
            },
            fieldLog: this._emptyFieldLog(),
            lorebookLog: {
                targetBook: '',      // name of the chosen external lorebook
                embedded: false,     // embedded mode removed; always use external book
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
        
        // Auto-save session after adding message (immediate save to prevent data loss)
        if (session.characterId) {
            this.saveSession(session.characterId, session);
            console.log(`[CCS] Auto-saved session after message (${session.conversationHistory.length} messages)`);
        }
        
        return this.shouldCompress(session);
    }

    shouldCompress(session) {
        const threshold = this.settings.globalSettings.compressionThreshold || DEFAULT_COMPRESSION_THRESHOLD;
        return session.conversationHistory.length >= threshold;
    }

    compressOldMessages(session, brief) {
        const historyLimit = this.settings.globalSettings.historyLimit || 20;
        const toCompress = session.conversationHistory.slice(0, -historyLimit);
        
        // Don't merge briefs - keep them separate and trim old ones
        if (!session.sessionBriefs) session.sessionBriefs = [];
        
        // Add new brief
        session.sessionBriefs.push({ 
            brief, 
            messageCount: toCompress.length, 
            timestamp: Date.now() 
        });
        
        // Keep only last 5 briefs (prevents exponential growth)
        const maxBriefs = 5;
        if (session.sessionBriefs.length > maxBriefs) {
            session.sessionBriefs = session.sessionBriefs.slice(-maxBriefs);
        }
        
        // Remove compressed messages from history
        session.conversationHistory = session.conversationHistory.slice(-historyLimit);
        
        console.log(`[CCS] Compressed ${toCompress.length} old messages into brief (${session.sessionBriefs.length} total briefs), keeping last ${historyLimit} messages`);
    }

    // Throttled auto-save to prevent excessive localStorage writes
    _throttledSaveSession(characterId, session) {
        clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => {
            this.saveSession(characterId, session);
        }, 1000); // 1 second debounce
    }

    editMessage(session, index, newContent) {
        if (session.conversationHistory[index]) {
            session.conversationHistory[index].content = newContent;
            session.conversationHistory[index].editedAt = Date.now();
            // Truncate everything after the edited message so history stays coherent
            session.conversationHistory = session.conversationHistory.slice(0, index + 1);
        }
    }

    pruneGenerationResponse(session, fieldName) {
        const history = session.conversationHistory;
        // Find the last assistant message that generated this field (has a code block)
        for (let i = history.length - 1; i >= 0; i--) {
            if (history[i].role === 'assistant' && history[i].content.includes('```')) {
                history[i]._pruned = true;
                history[i].content = `[Generated ${fieldName} — accepted. Content preserved in CARD_STATE.]`;
                break;
            }
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

    // BUG-009 FIX: alias so popup.js and any other caller using the old name still works
    addFieldVersion(session, fieldName, content, summary = '') {
        return this.saveFieldVersion(session, fieldName, content, summary);
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

    // ── Undo / Redo (in-memory, per session) ────────────────────────────────

    pushUndo(session, fieldName, prevValue) {
        const key = this.getSessionKey(session.characterId);
        if (!this._undoStacks[key]) this._undoStacks[key] = [];
        if (!this._redoStacks[key]) this._redoStacks[key] = [];
        this._undoStacks[key].push({ fieldName, value: prevValue, timestamp: Date.now() });
        // Clear redo stack on new action
        this._redoStacks[key] = [];
        // Cap at 30 actions
        if (this._undoStacks[key].length > 30) this._undoStacks[key].shift();
    }

    popUndo(session) {
        const key = this.getSessionKey(session.characterId);
        return this._undoStacks[key]?.pop() || null;
    }

    pushRedo(session, fieldName, prevValue) {
        const key = this.getSessionKey(session.characterId);
        if (!this._redoStacks[key]) this._redoStacks[key] = [];
        this._redoStacks[key].push({ fieldName, value: prevValue, timestamp: Date.now() });
    }

    popRedo(session) {
        const key = this.getSessionKey(session.characterId);
        return this._redoStacks[key]?.pop() || null;
    }

    // ── Session export / import ─────────────────────────────────────────────

    exportSession(characterId) {
        const s = this.settings.sessions[this.getSessionKey(characterId)];
        if (!s) throw new Error('No session found for this character.');
        return JSON.stringify({ _ccsExport: true, version: '3.3.0', exportedAt: Date.now(), session: s }, null, 2);
    }

    importSession(jsonString) {
        let parsed;
        try { parsed = JSON.parse(jsonString); } catch { throw new Error('Invalid JSON — could not parse session file.'); }
        if (!parsed._ccsExport || !parsed.session) throw new Error('Not a valid CCS session export file.');
        const s = parsed.session;
        if (!s.characterId && s.characterId !== 0) throw new Error('Session missing characterId.');
        const key = this.getSessionKey(s.characterId);
        this.settings.sessions[key] = s;
        this.save();
        return s;
    }

    buildLorebookIndex(session, phase) {
        const entries = session.lorebookLog.acceptedEntries;
        if (!entries.length) return '';
        if (phase !== 'lorebook') {
            return `[LOREBOOK: ${entries.length} entries accepted — use "check lorebook" to see details]\n`;
        }
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
        if (idea.cardType) s += `Card Type: ${idea.cardType}\n`;
        if (idea.format) s += `Format: ${idea.format}\n`;
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
        // v3.0: Voice profile
        if (idea.voiceProfile) {
            s += `\nVoice Profile: ${idea.voiceProfile}\n`;
        }
        // v3.0: Psychological profile summary
        const psych = idea.psychProfile;
        if (psych && (psych.coreMotivation || psych.centralContradiction)) {
            s += '\nPsychological Profile:\n';
            if (psych.coreMotivation) s += `  Core Motivation: ${psych.coreMotivation}\n`;
            if (psych.primaryFear) s += `  Primary Fear: ${psych.primaryFear}\n`;
            if (psych.hiddenDesire) s += `  Hidden Desire: ${psych.hiddenDesire}\n`;
            if (psych.centralContradiction) s += `  Central Contradiction: ${psych.centralContradiction}\n`;
            if (psych.theWound) s += `  The Wound: ${psych.theWound}\n`;
            if (psych.stressBehavior) s += `  Stress Behavior: ${psych.stressBehavior}\n`;
            if (psych.socialMask) s += `  Social Mask: ${psych.socialMask}\n`;
        }
        // v3.4: Lore plan summary
        if (idea.loreEntryPlan && idea.loreEntryPlan.length) {
            s += `\n[LORE_PLAN — ${idea.loreEntryPlan.length} entries planned]\n`;
            for (const entry of idea.loreEntryPlan) {
                s += `  - ${entry.category}: "${entry.title}" (${entry.activation}, ~${entry.estimatedTokens}t)\n`;
            }
            s += '[/LORE_PLAN]\n';
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
