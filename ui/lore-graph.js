/**
 * CharCardStudio v4.0.0 — ui/lore-graph.js
 * Priority 3.1: Visual Lore Graph
 *
 * Lightweight SVG force-directed graph showing lorebook entries as nodes
 * and keyword-overlap connections as edges. No external dependencies (no D3).
 *
 * Physics: simple Verlet integration with spring forces (attraction along edges)
 * and repulsion forces (all node pairs push apart).
 *
 * Public API:
 *   renderLoreGraph(containerEl, entries, onNodeClick)
 *   destroyLoreGraph(containerEl)
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const NODE_RADIUS = 18;
const LINK_STRENGTH = 0.04;
const REPULSION = 2800;
const DAMPING = 0.82;
const SIM_TICKS = 200;          // Max simulation steps before forcing stop
const SIM_STOP_ENERGY = 0.15;   // Stop early if energy drops below this
const MIN_NODE_DIST = NODE_RADIUS * 2.5;

const CATEGORY_COLORS = {
    'Geography':    '#5c8dd6',
    'Factions':     '#e06c75',
    'NPCs':         '#c678dd',
    'Magic System': '#e5c07b',
    'Items':        '#56b6c2',
    'History':      '#d19a66',
    'Culture':      '#98c379',
    'Rules':        '#abb2bf',
    'Constant':     '#61afef',
    'Uncategorized':'#6a7383',
};

// ─── State ────────────────────────────────────────────────────────────────────

/** @type {Map<HTMLElement, { animId: number, sim: SimState }>} */
const _graphInstances = new Map();

// ─── Graph Entry Point ────────────────────────────────────────────────────────

/**
 * Render a force-directed lore graph into `containerEl`.
 * Replaces any existing graph in that container.
 *
 * @param {HTMLElement} containerEl - The element to render into
 * @param {Array<object>} entries - Lorebook entries from getLorebookEntries()
 * @param {(entry: object) => void} [onNodeClick] - Called when user clicks a node
 */
export function renderLoreGraph(containerEl, entries, onNodeClick) {
    // Destroy any running graph in this container first
    destroyLoreGraph(containerEl);

    if (!entries || entries.length === 0) {
        containerEl.innerHTML = `<div class="ccs-graph-empty">No lorebook entries to display.</div>`;
        return;
    }

    const W = containerEl.clientWidth  || 640;
    const H = containerEl.clientHeight || 420;

    // Build nodes
    const nodes = entries.map((entry, i) => ({
        id: i,
        entry,
        name: entry.name || `Entry ${i + 1}`,
        category: _resolveCategory(entry),
        // Random initial position, biased toward center
        x: W / 2 + (Math.random() - 0.5) * W * 0.6,
        y: H / 2 + (Math.random() - 0.5) * H * 0.6,
        vx: 0,
        vy: 0,
    }));

    // Build edges — entry A's CONTENT contains entry B's KEY
    const links = [];
    for (let a = 0; a < nodes.length; a++) {
        for (let b = 0; b < nodes.length; b++) {
            if (a === b) continue;
            const entryA = nodes[a].entry;
            const entryB = nodes[b].entry;
            const keysB = (entryB.keys || []).map(k => k.toLowerCase());
            const contentA = (entryA.content || '').toLowerCase();
            const matched = keysB.some(k => k.length > 2 && contentA.includes(k));
            if (matched) {
                links.push({ source: a, target: b });
            }
        }
    }

    // Create SVG
    const svg = _createSvg(W, H);
    containerEl.innerHTML = '';
    containerEl.appendChild(svg);

    // Draw edges first (under nodes)
    const edgeGroup = _svgEl('g', { class: 'ccs-graph-edges' });
    svg.appendChild(edgeGroup);

    const edgeEls = links.map(link => {
        const line = _svgEl('line', {
            class: 'ccs-graph-edge',
            'marker-end': 'url(#ccs-graph-arrow)',
        });
        edgeGroup.appendChild(line);
        return { el: line, ...link };
    });

    // Draw nodes
    const nodeGroup = _svgEl('g', { class: 'ccs-graph-nodes' });
    svg.appendChild(nodeGroup);

    // Arrow marker def
    const defs = _svgEl('defs');
    const marker = _svgEl('marker', {
        id: 'ccs-graph-arrow',
        markerWidth: '8', markerHeight: '8',
        refX: '6', refY: '3',
        orient: 'auto',
    });
    const markerPath = _svgEl('path', {
        d: 'M0,0 L0,6 L8,3 z',
        class: 'ccs-graph-arrow-path',
    });
    marker.appendChild(markerPath);
    defs.appendChild(marker);
    svg.insertBefore(defs, svg.firstChild);

    // Orphan detection (nodes with no incoming or outgoing edges)
    const connectedNodes = new Set(links.flatMap(l => [l.source, l.target]));

    const nodeEls = nodes.map(node => {
        const g = _svgEl('g', { class: 'ccs-graph-node', 'data-node-id': node.id });

        const color = CATEGORY_COLORS[node.category] || CATEGORY_COLORS['Uncategorized'];
        const isOrphan = !connectedNodes.has(node.id);

        const circle = _svgEl('circle', {
            r: NODE_RADIUS,
            fill: color,
            'fill-opacity': isOrphan ? '0.4' : '0.85',
            stroke: isOrphan ? '#888' : color,
            'stroke-width': isOrphan ? '1' : '2',
            'stroke-dasharray': isOrphan ? '4 2' : 'none',
            class: 'ccs-graph-node-circle',
        });

        // Abbreviated label
        const label = _abbreviate(node.name, 12);
        const text = _svgEl('text', {
            class: 'ccs-graph-node-label',
            dy: NODE_RADIUS + 12,
            'text-anchor': 'middle',
        });
        text.textContent = label;

        // Tooltip title
        const title = _svgEl('title');
        const keyStr = (node.entry.keys || []).join(', ');
        title.textContent = `${node.name}\nCategory: ${node.category}${keyStr ? `\nKeys: ${keyStr}` : ''}${isOrphan ? '\n⚠ Orphaned (no connections)' : ''}`;
        g.appendChild(title);
        g.appendChild(circle);
        g.appendChild(text);

        // Orphan badge
        if (isOrphan) {
            const badge = _svgEl('text', {
                class: 'ccs-graph-orphan-badge',
                dy: -NODE_RADIUS - 4,
                'text-anchor': 'middle',
                'font-size': '10',
            });
            badge.textContent = '⚠';
            g.appendChild(badge);
        }

        // Click handler
        g.addEventListener('click', () => {
            if (onNodeClick) onNodeClick(node.entry);
            // Visual feedback
            svg.querySelectorAll('.ccs-graph-node-circle').forEach(c => c.classList.remove('ccs-graph-node--selected'));
            circle.classList.add('ccs-graph-node--selected');
        });

        // Drag support
        _makeDraggable(g, node, svg);

        nodeGroup.appendChild(g);
        return { el: g, circle, text, node };
    });

    // Run simulation
    const sim = { nodes, links: edgeEls, nodeEls, W, H, running: true, tick: 0 };
    _graphInstances.set(containerEl, { sim });

    const MAX_TICKS_PER_FRAME = 5;

    function step() {
        if (!sim.running) return;

        let totalEnergy = 0;
        for (let t = 0; t < MAX_TICKS_PER_FRAME && sim.tick < SIM_TICKS; t++, sim.tick++) {
            totalEnergy = _simulateTick(sim.nodes, sim.links, sim.W, sim.H);
        }

        // Update DOM positions
        sim.nodeEls.forEach(({ el: g, node }) => {
            g.setAttribute('transform', `translate(${node.x.toFixed(1)},${node.y.toFixed(1)})`);
        });
        sim.links.forEach(({ el: line, source, target }) => {
            const s = sim.nodes[source];
            const t = sim.nodes[target];
            // Offset line ends by node radius so arrows don't overlap circles
            const dx = t.x - s.x;
            const dy = t.y - s.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const ux = dx / dist;
            const uy = dy / dist;
            line.setAttribute('x1', (s.x + ux * NODE_RADIUS).toFixed(1));
            line.setAttribute('y1', (s.y + uy * NODE_RADIUS).toFixed(1));
            line.setAttribute('x2', (t.x - ux * (NODE_RADIUS + 6)).toFixed(1));
            line.setAttribute('y2', (t.y - uy * (NODE_RADIUS + 6)).toFixed(1));
        });

        if (sim.tick >= SIM_TICKS || totalEnergy < SIM_STOP_ENERGY) {
            sim.running = false;
            return;
        }

        const id = requestAnimationFrame(step);
        _graphInstances.set(containerEl, { sim, animId: id });
    }

    const id = requestAnimationFrame(step);
    _graphInstances.set(containerEl, { sim, animId: id });
}

/**
 * Destroy a running graph instance in a container.
 * @param {HTMLElement} containerEl
 */
export function destroyLoreGraph(containerEl) {
    const inst = _graphInstances.get(containerEl);
    if (inst) {
        if (inst.animId) cancelAnimationFrame(inst.animId);
        if (inst.sim) inst.sim.running = false;
        _graphInstances.delete(containerEl);
    }
}

// ─── Physics ─────────────────────────────────────────────────────────────────

function _simulateTick(nodes, links, W, H) {
    const n = nodes.length;
    let totalKE = 0;

    // Repulsion: every pair of nodes pushes apart
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            const a = nodes[i];
            const b = nodes[j];
            let dx = b.x - a.x;
            let dy = b.y - a.y;
            let dist = Math.sqrt(dx * dx + dy * dy) || 1;
            if (dist < MIN_NODE_DIST) dist = MIN_NODE_DIST;
            const force = REPULSION / (dist * dist);
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            a.vx -= fx;
            a.vy -= fy;
            b.vx += fx;
            b.vy += fy;
        }
    }

    // Spring attraction: linked nodes pull toward each other
    const REST_LEN = Math.min(W, H) * 0.25;
    for (const link of links) {
        const s = nodes[link.source];
        const t = nodes[link.target];
        const dx = t.x - s.x;
        const dy = t.y - s.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const delta = dist - REST_LEN;
        const force = delta * LINK_STRENGTH;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        s.vx += fx;
        s.vy += fy;
        t.vx -= fx;
        t.vy -= fy;
    }

    // Gravity: pull toward center so graph doesn't drift away
    const cx = W / 2;
    const cy = H / 2;
    for (const node of nodes) {
        node.vx += (cx - node.x) * 0.004;
        node.vy += (cy - node.y) * 0.004;
    }

    // Integrate, apply damping, boundary clamping
    const PAD = NODE_RADIUS + 4;
    for (const node of nodes) {
        if (node.pinned) continue;
        node.vx *= DAMPING;
        node.vy *= DAMPING;
        node.x += node.vx;
        node.y += node.vy;
        node.x = Math.max(PAD, Math.min(W - PAD, node.x));
        node.y = Math.max(PAD, Math.min(H - PAD, node.y));
        totalKE += node.vx * node.vx + node.vy * node.vy;
    }

    return totalKE;
}

// ─── Drag Support ─────────────────────────────────────────────────────────────

function _makeDraggable(g, node, svg) {
    let dragging = false;
    let startX, startY, nodeStartX, nodeStartY;

    const svgPt = svg.createSVGPoint();

    function toSvgCoords(e) {
        svgPt.x = e.clientX;
        svgPt.y = e.clientY;
        return svgPt.matrixTransform(svg.getScreenCTM().inverse());
    }

    g.addEventListener('mousedown', (e) => {
        e.preventDefault();
        dragging = true;
        node.pinned = true;
        const p = toSvgCoords(e);
        startX = p.x;
        startY = p.y;
        nodeStartX = node.x;
        nodeStartY = node.y;
        g.classList.add('ccs-graph-node--dragging');
    });

    document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const p = toSvgCoords(e);
        node.x = nodeStartX + (p.x - startX);
        node.y = nodeStartY + (p.y - startY);
        node.vx = 0;
        node.vy = 0;
    });

    document.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        node.pinned = false;
        g.classList.remove('ccs-graph-node--dragging');
    });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _createSvg(w, h) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', w);
    svg.setAttribute('height', h);
    svg.setAttribute('class', 'ccs-lore-graph-svg');
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    return svg;
}

function _svgEl(tag, attrs = {}) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) {
        el.setAttribute(k, v);
    }
    return el;
}

function _resolveCategory(entry) {
    const cat = (entry.category || '').trim();
    if (cat) return cat;
    if (entry.constant) return 'Constant';
    return 'Uncategorized';
}

function _abbreviate(str, maxLen) {
    if (!str) return '';
    if (str.length <= maxLen) return str;
    return str.substring(0, maxLen - 1) + '…';
}
