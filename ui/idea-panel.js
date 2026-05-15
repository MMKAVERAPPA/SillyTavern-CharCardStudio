// ui/idea-panel.js
// Idea/concept panel: concept rating display, pillar tracker, lore plan, psych profile, key decisions

import { memoryManager } from '../core/memory.js';

export class IdeaPanel {
    constructor() {
        this.container = null;
        this.onResolvePillar = null; // callback(pillarName) -> set by popup.js
        this.abortController = null;  // For event listener cleanup
    }

    // ── Cleanup method for event listeners ──────────────────────────────────
    cleanup() {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
    }

    init(containerId) {
        // ✅ MEMORY LEAK FIX: Cleanup old listeners before attaching new ones
        this.cleanup();
        
        // Create new AbortController for this binding session
        this.abortController = new AbortController();
        const signal = this.abortController.signal;

        this.container = document.getElementById(containerId);
        
        // Use event delegation for resolve buttons
        this.container?.addEventListener('click', (e) => {
            if (e.target.classList.contains('ccs-pillar-resolve-btn')) {
                const name = e.target.dataset.name;
                if (name) this.onResolvePillar?.(name);
            }
        }, { signal });
    }

    render(ideaMemory) {
        if (!this.container || !ideaMemory) return;

        const { conceptName, conceptRating, pillars = [], keyDecisions = [], loreEntryPlan = [], psychProfile = {} } = ideaMemory;
        const resolved = pillars.filter(p => p.resolved);
        const pending = pillars.filter(p => !p.resolved);
        const hasPsych = psychProfile && Object.values(psychProfile).some(v => v);

        this.container.innerHTML = `
            <div class="ccs-idea-panel">
                <div class="ccs-idea-header-row">
                    ${conceptName ? `<div class="ccs-concept-name">💡 ${this._esc(conceptName)}</div>` : '<div class="ccs-concept-name ccs-muted">No concept yet — pitch an idea!</div>'}
                    ${ideaMemory.cardType ? `<span class="ccs-badge" style="text-transform: capitalize;">${ideaMemory.cardType}</span>` : ''}
                    ${ideaMemory.format ? `<span class="ccs-badge" style="text-transform: capitalize;">${ideaMemory.format}</span>` : ''}
                </div>

                ${conceptRating ? this._renderRating(conceptRating) : ''}

                ${pillars.length ? `
                    <div class="ccs-pillar-section">
                        <div class="ccs-pillar-header">
                            Structural Pillars
                            <span class="ccs-pillar-count">${resolved.length}/${pillars.length}</span>
                        </div>
                        <div class="ccs-pillar-progress-track">
                            <div class="ccs-pillar-progress-fill" style="width:${pillars.length ? (resolved.length / pillars.length) * 100 : 0}%"></div>
                        </div>
                        <div class="ccs-pillar-list">
                            ${pillars.map(p => this._renderPillar(p)).join('')}
                        </div>
                    </div>
                ` : ''}

                ${loreEntryPlan.length ? `
                    <div class="ccs-decisions-section" style="margin-top:16px;">
                        <div class="ccs-decisions-header" style="color:var(--ccs-accent);">📚 Planned Lore Entries (${loreEntryPlan.length})</div>
                        <div style="font-size:0.75rem; color:var(--ccs-text3); margin-bottom:8px;">These will be passed to the AI when generating lorebook entries.</div>
                        <div class="ccs-lore-plan-list" style="display:flex; flex-direction:column; gap:6px;">
                            ${loreEntryPlan.map(e => `
                                <div style="background:var(--ccs-surface2); border:1px solid var(--ccs-border); padding:6px 10px; border-radius:var(--ccs-radius-sm); font-size:0.8rem;">
                                    <div style="font-weight:600; display:flex; justify-content:space-between;">
                                        <span>${this._esc(e.category)} | ${this._esc(e.title)}</span>
                                        <span class="ccs-badge ccs-tok-badge">~${e.estimatedTokens}t</span>
                                    </div>
                                    <div style="display:flex; justify-content:space-between; margin-top:4px; font-size:0.75rem;">
                                        <span style="color:var(--ccs-text2);">${this._esc(e.description)}</span>
                                        <span style="color:var(--ccs-text3); font-style:italic;">${this._esc(e.activation)}</span>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}

                ${hasPsych ? `
                    <div class="ccs-decisions-section" style="margin-top:16px;">
                        <div class="ccs-decisions-header">🧠 Psychological Profile</div>
                        <div style="background:var(--ccs-surface2); border:1px solid var(--ccs-border); border-radius:var(--ccs-radius); padding:10px; font-size:0.8rem; line-height:1.4;">
                            ${psychProfile.coreMotivation ? `<div><strong style="color:var(--ccs-text2);">Core Motivation:</strong> ${this._esc(psychProfile.coreMotivation)}</div>` : ''}
                            ${psychProfile.primaryFear ? `<div><strong style="color:var(--ccs-text2);">Primary Fear:</strong> ${this._esc(psychProfile.primaryFear)}</div>` : ''}
                            ${psychProfile.hiddenDesire ? `<div><strong style="color:var(--ccs-text2);">Hidden Desire:</strong> ${this._esc(psychProfile.hiddenDesire)}</div>` : ''}
                            ${psychProfile.centralContradiction ? `<div><strong style="color:var(--ccs-text2);">Contradiction:</strong> ${this._esc(psychProfile.centralContradiction)}</div>` : ''}
                            ${psychProfile.theWound ? `<div><strong style="color:var(--ccs-text2);">The Wound:</strong> ${this._esc(psychProfile.theWound)}</div>` : ''}
                            ${psychProfile.stressBehavior ? `<div><strong style="color:var(--ccs-text2);">Stress Behavior:</strong> ${this._esc(psychProfile.stressBehavior)}</div>` : ''}
                            ${psychProfile.socialMask ? `<div><strong style="color:var(--ccs-text2);">Social Mask:</strong> ${this._esc(psychProfile.socialMask)}</div>` : ''}
                        </div>
                    </div>
                ` : ''}

                ${ideaMemory.voiceProfile ? `
                    <div class="ccs-decisions-section" style="margin-top:16px;">
                        <div class="ccs-decisions-header">🎤 Voice Profile</div>
                        <div style="font-size:0.82rem; color:var(--ccs-text2); padding:4px 0;">${this._esc(ideaMemory.voiceProfile)}</div>
                        ${(ideaMemory.voiceSamples || []).length ? `
                            <details style="margin-top:4px;">
                                <summary style="font-size:0.78rem; color:var(--ccs-text3); cursor:pointer;">
                                    ${ideaMemory.voiceSamples.length} sample(s) — click to preview
                                </summary>
                                ${ideaMemory.voiceSamples.map((s, i) => `
                                    <pre style="background:var(--ccs-surface3); border-radius:var(--ccs-radius-sm); padding:6px; font-size:0.78rem; margin-top:4px; white-space:pre-wrap; word-break:break-word;">${this._esc(s.substring(0, 200))}${s.length > 200 ? '…' : ''}</pre>
                                `).join('')}
                            </details>
                        ` : ''}
                    </div>
                ` : ''}

                ${keyDecisions.length ? `
                    <div class="ccs-decisions-section" style="margin-top:16px;">
                        <div class="ccs-decisions-header">Key Decisions</div>
                        <ul class="ccs-decisions-list">
                            ${keyDecisions.slice(-5).map(d => `<li class="ccs-decision-item">${this._esc(d.decision)}</li>`).join('')}
                        </ul>
                    </div>
                ` : ''}

                <div class="ccs-notes-section" style="margin-top:16px;">
                    <div class="ccs-notes-header" style="font-weight:600; color:var(--ccs-accent); margin-bottom:6px; font-size:0.85rem;">📝 Session Notes / Scratchpad</div>
                    <textarea id="ccs-session-notes" placeholder="Jot down ideas, quotes, or snippets here..." style="width:100%; min-height:100px; background:var(--ccs-surface3); border:1px solid var(--ccs-border); color:var(--ccs-text); border-radius:var(--ccs-radius-sm); padding:8px; font-size:0.85rem; resize:vertical;">${this._esc(ideaMemory.notes || '')}</textarea>
                </div>
            </div>
        `;

        const notesArea = this.container.querySelector('#ccs-session-notes');
        if (notesArea) {
            notesArea.addEventListener('input', (e) => {
                ideaMemory.notes = e.target.value;
                memoryManager.save();
            });
        }
    }

    _esc(str) {
        return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    updatePillar(pillars) {
        // Lightweight update: just re-render the pillar list without rebuilding the whole panel
        const list = this.container?.querySelector('.ccs-pillar-list');
        if (!list) return;
        list.innerHTML = pillars.map(p => this._renderPillar(p)).join('');

        const resolved = pillars.filter(p => p.resolved).length;
        const counter = this.container?.querySelector('.ccs-pillar-count');
        if (counter) counter.textContent = `${resolved}/${pillars.length}`;

        const fill = this.container?.querySelector('.ccs-pillar-progress-fill');
        if (fill) fill.style.width = pillars.length ? (resolved / pillars.length * 100) + '%' : '0%';
    }

    _renderRating(rating) {
        const axes = ['Hook Strength','Longevity/Depth','Originality','RP Potential','Platform Appeal'];
        return `
            <div class="ccs-rating-block" style="margin-top:12px;">
                ${axes.map(axis => {
                    const score = rating.scores?.[axis] || 0;
                    return `
                        <div class="ccs-rating-row">
                            <span class="ccs-rating-label">${axis}</span>
                            <span class="ccs-rating-stars">${'★'.repeat(score)}${'☆'.repeat(5 - score)}</span>
                        </div>
                    `;
                }).join('')}
                ${rating.overall ? `<div class="ccs-rating-overall">${this._esc(rating.overall)}</div>` : ''}
            </div>
        `;
    }

    _renderPillar(pillar) {
        return `
            <div class="ccs-pillar-item ${pillar.resolved ? 'ccs-pillar-resolved' : 'ccs-pillar-pending'}" style="position:relative; padding-bottom: ${!pillar.resolved ? '30px' : '0px'}">
                <span class="ccs-pillar-icon">${pillar.resolved ? '✅' : '□'}</span>
                <div class="ccs-pillar-body" style="width: 100%;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
                        <span class="ccs-pillar-name" style="flex: 1;">${this._esc(pillar.name)}</span>
                        ${!pillar.resolved ? `<button class="ccs-btn ccs-btn-sm ccs-btn-ghost ccs-pillar-resolve-btn" data-name="${this._esc(pillar.name)}" style="padding: 2px 8px; font-size: 0.7rem; border: 1px solid var(--ccs-border); flex-shrink: 0;" title="Click to extract answer from last message">✅ Mark</button>` : ''}
                    </div>
                    ${pillar.resolved && pillar.answer ? `<span class="ccs-pillar-answer">${this._esc(pillar.answer)}</span>` : ''}
                </div>
            </div>
        `;
    }
}

export const ideaPanel = new IdeaPanel();

