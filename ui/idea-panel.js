// ui/idea-panel.js
// Idea/concept panel: concept rating display, pillar tracker, key decisions

import { memoryManager } from '../core/memory.js';

export class IdeaPanel {
    constructor() {
        this.container = null;
    }

    init(containerId) {
        this.container = document.getElementById(containerId);
    }

    render(ideaMemory) {
        if (!this.container || !ideaMemory) return;

        const { conceptName, conceptRating, pillars = [], keyDecisions = [] } = ideaMemory;
        const resolved = pillars.filter(p => p.resolved);
        const pending = pillars.filter(p => !p.resolved);

        this.container.innerHTML = `
            <div class="ccs-idea-panel">
                ${conceptName ? `<div class="ccs-concept-name">💡 ${conceptName}</div>` : '<div class="ccs-concept-name ccs-muted">No concept yet — pitch an idea!</div>'}

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

                ${keyDecisions.length ? `
                    <div class="ccs-decisions-section">
                        <div class="ccs-decisions-header">Key Decisions</div>
                        <ul class="ccs-decisions-list">
                            ${keyDecisions.slice(-8).map(d => `<li class="ccs-decision-item">${d.decision}</li>`).join('')}
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
            <div class="ccs-rating-block">
                ${axes.map(axis => {
                    const score = rating.scores?.[axis] || 0;
                    return `
                        <div class="ccs-rating-row">
                            <span class="ccs-rating-label">${axis}</span>
                            <span class="ccs-rating-stars">${'★'.repeat(score)}${'☆'.repeat(5 - score)}</span>
                        </div>
                    `;
                }).join('')}
                ${rating.overall ? `<div class="ccs-rating-overall">${rating.overall}</div>` : ''}
            </div>
        `;
    }

    _renderPillar(pillar) {
        return `
            <div class="ccs-pillar-item ${pillar.resolved ? 'ccs-pillar-resolved' : 'ccs-pillar-pending'}">
                <span class="ccs-pillar-icon">${pillar.resolved ? '✅' : '□'}</span>
                <div class="ccs-pillar-body">
                    <span class="ccs-pillar-name">${pillar.name}</span>
                    ${pillar.resolved && pillar.answer ? `<span class="ccs-pillar-answer">${pillar.answer}</span>` : ''}
                </div>
            </div>
        `;
    }
}

export const ideaPanel = new IdeaPanel();
