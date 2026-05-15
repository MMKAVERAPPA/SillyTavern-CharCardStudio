// ui/lorebook-panel.js
// v3.3 — Target banner, create-new selector, staged entries, search/filter

import { CATEGORY_ICONS } from '../core/worldinfo.js';

export class LorebookPanel {
    constructor() {
        this.container = null;
        this.searchQuery = '';
        this.filterCategory = 'all';
        this._targetBook = '';   // persisted across search/filter re-renders
        this.onInsertEntry = null;
        this.onDiscardEntry = null;
        this.onChooseLorebook = null;   // set by popup.js to trigger the book-selector flow
        this.onSummarizeLorebook = null; // callback for summary generation
        this.onSummaryToggle = null;     // callback when include toggle changes
        this.onSummaryEdit = null;       // callback when summary is manually edited
        this._currentSummary = '';       // current summary text
        this._summaryGenerating = false; // summary generation in progress
        this._summaryIncludeInContext = true; // include in AI context
        this.abortController = null;  // For event listener cleanup
    }

    // ── Cleanup method for event listeners ──────────────────────────────────
    cleanup() {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
    }

    init(containerId, callbacks = {}) {
        this.container = document.getElementById(containerId);
        this.onInsertEntry = callbacks.onInsertEntry;
        this.onDiscardEntry = callbacks.onDiscardEntry;
    }

    render(acceptedEntries = [], pendingEntries = [], targetBook = '', loreEntryPlan = [], recursionMap = [], existingEntries = []) {
        if (!this.container) return;
        // Persist params so search/filter re-renders don't lose them
        if (targetBook) this._targetBook = targetBook;
        this._lastLoreEntryPlan = loreEntryPlan;
        this._lastRecursionMap = recursionMap;
        this._lastExistingEntries = existingEntries;
        this._lastAcceptedEntries = acceptedEntries;
        this._lastPendingEntries = pendingEntries;

        const categories = [...new Set([
            ...acceptedEntries.map(e => e.category || 'General'),
            ...pendingEntries.map(e => e.category || 'General'),
            ...existingEntries.map(e => e.category || 'General'),
        ])].sort();

        this.container.innerHTML = `
            <div class="ccs-lore-panel">
                ${this._renderTargetBanner(targetBook)}
                ${this._renderSummarySection(targetBook)}

                <div class="ccs-lore-controls">
                    <input class="ccs-lore-search" id="ccs-lore-search" type="text" placeholder="🔍 Search entries..." value="${this.searchQuery}">
                    <select class="ccs-select ccs-lore-filter" id="ccs-lore-filter">
                        <option value="all">All Categories</option>
                        ${categories.map(c => `<option value="${c}" ${this.filterCategory === c ? 'selected' : ''}>${CATEGORY_ICONS[c] || '📄'} ${c}</option>`).join('')}
                    </select>
                </div>

                <div class="ccs-lore-stats">
                    <span class="ccs-lore-stat">📖 ${existingEntries.length} existing</span>
                    <span class="ccs-lore-stat">✅ ${acceptedEntries.length} generated</span>
                    <span class="ccs-lore-stat">📋 ${pendingEntries.length} staged</span>
                    <span class="ccs-lore-stat">~${Math.round((existingEntries.reduce((a,e) => a + (e.content?.length || 0), 0) + acceptedEntries.reduce((a,e) => a + (e.content?.length || 0), 0)) / 4)}t total</span>
                </div>

                ${loreEntryPlan.length ? `
                    <div class="ccs-lore-section">
                        <div class="ccs-lore-section-header">
                            <span>📋 Lore Plan (${loreEntryPlan.length} planned)</span>
                            <button class="ccs-lore-toggle-btn">▼</button>
                        </div>
                        <div class="ccs-lore-section-body" style="display:flex; flex-direction:column; gap:6px;">
                            ${loreEntryPlan.map(e => {
                                const exists = acceptedEntries.some(a => a.comment === e.title);
                                return `
                                    <div style="background:var(--ccs-surface2); border:1px solid var(--ccs-border); padding:6px 10px; border-radius:var(--ccs-radius-sm); font-size:0.8rem; opacity:${exists ? '0.5' : '1'};">
                                        <div style="font-weight:600; display:flex; justify-content:space-between;">
                                            <span>${this._escapeHtml(e.category)} | ${this._escapeHtml(e.title)} ${exists ? '(Generated)' : ''}</span>
                                            <span class="ccs-badge ccs-tok-badge">~${e.estimatedTokens}t</span>
                                        </div>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    </div>
                ` : ''}

                ${recursionMap.length ? `
                    <div class="ccs-lore-section">
                        <div class="ccs-lore-section-header">
                            <span>🔗 Recursion Links (${recursionMap.length})</span>
                            <button class="ccs-lore-toggle-btn">▼</button>
                        </div>
                        <div class="ccs-lore-section-body" style="display:flex; flex-direction:column; gap:4px; font-size:0.8rem;">
                            ${recursionMap.map(link => `
                                <div style="background:var(--ccs-surface2); padding:4px 8px; border-radius:4px; border-left:2px solid var(--ccs-accent);">
                                    <strong>${this._escapeHtml(link.from)}</strong> → triggers <strong>${this._escapeHtml(link.to)}</strong> (via "${this._escapeHtml(link.trigger)}")
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}

                ${pendingEntries.length > 0 ? this._renderSection('📋 Staged (not yet inserted)', pendingEntries, 'pending') : ''}
                ${existingEntries.length > 0 ? this._renderSection(`📖 Existing Entries (${existingEntries.length})`, existingEntries, 'existing') : ''}
                ${this._renderAcceptedByCategory(acceptedEntries)}
            </div>
        `;

        this._bindControls(acceptedEntries, pendingEntries, existingEntries);
    }

    _escapeHtml(str) {
        return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    // ── Target banner ───────────────────────────────────────────────────────

    _renderTargetBanner(targetBook) {
        if (targetBook) {
            return `
                <div class="ccs-lore-target-banner ccs-lore-target-set">
                    <span class="ccs-lore-target-icon">📖</span>
                    <span class="ccs-lore-target-name">${targetBook}</span>
                    <button class="ccs-btn ccs-btn-sm ccs-btn-ghost" id="ccs-change-lorebook-btn">Change</button>
                </div>
            `;
        }
        return `
            <div class="ccs-lore-target-banner ccs-lore-target-unset">
                <span>⚠️ No lorebook selected</span>
                <button class="ccs-btn ccs-btn-sm ccs-btn-primary" id="ccs-choose-lorebook-btn">Choose Lorebook</button>
            </div>
        `;
    }

    // ── Summary section ────────────────────────────────────────

    _renderSummarySection(targetBook) {
        if (!targetBook) return '';
        
        const summary = this._currentSummary || '';
        const isGenerating = this._summaryGenerating || false;
        const includeInContext = this._summaryIncludeInContext !== false;
        
        return `
            <div class="ccs-lore-section ccs-lore-summary-section">
                <div class="ccs-lore-section-header" style="cursor:pointer" id="ccs-summary-header">
                    <span>📝 Lorebook Summary (Editable)</span>
                    <button class="ccs-lore-toggle-btn" id="ccs-summary-toggle">▼</button>
                </div>
                <div class="ccs-lore-section-body" id="ccs-summary-body" style="${summary ? '' : 'display:none'}">
                    <textarea 
                        class="ccs-textarea ccs-w100" 
                        id="ccs-lore-summary-text" 
                        rows="6" 
                        placeholder="${isGenerating ? 'Generating summary...' : 'Click \"Summarize Lorebook\" to generate an AI summary of all entries...'}"
                        ${isGenerating ? 'disabled' : ''}>${this._escapeHtml(summary)}</textarea>
                    <div style="display:flex; gap:8px; margin-top:8px; flex-wrap:wrap; align-items:center">
                        <button class="ccs-btn ccs-btn-primary" id="ccs-summarize-btn" ${isGenerating ? 'disabled' : ''}>
                            ${isGenerating ? '⏳ Generating...' : '🔄 Summarize Lorebook'}
                        </button>
                        <label class="ccs-toggle-label" style="margin:0; font-size:0.85rem">
                            <input type="checkbox" id="ccs-summary-include-toggle" ${includeInContext ? 'checked' : ''}>
                            <span>📤 Include in AI Context</span>
                        </label>
                        ${summary ? `<span class="ccs-badge" style="margin-left:auto">~${Math.round(summary.length / 4)}t</span>` : ''}
                    </div>
                </div>
            </div>
        `;
    }

    // ── Book selector (with Create New option) ──────────────────────────────

    renderBookSelector(books, onSelect, { showCreateNew = false } = {}) {
        if (!this.container) return;
        // Remove any existing selector
        this.container.querySelector('.ccs-book-selector')?.remove();

        const selector = document.createElement('div');
        selector.className = 'ccs-book-selector';
        selector.innerHTML = `
            <div class="ccs-book-selector-inner">
                <div class="ccs-book-label">📖 Select lorebook:</div>
                <select class="ccs-select ccs-w100" id="ccs-book-select">
                    <option value="">— Select existing —</option>
                    ${books.map(b => `<option value="${b}">${b}</option>`).join('')}
                </select>
                <button class="ccs-btn ccs-btn-primary ccs-w100" id="ccs-book-confirm-btn">✅ Use Selected</button>
                ${showCreateNew ? `
                    <div class="ccs-book-divider">— or —</div>
                    <button class="ccs-btn ccs-btn-secondary ccs-w100" id="ccs-book-create-btn">✨ Create New Lorebook</button>
                ` : ''}
            </div>
        `;

        selector.querySelector('#ccs-book-confirm-btn').addEventListener('click', () => {
            const name = selector.querySelector('#ccs-book-select').value;
            if (name) { onSelect(name); selector.remove(); }
        });

        if (showCreateNew) {
            selector.querySelector('#ccs-book-create-btn')?.addEventListener('click', () => {
                onSelect('__create_new__');
                selector.remove();
            });
        }

        this.container.prepend(selector);
    }

    _renderAcceptedByCategory(entries) {
        if (!entries.length) {
            return '<div class="ccs-lore-empty">No entries accepted yet. Generate some in the chat!</div>';
        }

        const filtered = entries.filter(e => {
            const matchSearch = !this.searchQuery ||
                (e.comment || '').toLowerCase().includes(this.searchQuery.toLowerCase()) ||
                (e.keys || []).some(k => k.toLowerCase().includes(this.searchQuery.toLowerCase())) ||
                (e.content || '').toLowerCase().includes(this.searchQuery.toLowerCase());
            const matchCat = this.filterCategory === 'all' || (e.category || 'General') === this.filterCategory;
            return matchSearch && matchCat;
        });

        if (!filtered.length) return '<div class="ccs-lore-empty">No entries match the filter.</div>';

        const byCat = {};
        for (const e of filtered) {
            const cat = e.category || 'General';
            if (!byCat[cat]) byCat[cat] = [];
            byCat[cat].push(e);
        }

        return Object.entries(byCat).map(([cat, es]) =>
            this._renderSection(`${CATEGORY_ICONS[cat] || '📄'} ${cat} (${es.length})`, es, 'accepted')
        ).join('');
    }

    _renderSection(title, entries, type) {
        return `
            <div class="ccs-lore-section">
                <div class="ccs-lore-section-header">
                    <span>${title}</span>
                    <button class="ccs-lore-toggle-btn">▼</button>
                </div>
                <div class="ccs-lore-section-body">
                    ${entries.map(e => this._renderEntryCard(e, type)).join('')}
                </div>
            </div>
        `;
    }

    _renderEntryCard(entry, type) {
        const keys = (entry.keys || entry.key || []).slice(0, 4).join(', ');
        const secKeys = (entry.secondary_keys || entry.keysecondary || []).slice(0, 3).join(', ');
        const tokens = Math.round((entry.content || '').length / 4);
        const posLabels = ['Before Char Defs','After Char Defs','Before Examples','After Examples','AN Top','AN Bottom','At Depth','Outlet'];
        const posLabel = posLabels[entry.position] || 'After Char Defs';
        const isConstant = entry.constant ? '🔵 Constant' : '';
        const tempId = entry._tempId || entry.uid || '';
        const isExisting = type === 'existing';

        return `
            <div class="ccs-lore-entry ${type === 'pending' ? 'ccs-lore-pending' : isExisting ? 'ccs-lore-existing' : ''}" data-tempid="${tempId}">
                <div class="ccs-lore-entry-header">
                    <span class="ccs-lore-title">${entry.comment || entry.name || 'Untitled'}</span>
                    <span class="ccs-lore-badges">
                        ${isConstant ? `<span class="ccs-badge ccs-badge-constant">${isConstant}</span>` : ''}
                        ${isExisting ? '<span class="ccs-badge ccs-badge-existing">📖 Existing</span>' : ''}
                        <span class="ccs-badge">${posLabel}</span>
                        <span class="ccs-badge ccs-tok-badge">~${tokens}t</span>
                        ${type === 'pending' ? `
                            <button class="ccs-entry-btn ccs-insert-btn" data-tempid="${tempId}" title="Insert into lorebook">💾</button>
                            <button class="ccs-entry-btn ccs-discard-btn" data-tempid="${tempId}" title="Discard">🗑</button>
                        ` : ''}
                    </span>
                </div>
                <div class="ccs-lore-entry-meta">
                    ${keys ? `<div class="ccs-lore-meta-row"><span class="ccs-meta-label">Keys:</span> <span class="ccs-meta-keys">${keys}</span></div>` : ''}
                    ${secKeys ? `<div class="ccs-lore-meta-row"><span class="ccs-meta-label">Secondary:</span> ${secKeys}</div>` : ''}
                    <div class="ccs-lore-meta-row"><span class="ccs-meta-label">Order:</span> ${entry.insertion_order || entry.order || 100} | Prob: ${entry.probability ?? 100}%</div>
                </div>
                <details class="ccs-lore-entry-content-details">
                    <summary>Show content</summary>
                    <pre class="ccs-lore-content">${(entry.content || '').replace(/</g,'&lt;')}</pre>
                </details>
            </div>
        `;
    }

    _bindControls(acceptedEntries, pendingEntries, existingEntries = []) {
        // ✅ MEMORY LEAK FIX: Cleanup old listeners before attaching new ones
        this.cleanup();
        
        // Create new AbortController for this binding session
        this.abortController = new AbortController();
        const signal = this.abortController.signal;

        const searchEl = document.getElementById('ccs-lore-search');
        const filterEl = document.getElementById('ccs-lore-filter');

        searchEl?.addEventListener('input', () => {
            this.searchQuery = searchEl.value;
            this.render(acceptedEntries, pendingEntries, this._targetBook, this._lastLoreEntryPlan, this._lastRecursionMap, existingEntries);
        }, { signal });
        filterEl?.addEventListener('change', () => {
            this.filterCategory = filterEl.value;
            this.render(acceptedEntries, pendingEntries, this._targetBook, this._lastLoreEntryPlan, this._lastRecursionMap, existingEntries);
        }, { signal });

        // Section toggles
        this.container.querySelectorAll('.ccs-lore-toggle-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const body = btn.closest('.ccs-lore-section').querySelector('.ccs-lore-section-body');
                body.style.display = body.style.display === 'none' ? '' : 'none';
                btn.textContent = body.style.display === 'none' ? '▶' : '▼';
            }, { signal });
        });

        // Individual entry insert/discard (for pending)
        this.container.querySelectorAll('.ccs-insert-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const tempId = parseFloat(btn.dataset.tempid);
                const entry = pendingEntries.find(p => p._tempId === tempId);
                if (entry) this.onInsertEntry?.(entry);
            }, { signal });
        });
        this.container.querySelectorAll('.ccs-discard-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const tempId = parseFloat(btn.dataset.tempid);
                this.onDiscardEntry?.(tempId);
                this.render(acceptedEntries, pendingEntries.filter(p => p._tempId !== tempId), this._targetBook, this._lastLoreEntryPlan, this._lastRecursionMap, existingEntries);
            }, { signal });
        });
        // Banner buttons (choose / change lorebook)
        this.container.querySelector('#ccs-choose-lorebook-btn')
            ?.addEventListener('click', () => this.onChooseLorebook?.(), { signal });
        this.container.querySelector('#ccs-change-lorebook-btn')
            ?.addEventListener('click', () => this.onChooseLorebook?.(), { signal });
        
        // Summary section toggle
        this.container.querySelector('#ccs-summary-header')?.addEventListener('click', () => {
            const body = document.getElementById('ccs-summary-body');
            const toggle = document.getElementById('ccs-summary-toggle');
            if (body && toggle) {
                body.style.display = body.style.display === 'none' ? '' : 'none';
                toggle.textContent = body.style.display === 'none' ? '▶' : '▼';
            }
        }, { signal });
        
        // Summary generation button
        this.container.querySelector('#ccs-summarize-btn')?.addEventListener('click', () => {
            this.onSummarizeLorebook?.();
        }, { signal });
        
        // Summary include toggle
        this.container.querySelector('#ccs-summary-include-toggle')?.addEventListener('change', (e) => {
            this._summaryIncludeInContext = e.target.checked;
            this.onSummaryToggle?.(e.target.checked);
        }, { signal });
        
        // Summary text editing
        this.container.querySelector('#ccs-lore-summary-text')?.addEventListener('input', (e) => {
            this._currentSummary = e.target.value;
            this.onSummaryEdit?.(e.target.value);
        }, { signal });
    }
    
    // ── Summary management ──────────────────────────────────────
    
    setSummary(summary, includeInContext = true) {
        this._currentSummary = summary || '';
        this._summaryIncludeInContext = includeInContext;
        // Re-render to update UI if container exists
        if (this.container && this._lastAcceptedEntries) {
            this.render(
                this._lastAcceptedEntries,
                this._lastPendingEntries || [],
                this._targetBook,
                this._lastLoreEntryPlan || [],
                this._lastRecursionMap || [],
                this._lastExistingEntries || []
            );
        }
    }
    
    setSummaryGenerating(isGenerating) {
        this._summaryGenerating = isGenerating;
        // Update button text and disable state
        if (this.container) {
            const btn = this.container.querySelector('#ccs-summarize-btn');
            const textarea = this.container.querySelector('#ccs-lore-summary-text');
            if (btn) {
                btn.disabled = isGenerating;
                btn.innerHTML = isGenerating ? '⏳ Generating...' : '🔄 Summarize Lorebook';
            }
            if (textarea) {
                textarea.disabled = isGenerating;
                if (isGenerating && !textarea.value) {
                    textarea.placeholder = 'Generating summary...';
                }
            }
        }
    }
    
    getSummary() {
        return this._currentSummary;
    }
    
    getSummaryIncludeInContext() {
        return this._summaryIncludeInContext;
    }
}

export const lorebookPanel = new LorebookPanel();
