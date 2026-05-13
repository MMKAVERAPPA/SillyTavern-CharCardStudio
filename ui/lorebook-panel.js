// ui/lorebook-panel.js
// v3.3 — Target banner, create-new selector, staged entries, search/filter

import { CATEGORY_ICONS } from '../core/worldinfo.js';

export class LorebookPanel {
    constructor() {
        this.container = null;
        this.searchQuery = '';
        this.filterCategory = 'all';
        this.onInsertEntry = null;
        this.onDiscardEntry = null;
    }

    init(containerId, callbacks = {}) {
        this.container = document.getElementById(containerId);
        this.onInsertEntry = callbacks.onInsertEntry;
        this.onDiscardEntry = callbacks.onDiscardEntry;
    }

    render(acceptedEntries = [], pendingEntries = [], targetBook = '') {
        if (!this.container) return;

        const categories = [...new Set([
            ...acceptedEntries.map(e => e.category || 'General'),
            ...pendingEntries.map(e => e.category || 'General'),
        ])].sort();

        this.container.innerHTML = `
            <div class="ccs-lore-panel">
                ${this._renderTargetBanner(targetBook)}

                <div class="ccs-lore-controls">
                    <input class="ccs-lore-search" id="ccs-lore-search" type="text" placeholder="🔍 Search entries..." value="${this.searchQuery}">
                    <select class="ccs-select ccs-lore-filter" id="ccs-lore-filter">
                        <option value="all">All Categories</option>
                        ${categories.map(c => `<option value="${c}" ${this.filterCategory === c ? 'selected' : ''}>${CATEGORY_ICONS[c] || '📄'} ${c}</option>`).join('')}
                    </select>
                </div>

                <div class="ccs-lore-stats">
                    <span class="ccs-lore-stat">✅ ${acceptedEntries.length} accepted</span>
                    <span class="ccs-lore-stat">📋 ${pendingEntries.length} staged</span>
                    <span class="ccs-lore-stat">~${Math.round(acceptedEntries.reduce((a,e) => a + (e.content?.length || 0), 0) / 4)}t total</span>
                </div>

                ${pendingEntries.length > 0 ? this._renderSection('📋 Staged (not yet inserted)', pendingEntries, 'pending') : ''}
                ${this._renderAcceptedByCategory(acceptedEntries)}
            </div>
        `;

        this._bindControls(acceptedEntries, pendingEntries);
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
        const keys = (entry.keys || []).slice(0, 4).join(', ');
        const secKeys = (entry.secondary_keys || []).slice(0, 3).join(', ');
        const tokens = Math.round((entry.content || '').length / 4);
        const posLabels = ['Before Char Defs','After Char Defs','Before Examples','After Examples','AN Top','AN Bottom','At Depth','Outlet'];
        const posLabel = posLabels[entry.position] || 'After Char Defs';
        const isConstant = entry.constant ? '🔵 Constant' : '';
        const tempId = entry._tempId || entry.uid || '';

        return `
            <div class="ccs-lore-entry ${type === 'pending' ? 'ccs-lore-pending' : ''}" data-tempid="${tempId}">
                <div class="ccs-lore-entry-header">
                    <span class="ccs-lore-title">${entry.comment || 'Untitled'}</span>
                    <span class="ccs-lore-badges">
                        ${isConstant ? `<span class="ccs-badge ccs-badge-constant">${isConstant}</span>` : ''}
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
                    <div class="ccs-lore-meta-row"><span class="ccs-meta-label">Order:</span> ${entry.insertion_order || 100} | Prob: ${entry.probability ?? 100}%</div>
                </div>
                <details class="ccs-lore-entry-content-details">
                    <summary>Show content</summary>
                    <pre class="ccs-lore-content">${(entry.content || '').replace(/</g,'&lt;')}</pre>
                </details>
            </div>
        `;
    }

    _bindControls(acceptedEntries, pendingEntries) {
        const searchEl = document.getElementById('ccs-lore-search');
        const filterEl = document.getElementById('ccs-lore-filter');

        searchEl?.addEventListener('input', () => {
            this.searchQuery = searchEl.value;
            this.render(acceptedEntries, pendingEntries);
        });
        filterEl?.addEventListener('change', () => {
            this.filterCategory = filterEl.value;
            this.render(acceptedEntries, pendingEntries);
        });

        // Section toggles
        this.container.querySelectorAll('.ccs-lore-toggle-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const body = btn.closest('.ccs-lore-section').querySelector('.ccs-lore-section-body');
                body.style.display = body.style.display === 'none' ? '' : 'none';
                btn.textContent = body.style.display === 'none' ? '▶' : '▼';
            });
        });

        // Individual entry insert/discard (for pending)
        this.container.querySelectorAll('.ccs-insert-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const tempId = parseFloat(btn.dataset.tempid);
                const entry = pendingEntries.find(p => p._tempId === tempId);
                if (entry) this.onInsertEntry?.(entry);
            });
        });
        this.container.querySelectorAll('.ccs-discard-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const tempId = parseFloat(btn.dataset.tempid);
                this.onDiscardEntry?.(tempId);
                this.render(acceptedEntries, pendingEntries.filter(p => p._tempId !== tempId));
            });
        });
    }
}

export const lorebookPanel = new LorebookPanel();
