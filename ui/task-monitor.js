/**
 * CharCardStudio v5.2.2 — ui/task-monitor.js
 *
 * Background Task Monitor: polls active jobs and background checks,
 * updates the #ccs_bg_tasks pill in the topbar, and wires cancel buttons.
 *
 * This is purely a UI layer over existing hooks:
 *   - getActiveJobs() / cancelAllGenerations() from silent-generation.js
 *   - getCheckStatus() / cancelAllChecks() from background.js
 */

import { getActiveJobs, cancelAllGenerations } from '../core/silent-generation.js';
import { getCheckStatus, cancelAllChecks } from '../core/background.js';

// ─── State ───────────────────────────────────────────────────────────────────

let _pollInterval = null;
const POLL_MS = 500;

// ─── DOM Helpers ─────────────────────────────────────────────────────────────

function el(id) {
    return document.getElementById(id);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Initialize the task monitor.
 * Starts a polling interval and wires all button handlers.
 * Call once after UI is mounted.
 */
export function startTaskMonitor() {
    _wireCancelButtons();
    _startPolling();
    console.log('[CCS] Task monitor started.');
}

/**
 * Stop the task monitor (e.g. on extension unload).
 */
export function stopTaskMonitor() {
    if (_pollInterval) {
        clearInterval(_pollInterval);
        _pollInterval = null;
    }
}

// ─── Polling ─────────────────────────────────────────────────────────────────

function _startPolling() {
    if (_pollInterval) return;
    _pollInterval = setInterval(_tick, POLL_MS);
}

function _tick() {
    const jobs = getActiveJobs();           // Main + background registered jobs
    const bgStatus = getCheckStatus();      // Background queue checks

    // Count: main generation jobs (named 'ccs-agent') + background check queue
    const agentJobs = jobs.filter(j => j.name === 'ccs-agent' || j.name === 'agent-response');
    const utilJobs  = jobs.filter(j => j.name !== 'ccs-agent' && j.name !== 'agent-response');
    const bgPending = bgStatus.pending + (bgStatus.processing ? 1 : 0);

    const totalVisible = utilJobs.length + bgPending;

    _updatePill(totalVisible, utilJobs, bgPending);
}

// ─── Pill UI ─────────────────────────────────────────────────────────────────

function _updatePill(count, utilJobs, bgPending) {
    const pill = el('ccs_bg_tasks');
    const countEl = el('ccs_bg_tasks_count');

    if (!pill) return;

    if (count === 0) {
        pill.style.display = 'none';
        return;
    }

    pill.style.display = 'flex';
    if (countEl) countEl.textContent = String(count);

    // Update the task list if the panel is open
    const panel = el('ccs_bg_tasks_panel');
    if (panel && panel.style.display !== 'none') {
        _renderTaskList(utilJobs, bgPending);
    }
}

function _renderTaskList(utilJobs, bgPending) {
    const list = el('ccs_bg_tasks_list');
    if (!list) return;

    const items = [];

    // Utility/named jobs
    for (const job of utilJobs) {
        const elapsed = Math.round(job.elapsed / 1000);
        items.push(`
            <div class="ccs-bg-task-item">
                <i class="fa-solid fa-spinner fa-spin"></i>
                <span class="ccs-bg-task-name">${_prettifyJobName(job.name)}</span>
                <span class="ccs-bg-task-time">${elapsed}s</span>
            </div>
        `);
    }

    // Background check queue
    if (bgPending > 0) {
        items.push(`
            <div class="ccs-bg-task-item">
                <i class="fa-solid fa-spinner fa-spin"></i>
                <span class="ccs-bg-task-name">Field checks (${bgPending} queued)</span>
                <span class="ccs-bg-task-time"></span>
            </div>
        `);
    }

    if (items.length === 0) {
        list.innerHTML = '<div class="ccs-bg-task-empty">No tasks running.</div>';
        return;
    }

    list.innerHTML = items.join('');
}

function _prettifyJobName(name) {
    const map = {
        'ccs-auto-summarize': 'Auto-summarize',
        'ccs-conflict-check': 'Conflict check',
        'ccs-token-check': 'Token check',
        'ccs-background': 'Background task',
    };
    return map[name] || name.replace(/^ccs-/, '').replace(/-/g, ' ');
}

// ─── Button Wiring ────────────────────────────────────────────────────────────

function _wireCancelButtons() {
    // Toggle the dropdown panel on pill button click
    const btn = el('ccs_bg_tasks_btn');
    if (btn) {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const panel = el('ccs_bg_tasks_panel');
            if (!panel) return;
            const isOpen = panel.style.display !== 'none';
            panel.style.display = isOpen ? 'none' : 'block';
            if (!isOpen) {
                const { utilJobs, bgPending } = _getCurrentCounts();
                _renderTaskList(utilJobs, bgPending);
            }
        });
    }

    // Cancel all button
    const cancelAll = el('ccs_bg_cancel_all');
    if (cancelAll) {
        cancelAll.addEventListener('click', () => {
            cancelAllChecks();
            cancelAllGenerations();

            // Close the panel
            const panel = el('ccs_bg_tasks_panel');
            if (panel) panel.style.display = 'none';

            // Hide pill immediately
            const pill = el('ccs_bg_tasks');
            if (pill) pill.style.display = 'none';
        });
    }

    // Close panel on outside click
    document.addEventListener('click', (e) => {
        const pill = el('ccs_bg_tasks');
        if (pill && !pill.contains(e.target)) {
            const panel = el('ccs_bg_tasks_panel');
            if (panel) panel.style.display = 'none';
        }
    });
}

function _getCurrentCounts() {
    const jobs = getActiveJobs();
    const bgStatus = getCheckStatus();
    const utilJobs  = jobs.filter(j => j.name !== 'ccs-agent' && j.name !== 'agent-response');
    const bgPending = bgStatus.pending + (bgStatus.processing ? 1 : 0);
    return { utilJobs, bgPending };
}
