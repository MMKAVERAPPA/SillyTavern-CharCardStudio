// ui/settings-modal.js
// Settings modal: API config, utility API, tone profile, snippet library

import { memoryManager } from '../core/memory.js';
import { apiManager } from '../core/api.js';
import { statsManager } from '../core/stats.js';

export class SettingsModal {
    constructor() {
        this.el = null;
        this.snippetEditId = null;
    }

    open() {
        document.getElementById('ccs-settings-modal')?.remove();
        this._build();
        document.body.appendChild(this.el);
        this._bind();
        this._renderStats();
    }

    _renderStats() {
        const stats = statsManager.getStats();
        const t = stats.totals || {};
        const grid = this.el.querySelector('#ccs-stats-grid');
        if (!grid) return;
        
        const cards = [
            { label: 'Messages Sent', value: t.messages || 0, icon: '💬' },
            { label: 'Fields Generated', value: t.fieldsGenerated || 0, icon: '✨' },
            { label: 'Variations Made', value: t.variations || 0, icon: '🎲' },
            { label: 'Quick Edits', value: t.quickEdits || 0, icon: '✏️' },
            { label: 'Sessions Created', value: t.sessions || 0, icon: '📂' },
            { label: 'Tokens In', value: (t.tokensIn || 0).toLocaleString(), icon: '📥' },
            { label: 'Tokens Out', value: (t.tokensOut || 0).toLocaleString(), icon: '📤' }
        ];
        
        grid.innerHTML = cards.map(c => `
            <div style="background:var(--ccs-surface3); padding:12px; border-radius:var(--ccs-radius-sm); border:1px solid var(--ccs-border); display:flex; flex-direction:column; align-items:center; text-align:center;">
                <div style="font-size:1.5rem; margin-bottom:4px;">${c.icon}</div>
                <div style="font-size:1.2rem; font-weight:700; color:var(--ccs-text);">${c.value}</div>
                <div style="font-size:0.75rem; color:var(--ccs-text3); text-transform:uppercase; letter-spacing:0.5px;">${c.label}</div>
            </div>
        `).join('');
    }

    _build() {
        const s = memoryManager.getGlobalSettings();
        const tone = s.voiceToneProfile || {};
        const snippets = memoryManager.getSnippets();

        this.el = document.createElement('div');
        this.el.id = 'ccs-settings-modal';
        this.el.className = 'ccs-modal-overlay';
        this.el.innerHTML = `
            <div class="ccs-modal ccs-settings-modal-inner">
                <div class="ccs-modal-header">
                    <span>⚙️ Character Card Studio Settings</span>
                    <button class="ccs-modal-close" id="ccs-settings-close">✕</button>
                </div>
                <div class="ccs-modal-body">

                    <!-- Tab bar -->
                    <div class="ccs-settings-tabs">
                        <button class="ccs-stab active" data-tab="api">🔗 API</button>
                        <button class="ccs-stab" data-tab="tone">🎨 Tone</button>
                        <button class="ccs-stab" data-tab="snippets">📌 Snippets</button>
                        <button class="ccs-stab" data-tab="session">🔧 Session</button>
                        <button class="ccs-stab" data-tab="stats">📊 Stats</button>
                    </div>

                    <!-- API Tab -->
                    <div class="ccs-stab-panel active" id="ccs-tab-panel-api">
                        <div class="ccs-setting-section">
                            <div class="ccs-setting-label">Primary API (for card writing)</div>
                            <select class="ccs-select ccs-w100" id="ccs-api-mode">
                                <option value="current" ${s.apiMode==='current'?'selected':''}>🔗 Use ST's current connection</option>
                                <option value="profile" ${s.apiMode==='profile'?'selected':''}>👤 Use a connection profile</option>
                            </select>
                            <div id="ccs-profile-row" style="${s.apiMode==='profile'?'':'display:none'}; margin-top:8px;">
                                <input class="ccs-input ccs-w100" id="ccs-profile-name" placeholder="Profile name (exact match)" value="${s.selectedProfile||''}">
                            </div>
                            <div class="ccs-setting-hint">Uses whatever API is configured in SillyTavern. Switch to Profile mode to temporarily swap connection presets during generation.</div>
                        </div>

                        <div class="ccs-setting-section">
                            <div class="ccs-setting-label">Utility API (for background checks)</div>
                            <div class="ccs-setting-hint">Pillar detection, conflict checks, auto-tags, version summaries. A fast/cheap model here saves cost without affecting card quality.</div>
                            <select class="ccs-select ccs-w100" id="ccs-util-mode">
                                <option value="same" ${s.utilityApiMode==='same'?'selected':''}>↳ Same as primary</option>
                                <option value="custom" ${s.utilityApiMode==='custom'?'selected':''}>⚙️ Custom OpenAI-compatible endpoint</option>
                            </select>
                            <div id="ccs-util-custom-row" style="${s.utilityApiMode==='custom'?'':'display:none'}; margin-top:8px;">
                                <input class="ccs-input ccs-w100" id="ccs-util-endpoint" placeholder="Endpoint URL (e.g. https://openrouter.ai/api/v1)" value="${s.utilityEndpoint||''}">
                                <input class="ccs-input ccs-w100" id="ccs-util-apikey" type="password" placeholder="API Key" value="${s.utilityApiKey||''}">
                                <input class="ccs-input ccs-w100" id="ccs-util-model" placeholder="Model (e.g. google/gemini-flash-1.5)" value="${s.utilityModel||''}">
                            </div>
                        </div>

                        <div class="ccs-setting-section">
                            <div class="ccs-setting-label">Custom System Prompt Rules</div>
                            <textarea class="ccs-textarea ccs-w100" id="ccs-custom-rules" rows="4" placeholder="Additional rules appended to every system prompt...">${s.customSystemPromptRules||''}</textarea>
                        </div>
                    </div>

                    <!-- Tone Tab -->
                    <div class="ccs-stab-panel" id="ccs-tab-panel-tone">
                        <div class="ccs-setting-section">
                            <div class="ccs-setting-label">POV</div>
                            <select class="ccs-select ccs-w100" id="ccs-tone-pov">
                                <option value="third" ${tone.pov==='third'?'selected':''}>Third person (she/he/they)</option>
                                <option value="first" ${tone.pov==='first'?'selected':''}>First person (I/me/my)</option>
                            </select>
                        </div>
                        <div class="ccs-setting-section">
                            <div class="ccs-setting-label">Action Format</div>
                            <select class="ccs-select ccs-w100" id="ccs-tone-action">
                                <option value="asterisk" ${tone.actionFormat==='asterisk'?'selected':''}>*Asterisks*</option>
                                <option value="italic" ${tone.actionFormat==='italic'?'selected':''}>_Italics_</option>
                                <option value="none" ${tone.actionFormat==='none'?'selected':''}>No formatting</option>
                            </select>
                        </div>
                        <div class="ccs-setting-section">
                            <div class="ccs-setting-label">Prose Density</div>
                            <select class="ccs-select ccs-w100" id="ccs-tone-density">
                                <option value="terse" ${tone.proseDensity==='terse'?'selected':''}>Terse — short, punchy sentences</option>
                                <option value="balanced" ${tone.proseDensity==='balanced'?'selected':''}>Balanced</option>
                                <option value="rich" ${tone.proseDensity==='rich'?'selected':''}>Rich — layered, literary prose</option>
                            </select>
                        </div>
                        <div class="ccs-setting-section">
                            <div class="ccs-setting-label">Formality Register</div>
                            <select class="ccs-select ccs-w100" id="ccs-tone-formality">
                                <option value="casual" ${tone.formalityRegister==='casual'?'selected':''}>Casual</option>
                                <option value="neutral" ${tone.formalityRegister==='neutral'?'selected':''}>Neutral</option>
                                <option value="formal" ${tone.formalityRegister==='formal'?'selected':''}>Formal</option>
                            </select>
                        </div>
                    </div>

                    <!-- Snippets Tab -->
                    <div class="ccs-stab-panel" id="ccs-tab-panel-snippets">
                        <div class="ccs-snippet-add">
                            <input class="ccs-input" id="ccs-snip-name" placeholder="Snippet name">
                            <input class="ccs-input" id="ccs-snip-category" placeholder="Category (optional)">
                            <textarea class="ccs-textarea ccs-w100" id="ccs-snip-content" rows="4" placeholder="Snippet content — injected into prompts on demand"></textarea>
                            <button class="ccs-btn ccs-btn-primary" id="ccs-snip-add-btn">➕ Add Snippet</button>
                        </div>
                        <div class="ccs-snippet-list" id="ccs-snippet-list">
                            ${snippets.length ? snippets.map(s => this._renderSnippet(s)).join('') : '<div class="ccs-muted">No snippets yet.</div>'}
                        </div>
                    </div>

                    <!-- Session Tab -->
                    <div class="ccs-stab-panel" id="ccs-tab-panel-session">
                        <div class="ccs-setting-section">
                            <div class="ccs-setting-label">Compression Threshold</div>
                            <input class="ccs-input" type="number" id="ccs-compression" value="${s.compressionThreshold||15}" min="5" max="50">
                            <div class="ccs-setting-hint">Number of messages before session history is compressed to preserve context. Lower = more frequent compression.</div>
                        </div>
                        <div class="ccs-setting-section">
                            <div class="ccs-setting-label">Parallel API Calls</div>
                            <label class="ccs-toggle-label">
                                <input type="checkbox" id="ccs-parallel-api" ${s.parallelApiCalls !== false ? 'checked' : ''}>
                                <span>Enable parallel API calls (variations, batch greetings)</span>
                            </label>
                            <div class="ccs-setting-hint">When enabled, variations and batch operations fire multiple API calls simultaneously. Disable if you're getting rate-limited (429 errors).</div>
                        </div>
                        <div class="ccs-setting-section">
                            <div class="ccs-setting-label">Danger Zone</div>
                            <button class="ccs-btn ccs-btn-danger" id="ccs-clear-all-sessions-btn">🗑 Clear All Sessions</button>
                        </div>
                    </div>

                    <!-- Stats Tab -->
                    <div class="ccs-stab-panel" id="ccs-tab-panel-stats">
                        <div class="ccs-setting-section">
                            <div class="ccs-setting-label">Usage Statistics</div>
                            <div class="ccs-stats-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:10px;" id="ccs-stats-grid">
                                <!-- Stats injected here -->
                            </div>
                        </div>
                    </div>

                </div>
                <div class="ccs-modal-footer">
                    <button class="ccs-btn ccs-btn-ghost" id="ccs-settings-cancel">Cancel</button>
                    <button class="ccs-btn ccs-btn-primary" id="ccs-settings-save">✅ Save Settings</button>
                </div>
            </div>
        `;
    }

    _bind() {
        const s = memoryManager.getGlobalSettings();

        // Tab switching
        this.el.querySelectorAll('.ccs-stab').forEach(tab => {
            tab.addEventListener('click', () => {
                this.el.querySelectorAll('.ccs-stab').forEach(t => t.classList.remove('active'));
                this.el.querySelectorAll('.ccs-stab-panel').forEach(p => p.classList.remove('active'));
                tab.classList.add('active');
                document.getElementById(`ccs-tab-panel-${tab.dataset.tab}`)?.classList.add('active');
            });
        });

        // API mode toggle
        document.getElementById('ccs-api-mode')?.addEventListener('change', (e) => {
            document.getElementById('ccs-profile-row').style.display = e.target.value === 'profile' ? '' : 'none';
        });
        document.getElementById('ccs-util-mode')?.addEventListener('change', (e) => {
            document.getElementById('ccs-util-custom-row').style.display = e.target.value === 'custom' ? '' : 'none';
        });

        // Snippet add
        document.getElementById('ccs-snip-add-btn')?.addEventListener('click', () => {
            const name = document.getElementById('ccs-snip-name')?.value.trim();
            const content = document.getElementById('ccs-snip-content')?.value.trim();
            const category = document.getElementById('ccs-snip-category')?.value.trim() || 'General';
            if (!name || !content) return;
            const snippet = memoryManager.addSnippet(name, content, category);
            const list = document.getElementById('ccs-snippet-list');
            if (list) {
                const empty = list.querySelector('.ccs-muted');
                empty?.remove();
                list.insertAdjacentHTML('beforeend', this._renderSnippet(snippet));
                this._bindSnippetButtons(list);
            }
            document.getElementById('ccs-snip-name').value = '';
            document.getElementById('ccs-snip-content').value = '';
        });

        this._bindSnippetButtons(document.getElementById('ccs-snippet-list'));

        // Clear sessions
        document.getElementById('ccs-clear-all-sessions-btn')?.addEventListener('click', () => {
            if (confirm('Clear ALL Character Card Studio sessions? This cannot be undone.')) {
                memoryManager.settings.sessions = {};
                memoryManager.save();
                alert('All sessions cleared.');
            }
        });

        // Close
        document.getElementById('ccs-settings-close')?.addEventListener('click', () => this.close());
        document.getElementById('ccs-settings-cancel')?.addEventListener('click', () => this.close());
        this.el.addEventListener('click', (e) => { if (e.target === this.el) this.close(); });

        // Save
        document.getElementById('ccs-settings-save')?.addEventListener('click', () => this._save());
    }

    _save() {
        const updates = {
            apiMode:            document.getElementById('ccs-api-mode')?.value || 'current',
            selectedProfile:    document.getElementById('ccs-profile-name')?.value.trim() || '',
            utilityApiMode:     document.getElementById('ccs-util-mode')?.value || 'same',
            utilityEndpoint:    document.getElementById('ccs-util-endpoint')?.value.trim() || '',
            utilityApiKey:      document.getElementById('ccs-util-apikey')?.value.trim() || '',
            utilityModel:       document.getElementById('ccs-util-model')?.value.trim() || '',
            customSystemPromptRules: document.getElementById('ccs-custom-rules')?.value || '',
            compressionThreshold: parseInt(document.getElementById('ccs-compression')?.value) || 15,
            parallelApiCalls: document.getElementById('ccs-parallel-api')?.checked !== false,
            voiceToneProfile: {
                pov:               document.getElementById('ccs-tone-pov')?.value || 'third',
                actionFormat:      document.getElementById('ccs-tone-action')?.value || 'asterisk',
                proseDensity:      document.getElementById('ccs-tone-density')?.value || 'balanced',
                formalityRegister: document.getElementById('ccs-tone-formality')?.value || 'neutral',
            },
        };
        memoryManager.updateGlobalSettings(updates);
        this.close();
    }

    _renderSnippet(snippet) {
        return `
            <div class="ccs-snippet-item" data-id="${snippet.id}">
                <div class="ccs-snippet-header">
                    <span class="ccs-snippet-name">${snippet.name}</span>
                    <span class="ccs-snippet-cat">${snippet.category}</span>
                    <button class="ccs-btn ccs-btn-ghost ccs-snip-del-btn" data-id="${snippet.id}">🗑</button>
                </div>
                <pre class="ccs-snippet-preview">${(snippet.content || '').substring(0, 100)}${snippet.content?.length > 100 ? '...' : ''}</pre>
            </div>
        `;
    }

    _bindSnippetButtons(container) {
        container?.querySelectorAll('.ccs-snip-del-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                memoryManager.deleteSnippet(btn.dataset.id);
                btn.closest('.ccs-snippet-item')?.remove();
            });
        });
    }

    close() {
        this.el?.remove();
        this.el = null;
    }
}

export const settingsModal = new SettingsModal();
