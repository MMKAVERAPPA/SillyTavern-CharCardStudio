/**
 * CharCardStudio v4.0.0 — ui/personality-radar.js
 * Priority 3.2: Visual Personality Radar Chart
 *
 * Renders an interactive SVG spider/radar chart with 6 axes.
 * The user can drag handles to set values (0–100 per axis).
 * Values are persisted in session.personalityMatrix.
 *
 * Public API:
 *   renderRadarChart(containerEl, matrix, onChange)
 */

// ─── Config ───────────────────────────────────────────────────────────────────

const AXES = [
    { key: 'introvert',   label: 'Introverted',   opposite: 'Extroverted'  },
    { key: 'logical',     label: 'Logical',        opposite: 'Emotional'    },
    { key: 'chaotic',     label: 'Chaotic',        opposite: 'Orderly'      },
    { key: 'aggressive',  label: 'Aggressive',     opposite: 'Gentle'       },
    { key: 'serious',     label: 'Serious',        opposite: 'Playful'      },
    { key: 'secretive',   label: 'Secretive',      opposite: 'Open'         },
];

const CHART_SIZE = 220;       // viewBox dimension (square)
const CENTER = CHART_SIZE / 2;
const MAX_RADIUS = 80;
const LEVELS = 4;             // Number of concentric rings
const HANDLE_RADIUS = 7;
const DRAG_ZONE = HANDLE_RADIUS + 8; // Hit area for dragging

const FILL_COLOR = 'var(--ccs-accent, #7c5cfc)';
const FILL_OPACITY = '0.25';
const STROKE_COLOR = 'var(--ccs-accent, #7c5cfc)';
const GRID_COLOR = 'rgba(255,255,255,0.08)';
const AXIS_COLOR = 'rgba(255,255,255,0.15)';

// ─── Radar Entry Point ────────────────────────────────────────────────────────

/**
 * Module-level AbortController for radar drag listeners.
 * Aborted and replaced on each renderRadarChart call to cleanly remove
 * all previous document-level listeners (Bug 9 fix).
 */
let _radarDragAC = null;

/**
 * Render an interactive personality radar chart.
 *
 * @param {HTMLElement} containerEl  - Where to render the SVG
 * @param {object|null} matrix       - Current values {introvert: 50, logical: 50, ...}
 * @param {(matrix: object) => void} onChange  - Called whenever a handle is dragged
 */
export function renderRadarChart(containerEl, matrix, onChange) {
    // Initialize matrix with defaults if missing
    const values = {};
    for (const axis of AXES) {
        values[axis.key] = (matrix && matrix[axis.key] != null)
            ? Math.max(0, Math.min(100, matrix[axis.key]))
            : 50;
    }

    // Bug 9 fix: Abort any previous drag listeners before re-rendering.
    // Without this, every session-change call to renderRadarChart stacks
    // 4 more persistent document listeners, eventually adding hundreds.
    if (_radarDragAC) _radarDragAC.abort();
    _radarDragAC = new AbortController();
    const abortSignal = _radarDragAC.signal;

    const svg = _createSvg(CHART_SIZE, CHART_SIZE);
    containerEl.innerHTML = '';
    containerEl.appendChild(svg);

    // ── Background levels (concentric polygons) ────────────────────────────
    for (let level = 1; level <= LEVELS; level++) {
        const r = (MAX_RADIUS / LEVELS) * level;
        const pts = _getPolygonPoints(AXES.map(() => r));
        const poly = _svgEl('polygon', {
            points: pts,
            fill: 'none',
            stroke: GRID_COLOR,
            'stroke-width': '1',
        });
        svg.appendChild(poly);
    }

    // ── Axis spokes ─────────────────────────────────────────────────────────
    AXES.forEach((axis, i) => {
        const angle = _axisAngle(i);
        const x2 = CENTER + Math.cos(angle) * (MAX_RADIUS + 16);
        const y2 = CENTER + Math.sin(angle) * (MAX_RADIUS + 16);
        const line = _svgEl('line', {
            x1: CENTER, y1: CENTER,
            x2: x2.toFixed(1), y2: y2.toFixed(1),
            stroke: AXIS_COLOR,
            'stroke-width': '1',
        });
        svg.appendChild(line);

        // Axis label at the tip end
        const lx = CENTER + Math.cos(angle) * (MAX_RADIUS + 26);
        const ly = CENTER + Math.sin(angle) * (MAX_RADIUS + 26);
        const anchor = Math.abs(Math.cos(angle)) < 0.1 ? 'middle'
            : Math.cos(angle) > 0 ? 'start' : 'end';
        const labelEl = _svgEl('text', {
            x: lx.toFixed(1),
            y: ly.toFixed(1),
            class: 'ccs-radar-axis-label',
            'text-anchor': anchor,
            dy: Math.abs(Math.sin(angle)) > 0.5 ? (Math.sin(angle) > 0 ? '1em' : '-0.3em') : '0.35em',
        });
        labelEl.textContent = axis.label;
        svg.appendChild(labelEl);

        // Opposite label at base
        const ox = CENTER + Math.cos(angle + Math.PI) * (MAX_RADIUS + 22);
        const oy = CENTER + Math.sin(angle + Math.PI) * (MAX_RADIUS + 22);
        const oanchor = Math.abs(Math.cos(angle + Math.PI)) < 0.1 ? 'middle'
            : Math.cos(angle + Math.PI) > 0 ? 'start' : 'end';
        const oppEl = _svgEl('text', {
            x: ox.toFixed(1),
            y: oy.toFixed(1),
            class: 'ccs-radar-axis-label ccs-radar-axis-label--opposite',
            'text-anchor': oanchor,
            dy: Math.abs(Math.sin(angle + Math.PI)) > 0.5 ? (Math.sin(angle + Math.PI) > 0 ? '1em' : '-0.3em') : '0.35em',
        });
        oppEl.textContent = axis.opposite;
        svg.appendChild(oppEl);
    });

    // ── Value polygon ────────────────────────────────────────────────────────
    const valuePoly = _svgEl('polygon', {
        class: 'ccs-radar-polygon',
        fill: FILL_COLOR,
        'fill-opacity': FILL_OPACITY,
        stroke: STROKE_COLOR,
        'stroke-width': '2',
        'stroke-linejoin': 'round',
    });
    svg.appendChild(valuePoly);

    // ── Draggable handles ────────────────────────────────────────────────────
    const handles = AXES.map((axis, i) => {
        const handle = _svgEl('circle', {
            r: HANDLE_RADIUS,
            class: 'ccs-radar-handle',
            'data-axis': axis.key,
        });
        svg.appendChild(handle);

        // Tooltip
        const title = _svgEl('title');
        title.textContent = `${axis.label}: ${values[axis.key]}`;
        handle.appendChild(title);

        _makeDraggable(handle, svg, i, values, axis.key, abortSignal, () => {
            // Update polygon and handles after drag
            _updateChart(valuePoly, handles, values);
            // Notify consumer
            if (onChange) onChange({ ...values });
        });

        return handle;
    });

    // Initial render
    _updateChart(valuePoly, handles, values);
}

// ─── Chart Update ─────────────────────────────────────────────────────────────

function _updateChart(valuePoly, handles, values) {
    const radii = AXES.map(a => (values[a.key] / 100) * MAX_RADIUS);
    valuePoly.setAttribute('points', _getPolygonPoints(radii));

    handles.forEach((handle, i) => {
        const axis = AXES[i];
        const r = radii[i];
        const angle = _axisAngle(i);
        const x = CENTER + Math.cos(angle) * r;
        const y = CENTER + Math.sin(angle) * r;
        handle.setAttribute('cx', x.toFixed(2));
        handle.setAttribute('cy', y.toFixed(2));
        // Update tooltip
        const title = handle.querySelector('title');
        if (title) title.textContent = `${axis.label} ↔ ${axis.opposite}: ${values[axis.key]}`;
    });
}

// ─── Drag Logic ───────────────────────────────────────────────────────────────

function _makeDraggable(handle, svg, axisIndex, values, key, abortSignal, onUpdate) {
    let dragging = false;
    const svgPt = svg.createSVGPoint();

    function toSvgCoords(e) {
        const client = e.touches ? e.touches[0] : e;
        svgPt.x = client.clientX;
        svgPt.y = client.clientY;
        return svgPt.matrixTransform(svg.getScreenCTM().inverse());
    }

    function startDrag(e) {
        e.preventDefault();
        dragging = true;
        handle.classList.add('ccs-radar-handle--dragging');
    }

    function drag(e) {
        if (!dragging) return;
        e.preventDefault();

        const p = toSvgCoords(e);
        const dx = p.x - CENTER;
        const dy = p.y - CENTER;

        // Project mouse onto axis direction
        const angle = _axisAngle(axisIndex);
        const axisX = Math.cos(angle);
        const axisY = Math.sin(angle);

        // Dot product: how far along the axis the mouse is
        let projection = dx * axisX + dy * axisY;
        projection = Math.max(0, Math.min(MAX_RADIUS, projection));

        const newValue = Math.round((projection / MAX_RADIUS) * 100);
        values[key] = newValue;
        onUpdate();
    }

    function endDrag() {
        if (!dragging) return;
        dragging = false;
        handle.classList.remove('ccs-radar-handle--dragging');
    }

    handle.addEventListener('mousedown', startDrag);
    handle.addEventListener('touchstart', startDrag, { passive: false });
    document.addEventListener('mousemove', drag, { signal: abortSignal });
    document.addEventListener('touchmove', drag, { passive: false, signal: abortSignal });
    document.addEventListener('mouseup', endDrag, { signal: abortSignal });
    document.addEventListener('touchend', endDrag, { signal: abortSignal });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Generate SVG polygon points string from array of radii (one per axis). */
function _getPolygonPoints(radii) {
    return radii.map((r, i) => {
        const angle = _axisAngle(i);
        const x = CENTER + Math.cos(angle) * r;
        const y = CENTER + Math.sin(angle) * r;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');
}

/** Angle in radians for axis i, starting from top (−π/2), going clockwise. */
function _axisAngle(i) {
    return (2 * Math.PI * i / AXES.length) - Math.PI / 2;
}

function _createSvg(w, h) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('class', 'ccs-radar-svg');
    return svg;
}

function _svgEl(tag, attrs = {}) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) {
        el.setAttribute(k, v);
    }
    return el;
}

/**
 * Build a human-readable description of a personality matrix for AI prompting.
 * @param {object} matrix
 * @returns {string}
 */
export function matrixToPromptString(matrix) {
    if (!matrix) return '';
    return AXES.map(axis => {
        const val = matrix[axis.key] ?? 50;
        const label = val < 25 ? axis.opposite
            : val < 45 ? `slightly ${axis.opposite}`
            : val < 55 ? `balanced ${axis.label}/${axis.opposite}`
            : val < 75 ? `slightly ${axis.label}`
            : axis.label;
        return `${label} (${val}/100)`;
    }).join(', ');
}
