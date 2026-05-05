// ui/card-panel.js
// Card status board: per-field status, token meter, preview drawer, version timeline, quick action buttons

import { cardManager, FIELD_LABELS } from '../core/card.js';
import { memoryManager } from '../core/memory.js';
import { auditEngine } from '../core/audit.js';

export const FIELD_STATUS = {
    EMPTY:       'empty',
    IN_PROGRESS: 'in_progress',
    GENERATED:   'generated',
    ACCEPTED:    'accepted',
};

const BOARD_FIELDS = [
    'name','description','personality','scenario','first_mes','mes_example',
    'system_prompt','creator_notes','alternate_greetings','tags',
];

export class CardPanel {
    constructor() {
        this.container = null;
        this.fieldStatuses = {};
        this.cardFields = null;
        this.session = null;
        this.callbacks = {};
        this.expandedField = null;
    }

    init(containerId, cardFields, session, callbacks = {}) {
        this.container = document.getElementById(containerId);
        this.cardFields = cardFields;
        this.session = session;
        this.callbacks = callbacks;
        BOARD_FIELDS.forEach(f => { this.fieldStatuses[f] = FIELD_STATUS.EMPTY; });
        this._detectExistingContent();
        this.render();
    }

    _detectExistingContent() {
        if (!this.cardFields) return;
        for (const field of BOARD_FIELDS) {
            const v = this.cardFields[field];
            const hasContent = Array.isArray(v) ? v.length > 0 : (typeof v === 'string' && v.trim().length > 0);
            if (hasContent) this.fieldStatuses[field] = FIELD_STATUS.ACCEPTED;
        }
    }

    setFieldStatus(fieldName, status) {
        this.fieldStatuses[fieldName] = status;
        this._updateFieldRow(fieldName);
        this._updateTokenBudget();
    }

    updateCardFields(cardFields) {
        this.cardFields = cardFields;
        this._detectExistingContent();
        this.render();
    }

    render() {
        if (!this.container) return;
        const tokenCounts = cardManager.getTokenCounts(this.cardFields || {});
        const budget = cardManager.getBudgetAssessment(tokenCounts._total || 0);
        const filled = BOARD_FIELDS.filter(f => this.fieldStatuses[f] === FIELD_STATUS.ACCEPTED || this.fieldStatuses[f] === FIELD_STATUS.GENERATED).length;
        const total = BOARD_FIELDS.length;
        const pct = total ? Math.round((filled / total) * 100) : 0;
        const circumference = 2 * Math.PI * 26;
        const dashoffset = circumference - (circumference * pct / 100);

        this.container.innerHTML = `
            <div class="ccs-card-panel">
                <div class="ccs-progress-section">
                    <div class="ccs-progress-ring-wrap">
                        <svg viewBox="0 0 64 64">
                            <defs><linearGradient id="ccs-ring-grad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#7aa2f7"/><stop offset="100%" stop-color="#bb9af7"/></linearGradient></defs>
                            <circle class="ccs-progress-ring-bg" cx="32" cy="32" r="26"/>
                            <circle class="ccs-progress-ring-fill" cx="32" cy="32" r="26" stroke-dasharray="${circumference}" stroke-dashoffset="${dashoffset}"/>
                        </svg>
                        <div class="ccs-progress-label">${filled}/${total}<small>fields</small></div>
                    </div>
                    <div class="ccs-progress-info">
                        <div class="ccs-progress-title">Card Progress</div>
                        <div class="ccs-progress-subtitle">${budget.tokens.toLocaleString()} tokens · ${budget.pct8k}% of 8k context</div>
                    </div>
                </div>

                <div class="ccs-field-actions-global">
                    <button class="ccs-btn ccs-btn-sm ccs-btn-primary" id="ccs-gen-all-btn">⚡ Generate All</button>
                    <button class="ccs-btn ccs-btn-sm ccs-btn-secondary" id="ccs-audit-btn">🔍 Audit Card</button>
                    <button class="ccs-btn ccs-btn-sm ccs-btn-secondary" id="ccs-export-btn">📤 Export Log</button>
                    <button class="ccs-btn ccs-btn-sm ccs-btn-secondary" id="ccs-review-existing-btn">⭐ Review Card</button>
                </div>

                <div class="ccs-detail-level-row">
                    <label>Detail:</label>
                    <select id="ccs-detail-level" class="ccs-select">
                        <option value="quick">Quick</option>
                        <option value="standard" selected>Standard</option>
                        <option value="verbose">Verbose</option>
                    </select>
                    <label>Platform:</label>
                    <select id="ccs-platform-select" class="ccs-select">
                        <option value="chub">Chub</option>
                        <option value="fictionlab">FictionLab</option>
                        <option value="janitor">JanitorAI</option>
                        <option value="personal">Personal</option>
                    </select>
                </div>

                <div class="ccs-field-list" id="ccs-field-list">
                    ${BOARD_FIELDS.map(f => this._buildFieldRow(f, tokenCounts)).join('')}
                </div>

                <div class="ccs-tag-section" id="ccs-tag-section">
                    <div class="ccs-tag-header">
                        <span>🏷 Tags</span>
                        <button class="ccs-btn ccs-btn-sm ccs-btn-ghost" id="ccs-infer-tags-btn">✨ Auto-Infer</button>
                    </div>
                    <div class="ccs-tag-cloud" id="ccs-tag-cloud">
                        ${this._renderTags()}
                    </div>
                    <input id="ccs-tag-input" class="ccs-tag-input" placeholder="Add tag..." type="text">
                </div>
            </div>
        `;

        this._bindEvents();
    }

    _buildFieldRow(fieldName, tokenCounts) {
        const status = this.fieldStatuses[fieldName] || FIELD_STATUS.EMPTY;
        const tokens = typeof tokenCounts?.[fieldName] === 'number' ? tokenCounts[fieldName] :
            (tokenCounts?.[fieldName]?.total || 0);
        const tokenStatus = cardManager.getTokenStatus(fieldName, tokens);
        const label = FIELD_LABELS[fieldName] || fieldName;
        const versions = this.session ? memoryManager.getFieldVersions(this.session, fieldName) : [];

        const statusIcon = { empty:'○', in_progress:'◔', generated:'◑', accepted:'●' }[status] || '○';
        const statusClass = `ccs-field-status-${status}`;
        const hasContent = status === FIELD_STATUS.ACCEPTED || status === FIELD_STATUS.GENERATED;

        // Content snippet (first 80 chars)
        let snippet = '';
        if (hasContent && this.cardFields) {
            const val = this.cardFields[fieldName];
            const raw = Array.isArray(val) ? (val[0] || '').substring(0, 80) : (typeof val === 'string' ? val.substring(0, 80) : '');
            snippet = raw.replace(/\n/g, ' ').trim();
            if (snippet && (Array.isArray(val) ? val[0]?.length > 80 : val?.length > 80)) snippet += '…';
        }

        return `
            <div class="ccs-field-row ${statusClass}" id="ccs-field-row-${fieldName}" data-field="${fieldName}">
                <div class="ccs-field-row-main">
                    <span class="ccs-field-status-icon">${statusIcon}</span>
                    <span class="ccs-field-label">${label}</span>
                    ${tokens > 0 ? `<span class="ccs-token-count ccs-tok-${tokenStatus}">${tokens}t</span>` : ''}
                    <div class="ccs-field-btns">
                        <button class="ccs-field-btn ccs-gen-field-btn" data-field="${fieldName}" title="Generate">🪄</button>
                        <button class="ccs-field-btn ccs-var-field-btn" data-field="${fieldName}" title="Variations">🎲</button>
                        ${hasContent ? `<button class="ccs-field-btn ccs-edit-field-btn" data-field="${fieldName}" title="Quick Edit">✏️</button>` : ''}
                        ${hasContent ? `<button class="ccs-field-btn ccs-preview-field-btn" data-field="${fieldName}" title="Preview">👁</button>` : ''}
                        ${versions.length > 1 ? `<button class="ccs-field-btn ccs-history-btn" data-field="${fieldName}" title="History (${versions.length})">🕐</button>` : ''}
                    </div>
                </div>
                ${snippet ? `<div class="ccs-field-snippet">${this._escHtml(snippet)}</div>` : ''}
                <div class="ccs-field-preview-drawer" id="ccs-preview-${fieldName}" style="display:none;"></div>
                <div class="ccs-field-history-drawer" id="ccs-history-${fieldName}" style="display:none;"></div>
            </div>
        `;
    }

    _updateFieldRow(fieldName) {
        const row = document.getElementById(`ccs-field-row-${fieldName}`);
        if (!row) return;
        const tokenCounts = cardManager.getTokenCounts(this.cardFields || {});
        row.outerHTML = this._buildFieldRow(fieldName, tokenCounts);
        this._bindFieldRow(document.getElementById(`ccs-field-row-${fieldName}`));
    }

    _updateTokenBudget() {
        const tokenCounts = cardManager.getTokenCounts(this.cardFields || {});
        const budget = cardManager.getBudgetAssessment(tokenCounts._total || 0);
        const el = document.getElementById('ccs-token-budget');
        if (el) {
            el.className = `ccs-token-budget ${budget.status}`;
            el.querySelector('.ccs-budget-total').textContent = budget.tokens.toLocaleString() + 't';
        }
    }

    _bindEvents() {
        const list = document.getElementById('ccs-field-list');
        list?.querySelectorAll('.ccs-field-row').forEach(row => this._bindFieldRow(row));

        document.getElementById('ccs-gen-all-btn')?.addEventListener('click', () => this.callbacks.onGenerateAll?.());
        document.getElementById('ccs-audit-btn')?.addEventListener('click', () => this.callbacks.onAudit?.());
        document.getElementById('ccs-export-btn')?.addEventListener('click', () => this.callbacks.onExport?.());
        document.getElementById('ccs-review-existing-btn')?.addEventListener('click', () => this.callbacks.onReviewExisting?.());
        document.getElementById('ccs-infer-tags-btn')?.addEventListener('click', () => this.callbacks.onInferTags?.());

        // Platform select
        const platformSel = document.getElementById('ccs-platform-select');
        if (platformSel) {
            platformSel.value = memoryManager.getGlobalSettings().platformTarget || 'chub';
            platformSel.addEventListener('change', () => {
                memoryManager.updateGlobalSettings({ platformTarget: platformSel.value });
                if (this.session) this.session.ideaMemory.platformTarget = platformSel.value;
            });
        }

        // Tag input
        const tagInput = document.getElementById('ccs-tag-input');
        tagInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && tagInput.value.trim()) {
                this.callbacks.onAddTag?.(tagInput.value.trim());
                tagInput.value = '';
            }
        });
    }

    _bindFieldRow(row) {
        if (!row) return;
        row.querySelector('.ccs-gen-field-btn')?.addEventListener('click', (e) => {
            this.callbacks.onGenerateField?.(e.currentTarget.dataset.field);
        });
        row.querySelector('.ccs-var-field-btn')?.addEventListener('click', (e) => {
            this.callbacks.onVariations?.(e.currentTarget.dataset.field);
        });
        row.querySelector('.ccs-preview-field-btn')?.addEventListener('click', (e) => {
            this._togglePreview(e.currentTarget.dataset.field);
        });
        row.querySelector('.ccs-edit-field-btn')?.addEventListener('click', (e) => {
            this._openQuickEdit(e.currentTarget.dataset.field);
        });
        row.querySelector('.ccs-history-btn')?.addEventListener('click', (e) => {
            this._toggleHistory(e.currentTarget.dataset.field);
        });

        // Quick rewrite buttons shown on hover
        const fieldName = row.dataset.field;
        row.addEventListener('mouseenter', () => this._showQuickActions(row, fieldName));
        row.addEventListener('mouseleave', () => row.querySelector('.ccs-quick-actions')?.remove());
    }

    _showQuickActions(row, fieldName) {
        if (this.fieldStatuses[fieldName] !== FIELD_STATUS.ACCEPTED) return;
        const existing = row.querySelector('.ccs-quick-actions');
        if (existing) return;
        const qa = document.createElement('div');
        qa.className = 'ccs-quick-actions';
        qa.innerHTML = `
            <button class="ccs-qa-btn" data-action="shorten" title="Shorten">✂️</button>
            <button class="ccs-qa-btn" data-action="lengthen" title="Lengthen">📝</button>
            <button class="ccs-qa-btn" data-action="darker" title="Darker">🌑</button>
            <button class="ccs-qa-btn" data-action="specific" title="More Specific">🎯</button>
            <button class="ccs-qa-btn" data-action="elevate" title="Elevate Writing">✨</button>
            <button class="ccs-qa-btn" data-action="fixformat" title="Fix Format">🔧</button>
        `;
        qa.querySelectorAll('.ccs-qa-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.callbacks.onRewriteField?.(fieldName, btn.dataset.action);
            });
        });
        row.appendChild(qa);
    }

    _togglePreview(fieldName) {
        const drawer = document.getElementById(`ccs-preview-${fieldName}`);
        if (!drawer) return;
        if (drawer.style.display !== 'none') { drawer.style.display = 'none'; return; }
        const value = this.cardFields?.[fieldName];
        const content = Array.isArray(value) ? value.join('\n\n---\n\n') : (value || '');
        drawer.innerHTML = `<pre class="ccs-field-preview-content">${content.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre>`;
        drawer.style.display = 'block';
    }

    _toggleHistory(fieldName) {
        const drawer = document.getElementById(`ccs-history-${fieldName}`);
        if (!drawer) return;
        if (drawer.style.display !== 'none') { drawer.style.display = 'none'; return; }
        const versions = this.session ? memoryManager.getFieldVersions(this.session, fieldName) : [];
        if (!versions.length) { drawer.innerHTML = '<em>No history</em>'; drawer.style.display = 'block'; return; }

        drawer.innerHTML = `
            <div class="ccs-history-timeline">
                ${versions.map((v, i) => `
                    <div class="ccs-history-item">
                        <div class="ccs-history-meta">
                            <span class="ccs-history-ver">v${i + 1}${i === versions.length - 1 ? ' (current)' : ''}</span>
                            ${v.summary ? `<span class="ccs-history-summary">${v.summary}</span>` : ''}
                            <span class="ccs-history-time">${new Date(v.timestamp).toLocaleTimeString()}</span>
                        </div>
                        <pre class="ccs-history-content">${(v.content || '').substring(0, 200).replace(/</g,'&lt;')}${(v.content || '').length > 200 ? '...' : ''}</pre>
                        ${i < versions.length - 1 ? `<button class="ccs-btn ccs-btn-sm ccs-btn-ghost ccs-restore-btn" data-field="${fieldName}" data-idx="${i}">↩ Restore v${i + 1}</button>` : ''}
                    </div>
                `).join('<div class="ccs-history-connector"></div>')}
            </div>
        `;
        drawer.querySelectorAll('.ccs-restore-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.idx);
                this.callbacks.onRestoreVersion?.(fieldName, idx);
            });
        });
        drawer.style.display = 'block';
    }

    _renderTags() {
        const tags = this.cardFields?.tags || [];
        if (!tags.length) return '<span class="ccs-tag-empty">No tags yet — click ✨ to auto-infer</span>';
        return tags.map(t =>
            `<span class="ccs-tag-chip">${t} <button class="ccs-tag-remove" data-tag="${t}">✕</button></span>`
        ).join('');
    }

    refreshTags(tags, onRemove) {
        const cloud = document.getElementById('ccs-tag-cloud');
        if (cloud) {
            cloud.innerHTML = this._renderTags();
            cloud.querySelectorAll('.ccs-tag-remove').forEach(btn => {
                btn.addEventListener('click', () => onRemove?.(btn.dataset.tag));
            });
        }
    }

    // ── Quick edit ──────────────────────────────────────────────────────────

    _openQuickEdit(fieldName) {
        const row = document.getElementById(`ccs-field-row-${fieldName}`);
        if (!row || row.querySelector('.ccs-quick-edit-wrap')) return;
        const content = this.cardFields?.[fieldName] || '';
        const val = Array.isArray(content) ? content.join('\n---\n') : String(content);

        const wrap = document.createElement('div');
        wrap.className = 'ccs-quick-edit-wrap';
        wrap.innerHTML = `
            <textarea class="ccs-quick-edit-textarea">${this._escHtml(val)}</textarea>
            <div class="ccs-quick-edit-btns">
                <button class="ccs-btn ccs-btn-sm ccs-btn-ghost ccs-qe-cancel">Cancel</button>
                <button class="ccs-btn ccs-btn-sm ccs-btn-primary ccs-qe-save">Save</button>
            </div>
        `;
        wrap.querySelector('.ccs-qe-cancel').addEventListener('click', () => wrap.remove());
        wrap.querySelector('.ccs-qe-save').addEventListener('click', () => {
            const newVal = wrap.querySelector('textarea').value;
            this.callbacks.onQuickEdit?.(fieldName, newVal);
            wrap.remove();
        });
        row.appendChild(wrap);
        wrap.querySelector('textarea').focus();
    }

    showTagSuggestions(suggestedTags, onAccept) {
        const section = document.getElementById('ccs-tag-section');
        if (!section) return;
        const existing = section.querySelector('.ccs-tag-suggestions');
        existing?.remove();
        const sugg = document.createElement('div');
        sugg.className = 'ccs-tag-suggestions';
        sugg.innerHTML = `
            <div class="ccs-sugg-label">✨ Suggested:</div>
            <div class="ccs-sugg-chips">
                ${suggestedTags.map(t => `<button class="ccs-sugg-chip" data-tag="${t}">${t}</button>`).join('')}
            </div>
            <button class="ccs-btn ccs-btn-sm ccs-btn-primary ccs-add-all-sugg">Add All</button>
        `;
        sugg.querySelectorAll('.ccs-sugg-chip').forEach(btn => {
            btn.addEventListener('click', () => { onAccept([btn.dataset.tag]); btn.classList.add('ccs-sugg-accepted'); });
        });
        sugg.querySelector('.ccs-add-all-sugg').addEventListener('click', () => {
            onAccept(suggestedTags);
            sugg.innerHTML = '<span>✅ All tags added</span>';
        });
        section.appendChild(sugg);
    }

    _escHtml(str) {
        return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }
}

export const cardPanel = new CardPanel();
