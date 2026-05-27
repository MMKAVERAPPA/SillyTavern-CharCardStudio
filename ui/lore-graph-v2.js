/**
 * CharCardStudio v5.0.0 — ui/lore-graph-v2.js
 * Priority 4.1: Advanced Lore Graph (Canvas-Based)
 *
 * Full rewrite of the SVG graph into a high-performance <canvas> renderer with:
 * - Physics-based force simulation with category clustering
 * - 7 distinct edge types (direct, conditional, constant, prevent-recursion, etc.)
 * - Rich node cards (category color, token count, recursion flags)
 * - Zoom/pan (scroll wheel desktop, pinch mobile)
 * - Node drag (desktop + mobile), grid snap, lasso selection
 * - Minimap, search/filter bar, keyword activation simulator
 * - Inline node editor panel (side panel)
 * - Token size overlay mode, export PNG, stats bar
 * - World Mode dual-lorebook support
 *
 * Public API:
 *   openLoreGraphOverlay(entries, options)   — opens fullscreen graph overlay
 *   closeLoreGraphOverlay()                  — closes overlay
 *   getLoreGraphData(entries)                — returns JSON topology for AI tools
 */

// ─── Constants ───────────────────────────────────────────────────────────────

const NODE_W = 160;        // Base node card width
const NODE_H = 54;         // Base node card height
const NODE_R = 8;          // Corner radius of node cards
const GRID_SIZE = 40;      // Grid snap cell size
const MINIMAP_W = 130;
const MINIMAP_H = 85;
const MINIMAP_PAD = 12;
const PHYSICS_THRESHOLD = 60;   // nodes: switch to static layout above this
const DAMPING = 0.78;
const REPULSION = 18000;
const SPRING_K = 0.04;
const SPRING_REST = 220;
const CENTER_GRAVITY = 0.002;
const CLUSTER_GRAVITY = 0.012;
const LONG_PRESS_MS = 320;

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

// Category cluster anchor positions (expressed as 0-1 normalized fractions)
const CATEGORY_ANCHORS = {
    'Geography':    { nx: 0.25, ny: 0.25 },
    'Factions':     { nx: 0.75, ny: 0.25 },
    'NPCs':         { nx: 0.75, ny: 0.75 },
    'Magic System': { nx: 0.25, ny: 0.75 },
    'Items':        { nx: 0.5,  ny: 0.15 },
    'History':      { nx: 0.15, ny: 0.5  },
    'Culture':      { nx: 0.85, ny: 0.5  },
    'Rules':        { nx: 0.5,  ny: 0.85 },
    'Constant':     { nx: 0.5,  ny: 0.5  },
    'Uncategorized':{ nx: 0.5,  ny: 0.5  },
};

// Edge types — drives color + dash pattern + arrow style
const EDGE_TYPES = {
    DIRECT:      { color: null,       dash: [],       label: 'Activates' },          // category color
    CONDITIONAL: { color: '#888',     dash: [6, 4],   label: 'Conditional' },
    CONSTANT:    { color: '#f97316',  dash: [],       label: 'Always active',  glow: true },
    STOP_RECUR:  { color: '#ef4444',  dash: [],       label: 'Stops recursion', stop: true },
    PROBABILISTIC:{ color: '#eab308', dash: [3,3],   label: 'Probabilistic' },
    INCLUSION:   { color: '#a855f7',  dash: [8,4],   label: 'Inclusion group', bidir: true },
    DELAY_RECUR: { color: '#64748b',  dash: [2,5],   label: 'Delay until recursion' },
};

// ─── Overlay Singleton ───────────────────────────────────────────────────────

let _overlayEl = null;
let _graphV2Instance = null;

/**
 * Open the full-screen lore graph overlay.
 * @param {object[]} entries - from getLorebookEntries()
 * @param {object} [options]
 * @param {object[]} [options.worldEntries] - optional world lorebook entries for dual-book view
 * @param {string}   [options.worldLorebookName]
 * @param {function} [options.onEntryEdit] - called with (uid, changes) when user saves an entry
 * @param {function} [options.onEntryDelete] - called with (uid) when user deletes an entry
 */
export function openLoreGraphOverlay(entries, options = {}) {
    closeLoreGraphOverlay(); // tear down any existing instance

    const container = document.getElementById('ccs_window') || document.body;

    _overlayEl = document.createElement('div');
    _overlayEl.id = 'ccs_graph_overlay';
    _overlayEl.className = 'ccs-graph-overlay';
    _overlayEl.innerHTML = _buildOverlayHTML();
    container.appendChild(_overlayEl);

    // Close on backdrop (not on content clicks)
    _overlayEl.addEventListener('click', (e) => {
        if (e.target === _overlayEl) closeLoreGraphOverlay();
    });

    // Escape key
    const _escHandler = (e) => {
        if (e.key === 'Escape') closeLoreGraphOverlay();
    };
    document.addEventListener('keydown', _escHandler);
    _overlayEl._escHandler = _escHandler;

    // Mount graph instance
    const canvasEl = _overlayEl.querySelector('#ccs_graph_canvas');
    const minimapEl = _overlayEl.querySelector('#ccs_graph_minimap');
    _graphV2Instance = new LoreGraphV2(canvasEl, minimapEl, entries, options, _overlayEl);
    _graphV2Instance.start();

    // Animate in
    requestAnimationFrame(() => _overlayEl.classList.add('ccs-graph-overlay--open'));
}

/** Close and destroy the fullscreen graph overlay. */
export function closeLoreGraphOverlay() {
    if (!_overlayEl) return;
    if (_overlayEl._escHandler) {
        document.removeEventListener('keydown', _overlayEl._escHandler);
    }
    _graphV2Instance?.destroy();
    _graphV2Instance = null;
    _overlayEl.remove();
    _overlayEl = null;
}

/**
 * Get the current lorebook's graph topology as a JSON object for AI tools.
 * Can be called independently (doesn't need the overlay to be open).
 * @param {object[]} entries
 * @returns {object}
 */
export function getLoreGraphData(entries) {
    const nodes = entries.map(e => ({
        uid: e.uid,
        name: e.name,
        category: _resolveCategory(e),
        tokens: e.tokens || 0,
        constant: !!e.constant,
        enabled: e.enabled !== false,
        keys: e.keys || [],
        flags: {
            nonRecursable: !!e.preventRecursion,
            preventFurtherRecursion: !!e.preventRecursion,
            delayUntilRecursion: false,
            probability: e.probability ?? 100,
        },
    }));

    const edges = _buildEdges(entries);
    const orphaned = _findOrphaned(nodes, edges);
    const circularChains = _detectCircularChains(entries, edges);
    const mostConnected = _getMostConnected(nodes, edges);
    const totalTokens = nodes.reduce((s, n) => s + n.tokens, 0);
    const estimatedUsage = entries
        .filter(e => e.constant && e.enabled !== false)
        .reduce((s, e) => s + (e.tokens || 0), 0)
        + Math.round(entries
            .filter(e => !e.constant && e.enabled !== false)
            .reduce((s, e) => s + (e.tokens || 0), 0) * 0.7);

    return {
        entries: nodes,
        edges: edges.map(ed => ({ from: ed.sourceUid, to: ed.targetUid, type: ed.type })),
        orphaned: orphaned.map(n => n.uid),
        circularChains,
        stats: {
            totalEntries: nodes.length,
            totalTokens,
            estimatedUsage,
            orphanedCount: orphaned.length,
            circularChainCount: circularChains.length,
            mostConnected: mostConnected ? { uid: mostConnected.uid, name: mostConnected.name, edgeCount: mostConnected.count } : null,
        },
    };
}

// ─── HTML Template ───────────────────────────────────────────────────────────

function _buildOverlayHTML() {
    return `
<div class="ccs-graph-inner" id="ccs_graph_inner">
    <!-- Toolbar -->
    <div class="ccs-graph-toolbar" id="ccs_graph_toolbar">
        <button class="ccs-graph-back-btn" id="ccs_graph_back_btn" title="Close graph (Esc)">
            <i class="fa-solid fa-arrow-left"></i> <span class="ccs-graph-back-label">Lore</span>
        </button>
        <div class="ccs-graph-toolbar-sep"></div>
        <button class="ccs-graph-tool-btn" id="ccs_graph_fit_btn" title="Fit all nodes to screen">
            <i class="fa-solid fa-expand"></i>
        </button>
        <button class="ccs-graph-tool-btn" id="ccs_graph_grid_btn" title="Toggle grid snap">
            <i class="fa-solid fa-border-all"></i>
        </button>
        <button class="ccs-graph-tool-btn" id="ccs_graph_token_btn" title="Toggle token size mode">
            <i class="fa-solid fa-weight-scale"></i>
        </button>
        <button class="ccs-graph-tool-btn" id="ccs_graph_physics_btn" title="Toggle physics simulation">
            <i class="fa-solid fa-atom"></i>
        </button>
        <div class="ccs-graph-toolbar-sep"></div>
        <button class="ccs-graph-tool-btn" id="ccs_graph_search_btn" title="Search entries">
            <i class="fa-solid fa-magnifying-glass"></i>
        </button>
        <button class="ccs-graph-tool-btn" id="ccs_graph_sim_btn" title="Keyword activation simulator">
            <i class="fa-solid fa-bolt"></i>
        </button>
        <div class="ccs-graph-toolbar-sep"></div>
        <button class="ccs-graph-tool-btn" id="ccs_graph_export_btn" title="Export as PNG">
            <i class="fa-solid fa-image"></i>
        </button>
        <div class="ccs-graph-toolbar-spacer"></div>
        <!-- Zoom controls -->
        <button class="ccs-graph-tool-btn" id="ccs_graph_zoom_out" title="Zoom out">
            <i class="fa-solid fa-minus"></i>
        </button>
        <span class="ccs-graph-zoom-label" id="ccs_graph_zoom_label">100%</span>
        <button class="ccs-graph-tool-btn" id="ccs_graph_zoom_in" title="Zoom in">
            <i class="fa-solid fa-plus"></i>
        </button>
    </div>

    <!-- Stats bar -->
    <div class="ccs-graph-stats" id="ccs_graph_stats">
        <span id="ccs_graph_stat_entries">…</span>
        <span class="ccs-graph-stats-sep">|</span>
        <span id="ccs_graph_stat_edges">…</span>
        <span class="ccs-graph-stats-sep">|</span>
        <span id="ccs_graph_stat_orphaned">…</span>
        <span class="ccs-graph-stats-sep">|</span>
        <span id="ccs_graph_stat_tokens">…</span>
    </div>

    <!-- Search panel (hidden by default) -->
    <div class="ccs-graph-panel ccs-graph-search-panel ccs-hidden" id="ccs_graph_search_panel">
        <div class="ccs-graph-panel-header">
            <i class="fa-solid fa-magnifying-glass"></i> Search & Filter
            <button class="ccs-graph-panel-close" id="ccs_graph_search_close"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <input type="text" class="ccs-graph-search-input" id="ccs_graph_search_input"
               placeholder="Entry name, key, or content…" autocomplete="off" />
        <div class="ccs-graph-filter-chips" id="ccs_graph_filter_chips">
            <button class="ccs-graph-filter-chip" data-filter="constant">🔵 Constant only</button>
            <button class="ccs-graph-filter-chip" data-filter="orphaned">⚠️ Orphaned</button>
            <button class="ccs-graph-filter-chip" data-filter="circular">🔄 Circular loops</button>
            <button class="ccs-graph-filter-chip" data-filter="heavy">🏋️ Heavy (&gt;300t)</button>
            <button class="ccs-graph-filter-chip" data-filter="disabled">🚫 Disabled</button>
            <button class="ccs-graph-filter-chip" data-filter="probabilistic">🎲 Probabilistic</button>
        </div>
        <div class="ccs-graph-search-result" id="ccs_graph_search_result"></div>
    </div>

    <!-- Simulator panel (hidden by default) -->
    <div class="ccs-graph-panel ccs-graph-sim-panel ccs-hidden" id="ccs_graph_sim_panel">
        <div class="ccs-graph-panel-header">
            <i class="fa-solid fa-bolt"></i> Activation Simulator
            <button class="ccs-graph-panel-close" id="ccs_graph_sim_close"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <textarea class="ccs-graph-sim-input" id="ccs_graph_sim_input"
                  placeholder="Type a test message to simulate keyword activation…" rows="3"></textarea>
        <div class="ccs-graph-sim-options">
            <label class="ccs-graph-sim-label">
                Scan depth:
                <select class="ccs-graph-sim-select" id="ccs_graph_sim_depth">
                    <option value="1">1 msg</option>
                    <option value="2">2 msgs</option>
                    <option value="3" selected>3 msgs</option>
                    <option value="5">5 msgs</option>
                    <option value="10">10 msgs</option>
                </select>
            </label>
            <label class="ccs-graph-sim-label">
                Recursion:
                <select class="ccs-graph-sim-select" id="ccs_graph_sim_recursion">
                    <option value="on" selected>ON</option>
                    <option value="off">OFF</option>
                </select>
            </label>
            <label class="ccs-graph-sim-label">
                Budget:
                <select class="ccs-graph-sim-select" id="ccs_graph_sim_budget">
                    <option value="1000">1000t</option>
                    <option value="2000" selected>2000t</option>
                    <option value="4000">4000t</option>
                    <option value="999999">Unlimited</option>
                </select>
            </label>
        </div>
        <button class="ccs-btn ccs-btn--accent" id="ccs_graph_sim_run" style="width:100%;margin-top:6px;">
            <i class="fa-solid fa-play"></i> Simulate
        </button>
        <div class="ccs-graph-sim-result" id="ccs_graph_sim_result"></div>
    </div>

    <!-- Node editor panel (hidden by default) -->
    <div class="ccs-graph-editor-panel ccs-hidden" id="ccs_graph_editor_panel">
        <div class="ccs-graph-panel-header">
            <i class="fa-solid fa-pen"></i> <span id="ccs_graph_editor_title">Edit Entry</span>
            <button class="ccs-graph-panel-close" id="ccs_graph_editor_close"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="ccs-graph-editor-body" id="ccs_graph_editor_body">
            <!-- Populated dynamically when a node is double-clicked -->
        </div>
    </div>

    <!-- Context menu -->
    <div class="ccs-graph-ctx-menu ccs-hidden" id="ccs_graph_ctx_menu">
        <button class="ccs-graph-ctx-item" data-action="view"><i class="fa-solid fa-eye"></i> View Entry</button>
        <button class="ccs-graph-ctx-item" data-action="edit"><i class="fa-solid fa-pen"></i> Edit Entry</button>
        <div class="ccs-graph-ctx-sep"></div>
        <button class="ccs-graph-ctx-item" data-action="focus"><i class="fa-solid fa-crosshairs"></i> Focus Connections</button>
        <button class="ccs-graph-ctx-item" data-action="pin"><i class="fa-solid fa-thumbtack"></i> Pin / Unpin</button>
        <div class="ccs-graph-ctx-sep"></div>
        <button class="ccs-graph-ctx-item" data-action="toggle"><i class="fa-solid fa-toggle-on"></i> Enable / Disable</button>
        <button class="ccs-graph-ctx-item ccs-graph-ctx-item--danger" data-action="delete">
            <i class="fa-solid fa-trash"></i> Delete Entry
        </button>
    </div>

    <!-- Main canvas -->
    <canvas id="ccs_graph_canvas" class="ccs-graph-canvas"></canvas>

    <!-- Minimap -->
    <canvas id="ccs_graph_minimap" class="ccs-graph-minimap"></canvas>

    <!-- Legend -->
    <div class="ccs-graph-legend" id="ccs_graph_legend">
        <div class="ccs-graph-legend-item"><span class="ccs-graph-legend-edge ccs-graph-legend-solid" style="background:#aaa"></span> Direct</div>
        <div class="ccs-graph-legend-item"><span class="ccs-graph-legend-edge ccs-graph-legend-dashed" style="background:#888"></span> Conditional</div>
        <div class="ccs-graph-legend-item"><span class="ccs-graph-legend-edge ccs-graph-legend-solid" style="background:#f97316"></span> Constant</div>
        <div class="ccs-graph-legend-item"><span class="ccs-graph-legend-edge ccs-graph-legend-solid" style="background:#ef4444"></span> Stops recursion</div>
        <div class="ccs-graph-legend-item"><span class="ccs-graph-legend-edge ccs-graph-legend-dashed" style="background:#eab308"></span> Probabilistic</div>
        <div class="ccs-graph-legend-item"><span class="ccs-graph-legend-edge ccs-graph-legend-dashed" style="background:#a855f7"></span> Inclusion group</div>
    </div>
</div>
`;
}

// ─── LoreGraphV2 Class ───────────────────────────────────────────────────────

class LoreGraphV2 {
    constructor(canvas, minimapCanvas, entries, options, overlayEl) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.minimapCanvas = minimapCanvas;
        this.minimapCtx = minimapCanvas.getContext('2d');
        this.entries = entries;
        this.worldEntries = options.worldEntries || null;
        this.worldLorebookName = options.worldLorebookName || null;
        this.onEntryEdit = options.onEntryEdit || null;
        this.onEntryDelete = options.onEntryDelete || null;
        this.overlayEl = overlayEl;

        // Viewport state
        this.vpX = 0;  // viewport offset X (pan)
        this.vpY = 0;
        this.scale = 1.0;
        this.dpr = window.devicePixelRatio || 1;

        // Feature toggles
        this.gridSnap = false;
        this.tokenSizeMode = false;
        this.physicsEnabled = true;
        this.simRunning = true;

        // Nodes, edges, selection
        this.nodes = [];
        this.edges = [];
        this.selectedUids = new Set();
        this.focusedUid = null;  // single node focus mode

        // Drag state
        this.dragNode = null;
        this.dragOffX = 0;
        this.dragOffY = 0;
        this.isDragging = false;

        // Pan state
        this.isPanning = false;
        this.panStartX = 0;
        this.panStartY = 0;

        // Lasso
        this.isLassoing = false;
        this.lassoX1 = 0;
        this.lassoY1 = 0;
        this.lassoX2 = 0;
        this.lassoY2 = 0;

        // Touch
        this.touchStartDist = null;
        this.touchStartScale = 1;
        this.touchMidX = 0;
        this.touchMidY = 0;
        this.longPressTimer = null;
        this.longPressNode = null;

        // Search/filter state
        this.searchQuery = '';
        this.activeFilters = new Set();
        this.matchedUids = null;  // null = no filter active

        // Simulation result (for highlighting)
        this.simActivated = null;  // { pass1: Set<uid>, pass2: Set<uid>, pass3: Set<uid>, ... }

        // Animation
        this.animId = null;

        // Context menu active node
        this.ctxNode = null;

        this._isMobile = window.innerWidth < 768;

        this._initNodes();
        this._initEdges();
        this._resize();
        this._wireToolbar();
        this._wireSearch();
        this._wireSimulator();
        this._wireEditor();
        this._wireCanvasEvents();
        this._wireContextMenu();
        this._updateStats();

        // ResizeObserver
        this._resizeObs = new ResizeObserver(() => this._resize());
        this._resizeObs.observe(this.canvas.parentElement);
    }

    // ─── Initialization ───────────────────────────────────────────────────────

    _initNodes() {
        const W = this.canvas.parentElement.clientWidth || 800;
        const H = this.canvas.parentElement.clientHeight || 600;

        this.nodes = this.entries.map((entry) => {
            const cat = _resolveCategory(entry);
            const anchor = CATEGORY_ANCHORS[cat] || CATEGORY_ANCHORS['Uncategorized'];
            return {
                uid: entry.uid,
                entry: entry,
                name: entry.name || `uid:${entry.uid}`,
                category: cat,
                tokens: entry.tokens || 0,
                // Initial position near category anchor with jitter
                x: W * anchor.nx + (Math.random() - 0.5) * 180,
                y: H * anchor.ny + (Math.random() - 0.5) * 180,
                vx: 0,
                vy: 0,
                pinned: false,
                worldNode: false,
            };
        });

        // If we have world entries, add them with a 'worldNode' flag
        if (this.worldEntries) {
            const worldNodes = this.worldEntries.map((entry) => {
                const cat = _resolveCategory(entry);
                const anchor = CATEGORY_ANCHORS[cat] || CATEGORY_ANCHORS['Uncategorized'];
                return {
                    uid: `world_${entry.uid}`,
                    entry: entry,
                    name: entry.name || `uid:${entry.uid}`,
                    category: cat,
                    tokens: entry.tokens || 0,
                    // World entries in top half
                    x: W * 0.5 + (anchor.nx - 0.5) * W * 0.8,
                    y: H * 0.25 + (anchor.ny - 0.5) * H * 0.35,
                    vx: 0,
                    vy: 0,
                    pinned: false,
                    worldNode: true,
                };
            });
            this.nodes = [...worldNodes, ...this.nodes];
        }

        // If too many nodes, disable physics by default
        if (this.nodes.length > PHYSICS_THRESHOLD) {
            this.physicsEnabled = false;
            this._applyStaticCategoryLayout();
        }
    }

    _initEdges() {
        const allEntries = this.worldEntries
            ? [...this.worldEntries.map(e => ({ ...e, _world: true })), ...this.entries]
            : this.entries;

        this.edges = _buildEdgesFromEntries(allEntries, this.nodes, this.worldEntries ? true : false);
    }

    _applyStaticCategoryLayout() {
        const W = this.canvas.parentElement.clientWidth || 800;
        const H = this.canvas.parentElement.clientHeight || 600;
        const groups = {};
        for (const node of this.nodes) {
            if (!groups[node.category]) groups[node.category] = [];
            groups[node.category].push(node);
        }
        for (const [cat, catNodes] of Object.entries(groups)) {
            const anchor = CATEGORY_ANCHORS[cat] || CATEGORY_ANCHORS['Uncategorized'];
            const cx = W * anchor.nx;
            const cy = H * anchor.ny;
            const cols = Math.ceil(Math.sqrt(catNodes.length));
            catNodes.forEach((node, i) => {
                const col = i % cols;
                const row = Math.floor(i / cols);
                node.x = cx + (col - cols / 2) * (NODE_W + 20);
                node.y = cy + (row - Math.floor(catNodes.length / cols) / 2) * (NODE_H + 16);
                node.vx = 0;
                node.vy = 0;
            });
        }
    }

    // ─── Resize ───────────────────────────────────────────────────────────────

    _resize() {
        const parent = this.canvas.parentElement;
        const W = parent.clientWidth;
        const H = parent.clientHeight;
        this.dpr = window.devicePixelRatio || 1;

        this.canvas.style.width = W + 'px';
        this.canvas.style.height = H + 'px';
        this.canvas.width = Math.round(W * this.dpr);
        this.canvas.height = Math.round(H * this.dpr);

        this.W = W;
        this.H = H;
    }

    // ─── Animation Loop ───────────────────────────────────────────────────────

    start() {
        this.simRunning = true;
        const loop = () => {
            if (!this.simRunning) return;
            if (this.physicsEnabled) this._physicsTick();
            this._render();
            this._renderMinimap();
            this.animId = requestAnimationFrame(loop);
        };
        this.animId = requestAnimationFrame(loop);
    }

    destroy() {
        this.simRunning = false;
        if (this.animId) cancelAnimationFrame(this.animId);
        if (this._resizeObs) this._resizeObs.disconnect();
        this._unbindCanvasEvents();
    }

    // ─── Physics ─────────────────────────────────────────────────────────────

    _physicsTick() {
        const nodes = this.nodes;
        const n = nodes.length;
        const W = this.W;
        const H = this.H;

        // Repulsion (all pairs)
        for (let i = 0; i < n; i++) {
            const a = nodes[i];
            for (let j = i + 1; j < n; j++) {
                const b = nodes[j];
                let dx = b.x - a.x;
                let dy = b.y - a.y;
                let dist = Math.sqrt(dx * dx + dy * dy) || 1;
                const minDist = (NODE_W + NODE_H) * 0.7;
                if (dist < minDist) dist = minDist;
                const force = REPULSION / (dist * dist);
                const fx = (dx / dist) * force;
                const fy = (dy / dist) * force;
                a.vx -= fx;
                a.vy -= fy;
                b.vx += fx;
                b.vy += fy;
            }
        }

        // Spring attraction along edges
        for (const edge of this.edges) {
            const s = this._nodeByUid(edge.sourceUid);
            const t = this._nodeByUid(edge.targetUid);
            if (!s || !t) continue;
            const dx = t.x - s.x;
            const dy = t.y - s.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const delta = dist - SPRING_REST;
            const force = delta * SPRING_K;
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            s.vx += fx;
            s.vy += fy;
            t.vx -= fx;
            t.vy -= fy;
        }

        // Category cluster gravity
        for (const node of nodes) {
            const anchor = CATEGORY_ANCHORS[node.category] || CATEGORY_ANCHORS['Uncategorized'];
            const tx = W * (node.worldNode ? anchor.nx * 0.5 + 0.25 : anchor.nx);
            const ty = H * (node.worldNode ? anchor.ny * 0.35 + 0.05 : anchor.ny * 0.5 + 0.45);
            node.vx += (tx - node.x) * CLUSTER_GRAVITY;
            node.vy += (ty - node.y) * CLUSTER_GRAVITY;

            // General center gravity
            node.vx += (W / 2 - node.x) * CENTER_GRAVITY;
            node.vy += (H / 2 - node.y) * CENTER_GRAVITY;
        }

        // Integrate + damp + clamp
        const PAD = 20;
        for (const node of nodes) {
            if (node.pinned || (this.dragNode && this.dragNode.uid === node.uid)) continue;
            node.vx *= DAMPING;
            node.vy *= DAMPING;
            node.x += node.vx;
            node.y += node.vy;
            node.x = Math.max(PAD + NODE_W / 2, Math.min(W - PAD - NODE_W / 2, node.x));
            node.y = Math.max(PAD + NODE_H / 2, Math.min(H - PAD - NODE_H / 2, node.y));
        }
    }

    // ─── Rendering ────────────────────────────────────────────────────────────

    _render() {
        const ctx = this.ctx;
        const dpr = this.dpr;
        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, this.W, this.H);

        // Apply viewport transform (pan + zoom)
        ctx.translate(this.vpX, this.vpY);
        ctx.scale(this.scale, this.scale);

        // Grid (if snap mode)
        if (this.gridSnap) this._drawGrid(ctx);

        // Edges
        for (const edge of this.edges) {
            this._drawEdge(ctx, edge);
        }

        // Lasso selection rect
        if (this.isLassoing) {
            ctx.strokeStyle = 'rgba(124,92,191,0.8)';
            ctx.fillStyle = 'rgba(124,92,191,0.12)';
            ctx.lineWidth = 1.5 / this.scale;
            ctx.setLineDash([4, 3]);
            const rx = Math.min(this.lassoX1, this.lassoX2) - this.vpX / this.scale;
            const ry = Math.min(this.lassoY1, this.lassoY2) - this.vpY / this.scale;
            const rw = Math.abs(this.lassoX2 - this.lassoX1);
            const rh = Math.abs(this.lassoY2 - this.lassoY1);
            ctx.beginPath();
            ctx.rect(rx, ry, rw, rh);
            ctx.fill();
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // Nodes
        for (const node of this.nodes) {
            this._drawNode(ctx, node);
        }

        ctx.restore();
    }

    _drawGrid(ctx) {
        const gs = GRID_SIZE;
        const startX = ((-this.vpX / this.scale) % gs + gs) % gs;
        const startY = ((-this.vpY / this.scale) % gs + gs) % gs;
        ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        ctx.lineWidth = 0.5 / this.scale;
        ctx.beginPath();
        for (let x = startX - gs; x < this.W / this.scale + gs; x += gs) {
            ctx.moveTo(x, -this.vpY / this.scale);
            ctx.lineTo(x, -this.vpY / this.scale + this.H / this.scale);
        }
        for (let y = startY - gs; y < this.H / this.scale + gs; y += gs) {
            ctx.moveTo(-this.vpX / this.scale, y);
            ctx.lineTo(-this.vpX / this.scale + this.W / this.scale, y);
        }
        ctx.stroke();
    }

    _drawEdge(ctx, edge) {
        const s = this._nodeByUid(edge.sourceUid);
        const t = this._nodeByUid(edge.targetUid);
        if (!s || !t) return;

        // Dimming in search/filter mode
        if (this.matchedUids && !this.matchedUids.has(s.uid) && !this.matchedUids.has(t.uid)) {
            return; // skip entirely dimmed edges
        }

        const type = EDGE_TYPES[edge.type] || EDGE_TYPES.DIRECT;
        const baseColor = type.color || CATEGORY_COLORS[s.category] || '#888';
        const alpha = this._getEdgeAlpha(s, t);

        ctx.save();
        ctx.globalAlpha = alpha;

        if (type.glow) {
            ctx.shadowColor = baseColor;
            ctx.shadowBlur = 8 / this.scale;
        }

        ctx.strokeStyle = baseColor;
        ctx.lineWidth = (edge.type === 'CONSTANT' ? 2.5 : 1.5) / this.scale;
        ctx.setLineDash(type.dash.map(d => d / this.scale));

        // Midpoint of each node
        const x1 = s.x;
        const y1 = s.y;
        const x2 = t.x;
        const y2 = t.y;

        const dx = x2 - x1;
        const dy = y2 - y1;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const ux = dx / dist;
        const uy = dy / dist;

        // Edge starts/ends at node boundaries
        const hw = this._nodeWidth(s) / 2;
        const hh = NODE_H / 2;
        const sx = x1 + ux * hw;
        const sy = y1 + uy * hh;
        const ex = x2 - ux * (this._nodeWidth(t) / 2 + 8 / this.scale);
        const ey = y2 - uy * (hh + 8 / this.scale);

        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.stroke();

        // Arrowhead
        const arrowLen = 10 / this.scale;
        const angle = Math.atan2(ey - sy, ex - sx);
        ctx.setLineDash([]);
        ctx.fillStyle = baseColor;
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - arrowLen * Math.cos(angle - 0.4), ey - arrowLen * Math.sin(angle - 0.4));
        ctx.lineTo(ex - arrowLen * Math.cos(angle + 0.4), ey - arrowLen * Math.sin(angle + 0.4));
        ctx.closePath();
        ctx.fill();

        // Stop marker for STOP_RECUR edges
        if (edge.type === 'STOP_RECUR') {
            const mx = ex - ux * 8 / this.scale;
            const my = ey - uy * 8 / this.scale;
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 2.5 / this.scale;
            ctx.setLineDash([]);
            const perpLen = 6 / this.scale;
            ctx.beginPath();
            ctx.moveTo(mx - uy * perpLen, my + ux * perpLen);
            ctx.lineTo(mx + uy * perpLen, my - ux * perpLen);
            ctx.stroke();
        }

        // Bidirectional indicator for INCLUSION
        if (edge.type === 'INCLUSION') {
            const bx = sx + ux * 12 / this.scale;
            const by = sy + uy * 12 / this.scale;
            const bAngle = Math.atan2(sy - ey, sx - ex);
            ctx.fillStyle = baseColor;
            ctx.beginPath();
            ctx.moveTo(bx, by);
            ctx.lineTo(bx - arrowLen * Math.cos(bAngle - 0.4), by - arrowLen * Math.sin(bAngle - 0.4));
            ctx.lineTo(bx - arrowLen * Math.cos(bAngle + 0.4), by - arrowLen * Math.sin(bAngle + 0.4));
            ctx.closePath();
            ctx.fill();
        }

        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
        ctx.restore();
    }

    _drawNode(ctx, node) {
        const nw = this._nodeWidth(node);
        const nh = NODE_H;
        const x = node.x - nw / 2;
        const y = node.y - nh / 2;

        const baseColor = CATEGORY_COLORS[node.category] || CATEGORY_COLORS['Uncategorized'];
        const isSelected = this.selectedUids.has(node.uid);
        const isFiltered = this.matchedUids !== null && !this.matchedUids.has(node.uid);
        const isSimActive = this._getSimPassForUid(node.uid);
        const isDisabled = node.entry.enabled === false;
        const alpha = isFiltered ? 0.15 : (isDisabled ? 0.35 : 1);

        ctx.save();
        ctx.globalAlpha = alpha;

        // Drop shadow
        if (!isFiltered) {
            ctx.shadowColor = isSelected ? '#7c5cbf' : 'rgba(0,0,0,0.5)';
            ctx.shadowBlur = isSelected ? 18 / this.scale : 6 / this.scale;
            ctx.shadowOffsetY = 2 / this.scale;
        }

        // Node background
        ctx.fillStyle = isSimActive ? _simPassColor(isSimActive) : _hexWithAlpha(baseColor, 0.18);
        _roundRect(ctx, x, y, nw, nh, NODE_R / this.scale);
        ctx.fill();

        // Border
        ctx.shadowBlur = 0;
        ctx.strokeStyle = isSelected ? '#7c5cbf' : baseColor;
        ctx.lineWidth = (isSelected ? 2.5 : 1.5) / this.scale;

        // Constant: pulsing glow ring
        if (node.entry.constant) {
            ctx.shadowColor = baseColor;
            ctx.shadowBlur = (8 + 4 * Math.sin(Date.now() * 0.004)) / this.scale;
        }

        _roundRect(ctx, x, y, nw, nh, NODE_R / this.scale);
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Category bar on left edge
        ctx.fillStyle = baseColor;
        _roundRect(ctx, x, y + 2 / this.scale, 4 / this.scale, nh - 4 / this.scale, 2 / this.scale);
        ctx.fill();

        // World node badge (left of name)
        const startX = x + 10 / this.scale;
        let textX = startX;
        const textY = y + nh / 2;

        if (node.worldNode) {
            ctx.font = `${11 / this.scale}px sans-serif`;
            ctx.fillText('🌍', textX, textY + 4 / this.scale);
            textX += 16 / this.scale;
        }

        // Entry name
        const nameFS = Math.max(9, 11 / this.scale);
        ctx.font = `600 ${nameFS}px 'Inter', sans-serif`;
        ctx.fillStyle = isDisabled ? '#666' : '#e8e8e8';
        ctx.textBaseline = 'middle';
        const maxNameW = nw - 30 / this.scale - (textX - startX);
        const nameTxt = _abbreviateCanvas(ctx, node.name, maxNameW);
        ctx.fillText(nameTxt, textX, textY - 7 / this.scale);

        // Token count + category badge
        const tokenFS = Math.max(7.5, 9 / this.scale);
        ctx.font = `${tokenFS}px 'Inter', sans-serif`;
        ctx.fillStyle = '#999';
        ctx.fillText(`~${node.tokens}t`, textX, textY + 7 / this.scale);

        // Category badge (right side)
        const catLabel = node.category.length > 8 ? node.category.substring(0, 7) + '…' : node.category;
        const badgeFS = Math.max(7, 8.5 / this.scale);
        ctx.font = `${badgeFS}px 'Inter', sans-serif`;
        const badgeW = ctx.measureText(catLabel).width + 6 / this.scale;
        const badgeX = x + nw - badgeW - 4 / this.scale;
        const badgeY = y + 4 / this.scale;
        ctx.fillStyle = _hexWithAlpha(baseColor, 0.3);
        _roundRect(ctx, badgeX, badgeY, badgeW, 12 / this.scale, 2 / this.scale);
        ctx.fill();
        ctx.fillStyle = baseColor;
        ctx.textBaseline = 'top';
        ctx.fillText(catLabel, badgeX + 3 / this.scale, badgeY + 1.5 / this.scale);

        // Flag icons (top-right area)
        let flagX = x + nw - 6 / this.scale;
        const flagY = y + nh - 13 / this.scale;
        ctx.font = `${10 / this.scale}px sans-serif`;
        ctx.textBaseline = 'alphabetic';

        if (node.entry.preventRecursion) {
            ctx.fillText('🛑', flagX - 12 / this.scale, flagY);
            flagX -= 14 / this.scale;
        }
        if ((node.entry.probability ?? 100) < 100) {
            ctx.fillText('🎲', flagX - 12 / this.scale, flagY);
            flagX -= 14 / this.scale;
        }
        if (node.pinned) {
            ctx.fillText('📌', x + 2 / this.scale, flagY);
        }
        if (isDisabled) {
            // Strikethrough overlay
            ctx.strokeStyle = 'rgba(255,80,80,0.5)';
            ctx.lineWidth = 1 / this.scale;
            ctx.beginPath();
            ctx.moveTo(x + 4 / this.scale, y + nh / 2);
            ctx.lineTo(x + nw - 4 / this.scale, y + nh / 2);
            ctx.stroke();
        }

        ctx.globalAlpha = 1;
        ctx.restore();
    }

    _renderMinimap() {
        const mc = this.minimapCtx;
        const mw = MINIMAP_W;
        const mh = MINIMAP_H;
        mc.clearRect(0, 0, mw, mh);

        // Background
        mc.fillStyle = 'rgba(10,10,18,0.85)';
        mc.fillRect(0, 0, mw, mh);
        mc.strokeStyle = 'rgba(255,255,255,0.1)';
        mc.lineWidth = 1;
        mc.strokeRect(0, 0, mw, mh);

        if (!this.nodes.length) return;

        // World bounds
        const xs = this.nodes.map(n => n.x);
        const ys = this.nodes.map(n => n.y);
        const minX = Math.min(...xs) - NODE_W;
        const maxX = Math.max(...xs) + NODE_W;
        const minY = Math.min(...ys) - NODE_H;
        const maxY = Math.max(...ys) + NODE_H;
        const worldW = maxX - minX || 1;
        const worldH = maxY - minY || 1;

        const scaleX = mw / worldW;
        const scaleY = mh / worldH;
        const ms = Math.min(scaleX, scaleY) * 0.9;

        const toMx = (wx) => (wx - minX) * ms + (mw - worldW * ms) / 2;
        const toMy = (wy) => (wy - minY) * ms + (mh - worldH * ms) / 2;

        // Draw nodes as small dots
        for (const node of this.nodes) {
            const color = CATEGORY_COLORS[node.category] || '#666';
            mc.fillStyle = color;
            mc.fillRect(toMx(node.x) - 2, toMy(node.y) - 1.5, 4, 3);
        }

        // Viewport rect
        const vpLeft = -this.vpX / this.scale;
        const vpTop = -this.vpY / this.scale;
        const vpRight = vpLeft + this.W / this.scale;
        const vpBottom = vpTop + this.H / this.scale;

        mc.strokeStyle = 'rgba(124,92,191,0.7)';
        mc.lineWidth = 1;
        mc.strokeRect(toMx(vpLeft), toMy(vpTop), (vpRight - vpLeft) * ms, (vpBottom - vpTop) * ms);
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    _nodeByUid(uid) {
        return this.nodes.find(n => n.uid === uid) || null;
    }

    _nodeWidth(node) {
        if (!this.tokenSizeMode) return NODE_W;
        const maxTokens = Math.max(...this.nodes.map(n => n.tokens), 1);
        const ratio = node.tokens / maxTokens;
        return NODE_W * (0.6 + ratio * 0.8);
    }

    _getEdgeAlpha(s, t) {
        if (this.matchedUids && (this.matchedUids.has(s.uid) || this.matchedUids.has(t.uid))) return 0.9;
        if (this.matchedUids) return 0.07;
        return 0.7;
    }

    _getSimPassForUid(uid) {
        if (!this.simActivated) return null;
        for (const [pass, uidSet] of Object.entries(this.simActivated)) {
            if (uidSet.has(uid)) return parseInt(pass.replace('pass', ''), 10);
        }
        return null;
    }

    _hitTest(worldX, worldY) {
        // Reverse order: topmost drawn node first
        for (let i = this.nodes.length - 1; i >= 0; i--) {
            const node = this.nodes[i];
            const nw = this._nodeWidth(node);
            const nh = NODE_H;
            if (
                worldX >= node.x - nw / 2 &&
                worldX <= node.x + nw / 2 &&
                worldY >= node.y - nh / 2 &&
                worldY <= node.y + nh / 2
            ) {
                return node;
            }
        }
        return null;
    }

    _screenToWorld(sx, sy) {
        return {
            x: (sx - this.vpX) / this.scale,
            y: (sy - this.vpY) / this.scale,
        };
    }

    _fitAll() {
        if (!this.nodes.length) return;
        const PAD = 40;
        const xs = this.nodes.map(n => n.x);
        const ys = this.nodes.map(n => n.y);
        const minX = Math.min(...xs) - NODE_W;
        const maxX = Math.max(...xs) + NODE_W;
        const minY = Math.min(...ys) - NODE_H;
        const maxY = Math.max(...ys) + NODE_H;
        const worldW = maxX - minX;
        const worldH = maxY - minY;
        const scaleX = (this.W - PAD * 2) / worldW;
        const scaleY = (this.H - PAD * 2) / worldH;
        this.scale = Math.min(scaleX, scaleY, 1.5);
        this.vpX = PAD - minX * this.scale + (this.W - PAD * 2 - worldW * this.scale) / 2;
        this.vpY = PAD - minY * this.scale + (this.H - PAD * 2 - worldH * this.scale) / 2;
        this._updateZoomLabel();
    }

    _applyZoom(delta, cx, cy) {
        const oldScale = this.scale;
        this.scale = Math.max(0.15, Math.min(3.0, this.scale * (1 - delta * 0.1)));
        // Zoom toward cursor
        this.vpX = cx - (cx - this.vpX) * (this.scale / oldScale);
        this.vpY = cy - (cy - this.vpY) * (this.scale / oldScale);
        this._updateZoomLabel();
    }

    _snapToGrid(node) {
        if (!this.gridSnap) return;
        node.x = Math.round(node.x / GRID_SIZE) * GRID_SIZE;
        node.y = Math.round(node.y / GRID_SIZE) * GRID_SIZE;
    }

    _updateZoomLabel() {
        const el = this.overlayEl.querySelector('#ccs_graph_zoom_label');
        if (el) el.textContent = Math.round(this.scale * 100) + '%';
    }

    _updateStats() {
        const orphaned = _findOrphaned(this.nodes, this.edges);
        const circles = _detectCircularChains(this.entries, this.edges);
        const totalTokens = this.nodes.reduce((s, n) => s + n.tokens, 0);

        const setTxt = (id, txt) => {
            const el = this.overlayEl.querySelector('#' + id);
            if (el) el.textContent = txt;
        };
        setTxt('ccs_graph_stat_entries', `${this.nodes.length} entries`);
        setTxt('ccs_graph_stat_edges', `${this.edges.length} edges`);
        setTxt('ccs_graph_stat_orphaned', `⚠️ ${orphaned.length} orphaned`);
        setTxt('ccs_graph_stat_tokens', `~${totalTokens}t total`);
    }

    // ─── Toolbar Wiring ───────────────────────────────────────────────────────

    _wireToolbar() {
        const qs = (id) => this.overlayEl.querySelector('#' + id);

        qs('ccs_graph_back_btn')?.addEventListener('click', () => closeLoreGraphOverlay());

        qs('ccs_graph_fit_btn')?.addEventListener('click', () => this._fitAll());

        qs('ccs_graph_grid_btn')?.addEventListener('click', (e) => {
            this.gridSnap = !this.gridSnap;
            e.currentTarget.classList.toggle('ccs-graph-tool-btn--active', this.gridSnap);
        });

        qs('ccs_graph_token_btn')?.addEventListener('click', (e) => {
            this.tokenSizeMode = !this.tokenSizeMode;
            e.currentTarget.classList.toggle('ccs-graph-tool-btn--active', this.tokenSizeMode);
        });

        qs('ccs_graph_physics_btn')?.addEventListener('click', (e) => {
            this.physicsEnabled = !this.physicsEnabled;
            e.currentTarget.classList.toggle('ccs-graph-tool-btn--active', this.physicsEnabled);
            if (!this.physicsEnabled) this._applyStaticCategoryLayout();
        });

        qs('ccs_graph_zoom_out')?.addEventListener('click', () => {
            this._applyZoom(3, this.W / 2, this.H / 2);
        });
        qs('ccs_graph_zoom_in')?.addEventListener('click', () => {
            this._applyZoom(-3, this.W / 2, this.H / 2);
        });

        qs('ccs_graph_search_btn')?.addEventListener('click', () => {
            this._togglePanel('ccs_graph_search_panel');
        });
        qs('ccs_graph_sim_btn')?.addEventListener('click', () => {
            this._togglePanel('ccs_graph_sim_panel');
        });

        qs('ccs_graph_export_btn')?.addEventListener('click', () => this._exportPNG());
    }

    _togglePanel(id) {
        const el = this.overlayEl.querySelector('#' + id);
        if (!el) return;
        const isHidden = el.classList.contains('ccs-hidden');
        // Close other panels first
        this.overlayEl.querySelectorAll('.ccs-graph-panel').forEach(p => p.classList.add('ccs-hidden'));
        if (isHidden) el.classList.remove('ccs-hidden');
    }

    // ─── Search Wiring ────────────────────────────────────────────────────────

    _wireSearch() {
        const qs = (id) => this.overlayEl.querySelector('#' + id);

        qs('ccs_graph_search_close')?.addEventListener('click', () => {
            qs('ccs_graph_search_panel')?.classList.add('ccs-hidden');
            this._clearSearch();
        });

        qs('ccs_graph_search_input')?.addEventListener('input', (e) => {
            this.searchQuery = e.target.value.trim();
            this._applySearchFilter();
        });

        this.overlayEl.querySelectorAll('.ccs-graph-filter-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const filter = chip.dataset.filter;
                if (this.activeFilters.has(filter)) {
                    this.activeFilters.delete(filter);
                    chip.classList.remove('ccs-graph-filter-chip--active');
                } else {
                    this.activeFilters.add(filter);
                    chip.classList.add('ccs-graph-filter-chip--active');
                }
                this._applySearchFilter();
            });
        });
    }

    _clearSearch() {
        this.searchQuery = '';
        this.activeFilters.clear();
        this.matchedUids = null;
        const input = this.overlayEl.querySelector('#ccs_graph_search_input');
        if (input) input.value = '';
        this.overlayEl.querySelectorAll('.ccs-graph-filter-chip--active')
            .forEach(c => c.classList.remove('ccs-graph-filter-chip--active'));
    }

    _applySearchFilter() {
        const q = this.searchQuery.toLowerCase();
        const filters = this.activeFilters;
        if (!q && filters.size === 0) {
            this.matchedUids = null;
            const res = this.overlayEl.querySelector('#ccs_graph_search_result');
            if (res) res.textContent = '';
            return;
        }

        const orphanedUids = new Set(_findOrphaned(this.nodes, this.edges).map(n => n.uid));
        const circularUids = new Set(_detectCircularChains(this.entries, this.edges).flat());

        const matched = new Set();
        for (const node of this.nodes) {
            let pass = true;

            if (q) {
                const nameMatch = node.name.toLowerCase().includes(q);
                const keyMatch = (node.entry.keys || []).some(k => k.toLowerCase().includes(q));
                const contentMatch = (node.entry.content || '').toLowerCase().includes(q);
                if (!nameMatch && !keyMatch && !contentMatch) pass = false;
            }

            if (pass && filters.has('constant') && !node.entry.constant) pass = false;
            if (pass && filters.has('orphaned') && !orphanedUids.has(node.uid)) pass = false;
            if (pass && filters.has('circular') && !circularUids.has(node.uid)) pass = false;
            if (pass && filters.has('heavy') && node.tokens <= 300) pass = false;
            if (pass && filters.has('disabled') && node.entry.enabled !== false) pass = false;
            if (pass && filters.has('probabilistic') && (node.entry.probability ?? 100) >= 100) pass = false;

            if (pass) matched.add(node.uid);
        }

        this.matchedUids = matched;
        const res = this.overlayEl.querySelector('#ccs_graph_search_result');
        if (res) res.textContent = `${matched.size} entr${matched.size === 1 ? 'y' : 'ies'} matched`;
    }

    // ─── Simulator Wiring ─────────────────────────────────────────────────────

    _wireSimulator() {
        const qs = (id) => this.overlayEl.querySelector('#' + id);

        qs('ccs_graph_sim_close')?.addEventListener('click', () => {
            qs('ccs_graph_sim_panel')?.classList.add('ccs-hidden');
            this.simActivated = null;
        });

        qs('ccs_graph_sim_run')?.addEventListener('click', () => {
            const testMsg = (qs('ccs_graph_sim_input')?.value || '').trim();
            const depth = parseInt(qs('ccs_graph_sim_depth')?.value || '3', 10);
            const recursionOn = (qs('ccs_graph_sim_recursion')?.value || 'on') === 'on';
            const budget = parseInt(qs('ccs_graph_sim_budget')?.value || '2000', 10);
            if (!testMsg) return;

            const result = this._runSimulation(testMsg, depth, recursionOn, budget);
            this._displaySimResult(result);
        });
    }

    _runSimulation(testMsg, scanDepth, recursionEnabled, tokenBudget) {
        const entries = this.entries;
        const allPasses = {};
        let usedTokens = 0;
        const activated = new Set();

        // Always include CONSTANT entries
        const constantPass = new Set();
        for (const e of entries) {
            if (e.constant && e.enabled !== false) {
                constantPass.add(e.uid);
                activated.add(e.uid);
                usedTokens += e.tokens || 0;
            }
        }
        if (constantPass.size > 0) allPasses.constant = constantPass;

        // Pass 1: direct keyword match in test message
        const pass1 = new Set();
        for (const e of entries) {
            if (activated.has(e.uid)) continue;
            if (e.enabled === false) continue;
            if (_matchesKeys(testMsg, e)) {
                const prob = e.probability ?? 100;
                if (prob < 100 && Math.random() * 100 > prob) continue;
                if (usedTokens + (e.tokens || 0) > tokenBudget) continue;
                pass1.add(e.uid);
                activated.add(e.uid);
                usedTokens += e.tokens || 0;
            }
        }
        allPasses.pass1 = pass1;

        if (!recursionEnabled) {
            const circularChains = _detectCircularChains(entries, this.edges);
            return { passes: allPasses, activated, usedTokens, tokenBudget, circularChains };
        }

        // Recursive passes
        let prevPass = pass1;
        let passNum = 2;
        const MAX_RECURSION = 6;

        while (prevPass.size > 0 && passNum <= MAX_RECURSION) {
            // Build content from previously activated entries
            const newContent = [...prevPass].map(uid => {
                const entry = entries.find(e => e.uid === uid);
                return entry?.content || '';
            }).join('\n');

            const passN = new Set();
            for (const e of entries) {
                if (activated.has(e.uid)) continue;
                if (e.enabled === false) continue;

                // Check if source entries prevent recursion
                const anySourcePreventsRecursion = [...prevPass].some(srcUid => {
                    const src = entries.find(en => en.uid === srcUid);
                    return src?.preventRecursion;
                });
                if (anySourcePreventsRecursion) continue;

                if (_matchesKeys(newContent, e)) {
                    if (usedTokens + (e.tokens || 0) > tokenBudget) continue;
                    passN.add(e.uid);
                    activated.add(e.uid);
                    usedTokens += e.tokens || 0;
                }
            }

            if (passN.size === 0) break;
            allPasses[`pass${passNum}`] = passN;
            prevPass = passN;
            passNum++;
        }

        const circularChains = _detectCircularChains(entries, this.edges);

        // Sync to graph highlighting
        this.simActivated = {};
        let p = 1;
        for (const [key, uidSet] of Object.entries(allPasses)) {
            if (key === 'constant') continue;
            this.simActivated[`pass${p}`] = uidSet;
            p++;
        }

        return { passes: allPasses, activated, usedTokens, tokenBudget, circularChains, entries };
    }

    _displaySimResult(result) {
        const res = this.overlayEl.querySelector('#ccs_graph_sim_result');
        if (!res) return;

        const entries = this.entries;
        let html = '';

        for (const [passKey, uidSet] of Object.entries(result.passes)) {
            const passLabel = passKey === 'constant'
                ? '📌 Always loaded (Constant):'
                : `Pass ${passKey.replace('pass', '')} — ${passKey === 'pass1' ? 'Direct keyword matches' : 'Recursive activation'}:`;

            const items = [...uidSet].map(uid => {
                const entry = entries.find(e => e.uid === uid);
                if (!entry) return '';
                const prob = (entry.probability ?? 100) < 100 ? ` 🎲 ${entry.probability}%` : '';
                const stop = entry.preventRecursion ? ' 🛑' : '';
                return `<div class="ccs-sim-entry"><span class="ccs-sim-entry-name">${_escHtml(entry.name || uid)}</span><span class="ccs-sim-entry-info">~${entry.tokens || 0}t${prob}${stop}</span></div>`;
            }).join('');

            if (uidSet.size > 0) {
                html += `<div class="ccs-sim-pass"><div class="ccs-sim-pass-label">${passLabel}</div>${items}</div>`;
            }
        }

        if (result.activated.size === 0) {
            html = '<div class="ccs-sim-empty">No entries activated for this message.</div>';
        }

        const overBudget = result.usedTokens > result.tokenBudget;
        html += `<div class="ccs-sim-summary ${overBudget ? 'ccs-sim-summary--over' : ''}">
            Total: ${result.activated.size} entries | ~${result.usedTokens}t / ${result.tokenBudget}t budget ${overBudget ? '⚠️ Over budget!' : '✅'}
        </div>`;

        if (result.circularChains?.length > 0) {
            html += `<div class="ccs-sim-warning">⚠️ Circular chains detected: ${result.circularChains.map(c => c.join(' → ')).join('; ')}</div>`;
        }

        res.innerHTML = html;
    }

    // ─── Node Editor Wiring ───────────────────────────────────────────────────

    _wireEditor() {
        const qs = (id) => this.overlayEl.querySelector('#' + id);
        qs('ccs_graph_editor_close')?.addEventListener('click', () => {
            qs('ccs_graph_editor_panel')?.classList.add('ccs-hidden');
        });
    }

    _openEditor(node, readOnly = false) {
        const panel = this.overlayEl.querySelector('#ccs_graph_editor_panel');
        const title = this.overlayEl.querySelector('#ccs_graph_editor_title');
        const body = this.overlayEl.querySelector('#ccs_graph_editor_body');
        if (!panel || !body) return;

        panel.classList.remove('ccs-hidden');
        if (title) title.textContent = readOnly ? 'View Entry' : 'Edit Entry';

        const e = node.entry;
        const disabled = readOnly ? 'disabled' : '';
        const POSITIONS = ['after_char', 'before_char', 'before_author', 'after_author', 'at_depth'];

        body.innerHTML = `
<div class="ccs-editor-field">
    <label class="ccs-editor-label">Name</label>
    <input type="text" class="ccs-editor-input" id="ccs_ged_name" value="${_escHtml(e.name || '')}" ${disabled}/>
</div>
<div class="ccs-editor-field">
    <label class="ccs-editor-label">Category</label>
    <input type="text" class="ccs-editor-input" id="ccs_ged_category" value="${_escHtml(node.category)}" ${disabled}/>
</div>
<div class="ccs-editor-field">
    <label class="ccs-editor-label">Keys (comma separated)</label>
    <input type="text" class="ccs-editor-input" id="ccs_ged_keys" value="${_escHtml((e.keys || []).join(', '))}" ${disabled}/>
</div>
<div class="ccs-editor-row">
    <div class="ccs-editor-field">
        <label class="ccs-editor-label">Order</label>
        <input type="number" class="ccs-editor-input" id="ccs_ged_order" value="${e.order ?? 100}" ${disabled}/>
    </div>
    <div class="ccs-editor-field">
        <label class="ccs-editor-label">Probability %</label>
        <input type="number" class="ccs-editor-input" id="ccs_ged_prob" min="0" max="100" value="${e.probability ?? 100}" ${disabled}/>
    </div>
</div>
<div class="ccs-editor-field">
    <label class="ccs-editor-label">Insertion Position</label>
    <select class="ccs-editor-input" id="ccs_ged_position" ${disabled}>
        ${POSITIONS.map(p => `<option value="${p}" ${e.position === p ? 'selected' : ''}>${p}</option>`).join('')}
    </select>
</div>
<div class="ccs-editor-checks">
    <label class="ccs-editor-check"><input type="checkbox" id="ccs_ged_constant" ${e.constant ? 'checked' : ''} ${disabled}/> Constant (always loaded)</label>
    <label class="ccs-editor-check"><input type="checkbox" id="ccs_ged_nonrecursable" ${e.preventRecursion ? 'checked' : ''} ${disabled}/> Non-recursable</label>
    <label class="ccs-editor-check"><input type="checkbox" id="ccs_ged_preventrecursion" ${e.preventRecursion ? 'checked' : ''} ${disabled}/> Prevent further recursion</label>
    <label class="ccs-editor-check"><input type="checkbox" id="ccs_ged_enabled" ${e.enabled !== false ? 'checked' : ''} ${disabled}/> Enabled</label>
</div>
<div class="ccs-editor-field">
    <label class="ccs-editor-label">Content <span class="ccs-editor-tokens">~${e.tokens || 0}t</span></label>
    <textarea class="ccs-editor-textarea" id="ccs_ged_content" rows="6" ${disabled}>${_escHtml(e.content || '')}</textarea>
</div>
${!readOnly ? `
<div class="ccs-editor-actions">
    <button class="ccs-btn ccs-btn--accent" id="ccs_ged_save"><i class="fa-solid fa-check"></i> Save</button>
    <button class="ccs-btn ccs-btn--danger" id="ccs_ged_delete"><i class="fa-solid fa-trash"></i> Delete</button>
</div>` : ''}
`;

        if (!readOnly) {
            const qs = (id) => body.querySelector('#' + id);
            qs('ccs_ged_save')?.addEventListener('click', () => {
                const changes = {
                    name: qs('ccs_ged_name')?.value || e.name,
                    category: qs('ccs_ged_category')?.value || node.category,
                    keys: (qs('ccs_ged_keys')?.value || '').split(',').map(k => k.trim()).filter(Boolean),
                    order: parseInt(qs('ccs_ged_order')?.value || e.order, 10),
                    probability: parseInt(qs('ccs_ged_prob')?.value || '100', 10),
                    position: qs('ccs_ged_position')?.value || e.position,
                    constant: qs('ccs_ged_constant')?.checked,
                    preventRecursion: qs('ccs_ged_preventrecursion')?.checked,
                    enabled: qs('ccs_ged_enabled')?.checked,
                    content: qs('ccs_ged_content')?.value || '',
                };
                if (this.onEntryEdit) {
                    this.onEntryEdit(e.uid, changes);
                }
                // Update local node data
                Object.assign(node.entry, changes);
                node.name = changes.name;
                node.category = changes.category;
                // Rebuild edges to reflect key changes
                this._initEdges();
                this._updateStats();
                panel.classList.add('ccs-hidden');
            });

            qs('ccs_ged_delete')?.addEventListener('click', () => {
                if (!confirm(`Delete entry "${node.name}"? This cannot be undone.`)) return;
                if (this.onEntryDelete) this.onEntryDelete(e.uid);
                // Remove from local state
                this.nodes = this.nodes.filter(n => n.uid !== node.uid);
                this.edges = this.edges.filter(ed => ed.sourceUid !== node.uid && ed.targetUid !== node.uid);
                this._updateStats();
                panel.classList.add('ccs-hidden');
            });
        }
    }

    // ─── Canvas Event Wiring ──────────────────────────────────────────────────

    _wireCanvasEvents() {
        const c = this.canvas;
        const isMobile = this._isMobile;

        // Wheel zoom (desktop)
        this._onWheel = (e) => {
            e.preventDefault();
            const rect = c.getBoundingClientRect();
            const cx = e.clientX - rect.left;
            const cy = e.clientY - rect.top;
            this._applyZoom(e.deltaY > 0 ? 1 : -1, cx, cy);
        };
        c.addEventListener('wheel', this._onWheel, { passive: false });

        // Mouse events
        this._onMouseDown = (e) => this._handleMouseDown(e);
        this._onMouseMove = (e) => this._handleMouseMove(e);
        this._onMouseUp = (e) => this._handleMouseUp(e);
        this._onDblClick = (e) => this._handleDblClick(e);
        this._onContextMenu = (e) => { e.preventDefault(); this._handleRightClick(e); };

        c.addEventListener('mousedown', this._onMouseDown);
        window.addEventListener('mousemove', this._onMouseMove);
        window.addEventListener('mouseup', this._onMouseUp);
        c.addEventListener('dblclick', this._onDblClick);
        c.addEventListener('contextmenu', this._onContextMenu);

        // Touch events (mobile)
        this._onTouchStart = (e) => this._handleTouchStart(e);
        this._onTouchMove = (e) => this._handleTouchMove(e);
        this._onTouchEnd = (e) => this._handleTouchEnd(e);
        c.addEventListener('touchstart', this._onTouchStart, { passive: false });
        c.addEventListener('touchmove', this._onTouchMove, { passive: false });
        c.addEventListener('touchend', this._onTouchEnd);

        // Hide context menu on any click
        this._onDocClick = () => {
            const ctx = this.overlayEl.querySelector('#ccs_graph_ctx_menu');
            if (ctx) ctx.classList.add('ccs-hidden');
        };
        document.addEventListener('click', this._onDocClick);
    }

    _unbindCanvasEvents() {
        const c = this.canvas;
        c.removeEventListener('wheel', this._onWheel);
        c.removeEventListener('mousedown', this._onMouseDown);
        window.removeEventListener('mousemove', this._onMouseMove);
        window.removeEventListener('mouseup', this._onMouseUp);
        c.removeEventListener('dblclick', this._onDblClick);
        c.removeEventListener('contextmenu', this._onContextMenu);
        c.removeEventListener('touchstart', this._onTouchStart);
        c.removeEventListener('touchmove', this._onTouchMove);
        c.removeEventListener('touchend', this._onTouchEnd);
        document.removeEventListener('click', this._onDocClick);
    }

    _handleMouseDown(e) {
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const world = this._screenToWorld(sx, sy);
        const hit = this._hitTest(world.x, world.y);

        // Hide context menu
        this.overlayEl.querySelector('#ccs_graph_ctx_menu')?.classList.add('ccs-hidden');

        if (hit) {
            // Node drag
            this.dragNode = hit;
            this.dragOffX = world.x - hit.x;
            this.dragOffY = world.y - hit.y;
            this.isDragging = false;
        } else if (e.shiftKey) {
            // Lasso start (desktop Shift+drag)
            this.isLassoing = true;
            this.lassoX1 = world.x;
            this.lassoY1 = world.y;
            this.lassoX2 = world.x;
            this.lassoY2 = world.y;
        } else {
            // Pan start
            this.isPanning = true;
            this.panStartX = e.clientX - this.vpX;
            this.panStartY = e.clientY - this.vpY;
        }
    }

    _handleMouseMove(e) {
        if (this.dragNode) {
            const rect = this.canvas.getBoundingClientRect();
            const sx = e.clientX - rect.left;
            const sy = e.clientY - rect.top;
            const world = this._screenToWorld(sx, sy);
            this.dragNode.x = world.x - this.dragOffX;
            this.dragNode.y = world.y - this.dragOffY;
            this.dragNode.vx = 0;
            this.dragNode.vy = 0;
            this.isDragging = true;
        } else if (this.isLassoing) {
            const rect = this.canvas.getBoundingClientRect();
            const world = this._screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
            this.lassoX2 = world.x;
            this.lassoY2 = world.y;
        } else if (this.isPanning) {
            this.vpX = e.clientX - this.panStartX;
            this.vpY = e.clientY - this.panStartY;
        }
    }

    _handleMouseUp(e) {
        if (this.dragNode) {
            this._snapToGrid(this.dragNode);
            if (!this.isDragging) {
                // It was a click — select/deselect
                const uid = this.dragNode.uid;
                if (e.ctrlKey || e.metaKey) {
                    // Multi-select
                    if (this.selectedUids.has(uid)) this.selectedUids.delete(uid);
                    else this.selectedUids.add(uid);
                } else {
                    this.selectedUids.clear();
                    this.selectedUids.add(uid);
                }
                // Focus connections
                this._setFocusedUid(uid);
            }
            this.dragNode = null;
            this.isDragging = false;
        } else if (this.isLassoing) {
            this._applyLassoSelection();
            this.isLassoing = false;
        } else if (this.isPanning) {
            this.isPanning = false;
        } else {
            // Click on empty space — deselect
            if (!e.shiftKey) {
                this.selectedUids.clear();
                this.focusedUid = null;
                this.matchedUids = null;
            }
        }
    }

    _handleDblClick(e) {
        const rect = this.canvas.getBoundingClientRect();
        const world = this._screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
        const hit = this._hitTest(world.x, world.y);
        if (hit) this._openEditor(hit, false);
    }

    _handleRightClick(e) {
        const rect = this.canvas.getBoundingClientRect();
        const world = this._screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
        const hit = this._hitTest(world.x, world.y);
        if (!hit) return;

        this.ctxNode = hit;
        const menu = this.overlayEl.querySelector('#ccs_graph_ctx_menu');
        if (!menu) return;
        menu.style.left = e.clientX + 'px';
        menu.style.top = e.clientY + 'px';
        menu.classList.remove('ccs-hidden');
    }

    _applyLassoSelection() {
        const x1 = Math.min(this.lassoX1, this.lassoX2);
        const x2 = Math.max(this.lassoX1, this.lassoX2);
        const y1 = Math.min(this.lassoY1, this.lassoY2);
        const y2 = Math.max(this.lassoY1, this.lassoY2);
        this.selectedUids.clear();
        for (const node of this.nodes) {
            if (node.x >= x1 && node.x <= x2 && node.y >= y1 && node.y <= y2) {
                this.selectedUids.add(node.uid);
            }
        }
    }

    _setFocusedUid(uid) {
        this.focusedUid = uid;
        // Highlight this node and its neighbors in the search filter
        const neighborUids = new Set([uid]);
        for (const edge of this.edges) {
            if (edge.sourceUid === uid) neighborUids.add(edge.targetUid);
            if (edge.targetUid === uid) neighborUids.add(edge.sourceUid);
        }
        // Only apply dimming if there are connections (don't dim orphans)
        if (neighborUids.size > 1) {
            this.matchedUids = neighborUids;
        }
    }

    // ─── Touch Events ─────────────────────────────────────────────────────────

    _handleTouchStart(e) {
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();

        if (e.touches.length === 2) {
            // Pinch to zoom
            this.touchStartDist = _touchDist(e.touches);
            this.touchStartScale = this.scale;
            const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
            const my = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
            this.touchMidX = mx;
            this.touchMidY = my;
            this.dragNode = null;
            return;
        }

        const touch = e.touches[0];
        const sx = touch.clientX - rect.left;
        const sy = touch.clientY - rect.top;
        const world = this._screenToWorld(sx, sy);
        const hit = this._hitTest(world.x, world.y);

        if (hit) {
            this.dragNode = hit;
            this.dragOffX = world.x - hit.x;
            this.dragOffY = world.y - hit.y;
            this.isDragging = false;

            // Long press timer
            this.longPressNode = hit;
            this.longPressTimer = setTimeout(() => {
                if (this.longPressNode === hit && !this.isDragging) {
                    this._showTouchContextMenu(hit);
                }
            }, LONG_PRESS_MS);
        } else {
            // Pan
            this.isPanning = true;
            this.panStartX = touch.clientX - this.vpX;
            this.panStartY = touch.clientY - this.vpY;
        }
    }

    _handleTouchMove(e) {
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();

        if (e.touches.length === 2 && this.touchStartDist !== null) {
            // Pinch zoom
            const newDist = _touchDist(e.touches);
            const ratio = newDist / this.touchStartDist;
            const newScale = Math.max(0.15, Math.min(3.0, this.touchStartScale * ratio));
            const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
            const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
            this.vpX = midX - (this.touchMidX - this.vpX) * (newScale / this.scale);
            this.vpY = midY - (this.touchMidY - this.vpY) * (newScale / this.scale);
            this.scale = newScale;
            this.touchMidX = midX;
            this.touchMidY = midY;
            this._updateZoomLabel();
            return;
        }

        if (e.touches.length !== 1) return;
        const touch = e.touches[0];

        if (this.dragNode) {
            const sx = touch.clientX - rect.left;
            const sy = touch.clientY - rect.top;
            const world = this._screenToWorld(sx, sy);
            this.dragNode.x = world.x - this.dragOffX;
            this.dragNode.y = world.y - this.dragOffY;
            this.dragNode.vx = 0;
            this.dragNode.vy = 0;
            this.isDragging = true;
            clearTimeout(this.longPressTimer);
        } else if (this.isPanning) {
            this.vpX = touch.clientX - this.panStartX;
            this.vpY = touch.clientY - this.panStartY;
        }
    }

    _handleTouchEnd(e) {
        clearTimeout(this.longPressTimer);
        this.touchStartDist = null;

        if (this.dragNode) {
            this._snapToGrid(this.dragNode);
            if (!this.isDragging) {
                // Tap = select
                this.selectedUids.clear();
                this.selectedUids.add(this.dragNode.uid);
                this._setFocusedUid(this.dragNode.uid);
            }
            this.dragNode = null;
            this.isDragging = false;
        }
        this.isPanning = false;
    }

    _showTouchContextMenu(node) {
        // On mobile, open the editor directly (no right-click menu)
        this._openEditor(node, false);
    }

    // ─── Context Menu Wiring ──────────────────────────────────────────────────

    _wireContextMenu() {
        const menu = this.overlayEl.querySelector('#ccs_graph_ctx_menu');
        if (!menu) return;

        menu.querySelectorAll('.ccs-graph-ctx-item').forEach(item => {
            item.addEventListener('click', () => {
                const action = item.dataset.action;
                const node = this.ctxNode;
                if (!node) return;
                menu.classList.add('ccs-hidden');

                switch (action) {
                    case 'view': this._openEditor(node, true); break;
                    case 'edit': this._openEditor(node, false); break;
                    case 'focus':
                        this.selectedUids.clear();
                        this.selectedUids.add(node.uid);
                        this._setFocusedUid(node.uid);
                        break;
                    case 'pin':
                        node.pinned = !node.pinned;
                        break;
                    case 'toggle':
                        node.entry.enabled = node.entry.enabled === false ? true : false;
                        if (this.onEntryEdit) this.onEntryEdit(node.entry.uid, { enabled: node.entry.enabled });
                        break;
                    case 'delete':
                        if (!confirm(`Delete "${node.name}"? This cannot be undone.`)) return;
                        if (this.onEntryDelete) this.onEntryDelete(node.entry.uid);
                        this.nodes = this.nodes.filter(n => n.uid !== node.uid);
                        this.edges = this.edges.filter(ed => ed.sourceUid !== node.uid && ed.targetUid !== node.uid);
                        this._updateStats();
                        break;
                }
            });
        });
    }

    // ─── Export ───────────────────────────────────────────────────────────────

    _exportPNG() {
        // Render to offscreen canvas at 2x resolution
        const offW = this.canvas.width;
        const offH = this.canvas.height;
        const off = document.createElement('canvas');
        off.width = offW * 2;
        off.height = offH * 2;
        const octx = off.getContext('2d');
        octx.scale(2, 2);
        octx.clearRect(0, 0, offW, offH);
        octx.fillStyle = '#0a0a12';
        octx.fillRect(0, 0, offW, offH);

        // Swap canvas temporarily, render, swap back
        const origCtx = this.ctx;
        // eslint-disable-next-line no-underscore-dangle
        this.ctx = octx;
        this._render();
        this.ctx = origCtx;

        off.toBlob((blob) => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'lore-graph.png';
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 10000);
        }, 'image/png');
    }
}

// ─── Edge Building ────────────────────────────────────────────────────────────

function _buildEdges(entries) {
    return _buildEdgesFromEntries(entries, entries.map(e => ({ uid: e.uid, entry: e })), false);
}

function _buildEdgesFromEntries(entries, nodes, isMultiBook) {
    const edges = [];
    const uidToNode = new Map(nodes.map(n => [n.uid, n]));

    // Build inclusion group map
    const groupToEntries = new Map();
    for (const e of entries) {
        if (e.group) {
            if (!groupToEntries.has(e.group)) groupToEntries.set(e.group, []);
            groupToEntries.get(e.group).push(e);
        }
    }

    // Keyword activation edges (A's content contains B's key → A activates B)
    for (const entryA of entries) {
        const contentA = (entryA.content || '').toLowerCase();
        const uidA = entryA._world ? `world_${entryA.uid}` : entryA.uid;

        for (const entryB of entries) {
            if (entryA.uid === entryB.uid) continue;
            const uidB = entryB._world ? `world_${entryB.uid}` : entryB.uid;
            const keysB = (entryB.keys || []).filter(k => k.length > 2);
            const matched = keysB.some(k => contentA.includes(k.toLowerCase()));
            if (!matched) continue;

            // Determine edge type
            let type = 'DIRECT';
            if (entryA.constant) type = 'CONSTANT';
            else if (entryB.preventRecursion) type = 'STOP_RECUR';
            else if ((entryB.probability ?? 100) < 100) type = 'PROBABILISTIC';
            else if (entryB.selectiveLogic && entryB.selectiveLogic !== 0) type = 'CONDITIONAL';

            edges.push({
                sourceUid: uidA,
                targetUid: uidB,
                type,
                label: `Contains key: "${keysB.find(k => contentA.includes(k.toLowerCase()))}"`,
            });
        }
    }

    // Inclusion group edges (pairs within same group)
    for (const [, groupEntries] of groupToEntries) {
        for (let i = 0; i < groupEntries.length; i++) {
            for (let j = i + 1; j < groupEntries.length; j++) {
                const uidA = groupEntries[i]._world ? `world_${groupEntries[i].uid}` : groupEntries[i].uid;
                const uidB = groupEntries[j]._world ? `world_${groupEntries[j].uid}` : groupEntries[j].uid;
                // Only add if both exist in nodes
                if (uidToNode.has(uidA) && uidToNode.has(uidB)) {
                    edges.push({ sourceUid: uidA, targetUid: uidB, type: 'INCLUSION', label: `Inclusion group: ${groupEntries[i].group}` });
                }
            }
        }
    }

    return edges;
}

// ─── Graph Analysis Helpers ──────────────────────────────────────────────────

function _findOrphaned(nodes, edges) {
    const connected = new Set(edges.flatMap(e => [e.sourceUid, e.targetUid]));
    return nodes.filter(n => !connected.has(n.uid));
}

function _detectCircularChains(entries, edges) {
    const chains = [];
    const uidToEntry = new Map(entries.map(e => [e.uid, e]));
    const edgeMap = new Map();
    for (const edge of edges) {
        if (!edgeMap.has(edge.sourceUid)) edgeMap.set(edge.sourceUid, []);
        edgeMap.get(edge.sourceUid).push(edge.targetUid);
    }

    function dfs(uid, visited, path) {
        if (visited.has(uid)) {
            const cycleStart = path.indexOf(uid);
            if (cycleStart !== -1) {
                const chain = path.slice(cycleStart).map(u => {
                    const e = uidToEntry.get(u);
                    return e?.name || u;
                });
                chains.push(chain);
            }
            return;
        }
        visited.add(uid);
        path.push(uid);
        for (const next of (edgeMap.get(uid) || [])) {
            dfs(next, new Set(visited), [...path]);
        }
    }

    const allUids = [...new Set(edges.flatMap(e => [e.sourceUid, e.targetUid]))];
    for (const uid of allUids) dfs(uid, new Set(), []);
    // Deduplicate chains
    const seen = new Set();
    return chains.filter(c => {
        const key = [...c].sort().join('|');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function _getMostConnected(nodes, edges) {
    const counts = {};
    for (const e of edges) {
        counts[e.sourceUid] = (counts[e.sourceUid] || 0) + 1;
        counts[e.targetUid] = (counts[e.targetUid] || 0) + 1;
    }
    let best = null;
    let bestCount = 0;
    for (const node of nodes) {
        const count = counts[node.uid] || 0;
        if (count > bestCount) {
            bestCount = count;
            best = { ...node, count };
        }
    }
    return best;
}

function _matchesKeys(text, entry) {
    const lower = text.toLowerCase();
    return (entry.keys || []).some(k => k.length >= 2 && lower.includes(k.toLowerCase()));
}

// ─── Utility Helpers ─────────────────────────────────────────────────────────

function _resolveCategory(entry) {
    const cat = (entry.category || '').trim();
    if (cat) return cat;
    if (entry.constant) return 'Constant';
    return 'Uncategorized';
}

function _roundRect(ctx, x, y, w, h, r) {
    const minR = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + minR, y);
    ctx.lineTo(x + w - minR, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + minR);
    ctx.lineTo(x + w, y + h - minR);
    ctx.quadraticCurveTo(x + w, y + h, x + w - minR, y + h);
    ctx.lineTo(x + minR, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - minR);
    ctx.lineTo(x, y + minR);
    ctx.quadraticCurveTo(x, y, x + minR, y);
    ctx.closePath();
}

function _hexWithAlpha(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

function _abbreviateCanvas(ctx, str, maxWidth) {
    if (!str) return '';
    if (ctx.measureText(str).width <= maxWidth) return str;
    let truncated = str;
    while (truncated.length > 0 && ctx.measureText(truncated + '…').width > maxWidth) {
        truncated = truncated.slice(0, -1);
    }
    return truncated + '…';
}

function _touchDist(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
}

function _simPassColor(passNum) {
    const colors = ['#22c55e', '#f59e0b', '#f97316', '#ef4444', '#a855f7', '#64748b'];
    const c = colors[Math.min(passNum - 1, colors.length - 1)];
    return _hexWithAlpha(c, 0.25);
}

function _escHtml(str) {
    if (!str) return '';
    const el = document.createElement('span');
    el.textContent = str;
    return el.innerHTML;
}
