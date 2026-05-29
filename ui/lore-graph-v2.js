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
// For very large graphs, skip O(N²) repulsion — only spring + gravity
const LARGE_GRAPH_THRESHOLD = 80;
const DAMPING = 0.90;          // high damping = fast settling (10% energy loss per tick)
const REPULSION = 18000;
const SPRING_K = 0.035;
const SPRING_REST = 260;       // nodes spread farther apart when connected
const CENTER_GRAVITY = 0.0003; // very weak centre pull — don't fight cluster gravity
const CLUSTER_GRAVITY = 0.007; // gentler cluster pull — less oscillation
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
    DIRECT:      { color: 'rgba(210,160,60,0.75)', dash: [], label: 'Activates' },   // warm amber — visible at any zoom
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
        <button class="ccs-graph-tool-btn" id="ccs_graph_warn_btn" title="Keyword conflict warnings">
            <i class="fa-solid fa-triangle-exclamation"></i>
            <span class="ccs-graph-tool-badge ccs-hidden" id="ccs_graph_warn_badge">0</span>
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
        <span class="ccs-graph-stats-sep">|</span>
        <span id="ccs_graph_stat_budget">…</span>
        <div class="ccs-graph-budget-track">
            <div class="ccs-graph-budget-fill" id="ccs_graph_budget_fill"></div>
        </div>
    </div>

    <!-- Main canvas + all absolute overlays inside the canvas area -->
    <div class="ccs-graph-canvas-area" id="ccs_graph_canvas_area">
        <!-- Floating panels (search, simulator) -->
        <div class="ccs-graph-panel ccs-graph-search-panel ccs-hidden" id="ccs_graph_search_panel">
            <div class="ccs-graph-panel-header">
                <i class="fa-solid fa-magnifying-glass"></i> Search &amp; Filter
                <button class="ccs-graph-panel-close" id="ccs_graph_search_close"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <input type="text" class="ccs-graph-search-input" id="ccs_graph_search_input"
                   placeholder="Entry name, key, or content…" autocomplete="off" />
            <div class="ccs-graph-filter-chips" id="ccs_graph_filter_chips">
                <button class="ccs-graph-filter-chip" data-filter="constant">🔵 Constant only</button>
                <button class="ccs-graph-filter-chip" data-filter="orphaned">⚠️ Orphaned</button>
                <button class="ccs-graph-filter-chip" data-filter="circular">🔄 Circular loops</button>
                <button class="ccs-graph-filter-chip" data-filter="heavy">🏗️ Heavy (&gt;300t)</button>
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

        <!-- Warnings panel -->
        <div class="ccs-graph-panel ccs-graph-warn-panel ccs-hidden" id="ccs_graph_warn_panel">
            <div class="ccs-graph-panel-header">
                <i class="fa-solid fa-triangle-exclamation"></i> Keyword Conflicts
                <button class="ccs-graph-panel-close" id="ccs_graph_warn_close"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="ccs-graph-warn-body" id="ccs_graph_warn_body">
                <div class="ccs-warn-loading">Analysing…</div>
            </div>
        </div>

        <!-- Quick keyword editor -->
        <div class="ccs-graph-panel ccs-graph-kw-panel ccs-hidden" id="ccs_graph_kw_panel">
            <div class="ccs-graph-panel-header">
                <i class="fa-solid fa-key"></i> <span id="ccs_graph_kw_title">Edit Keywords</span>
                <button class="ccs-graph-panel-close" id="ccs_graph_kw_close"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="ccs-graph-kw-body">
                <p class="ccs-kw-hint">Comma-separated. Entry activates when any keyword appears in chat or prior activated content.</p>
                <input type="text" class="ccs-graph-search-input" id="ccs_graph_kw_input" placeholder="dragon, tower, elena…" />
                <div class="ccs-kw-status" id="ccs_graph_kw_status"></div>
                <div class="ccs-kw-actions">
                    <button class="ccs-btn ccs-btn--accent" id="ccs_graph_kw_save"><i class="fa-solid fa-floppy-disk"></i> Save</button>
                    <button class="ccs-btn" id="ccs_graph_kw_cancel">Cancel</button>
                </div>
            </div>
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
            <button class="ccs-graph-ctx-item" data-action="edit-keys"><i class="fa-solid fa-key"></i> Edit Keywords</button>
            <div class="ccs-graph-ctx-sep"></div>
            <button class="ccs-graph-ctx-item" data-action="focus"><i class="fa-solid fa-crosshairs"></i> Focus Connections</button>
            <button class="ccs-graph-ctx-item" data-action="pin"><i class="fa-solid fa-thumbtack"></i> Pin / Unpin</button>
            <div class="ccs-graph-ctx-sep"></div>
            <button class="ccs-graph-ctx-item" data-action="toggle"><i class="fa-solid fa-toggle-on"></i> Enable / Disable</button>
            <button class="ccs-graph-ctx-item ccs-graph-ctx-item--danger" data-action="delete">
                <i class="fa-solid fa-trash"></i> Delete Entry
            </button>
        </div>

        <!-- Hover tooltip -->
        <div class="ccs-graph-tooltip ccs-hidden" id="ccs_graph_tooltip" aria-live="polite"></div>

        <!-- Batch action bar (appears when 2+ nodes selected via lasso) -->
        <div class="ccs-graph-batch-bar ccs-hidden" id="ccs_graph_batch_bar">
            <span class="ccs-batch-label" id="ccs_batch_label">0 selected</span>
            <button class="ccs-batch-btn" id="ccs_batch_enable"><i class="fa-solid fa-circle-check"></i> Enable All</button>
            <button class="ccs-batch-btn" id="ccs_batch_disable"><i class="fa-solid fa-ban"></i> Disable All</button>
            <button class="ccs-batch-btn ccs-batch-btn--clear" id="ccs_batch_clear"><i class="fa-solid fa-xmark"></i> Clear</button>
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
        this.physicsEnabled = false; // Memory opt: physics is opt-in, not default.
                                      // Static category layout is the default —
                                      // it organises nodes cleanly with zero CPU cost.
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
        this._initialLayoutDone = false; // Bug 5: layout deferred to first _resize()
        this._resize();                  // _resize() calls _applyStaticCategoryLayout() on first run
        this._wireToolbar();
        this._wireSearch();
        this._wireSimulator();
        this._wireEditor();
        this._wireCanvasEvents();
        this._wireContextMenu();
        this._wireWarnings();
        this._wireKeywordEditor();
        this._wireBatchBar();
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

        // Bug 15: Build O(1) UID lookup map (replaces O(n) array.find per edge per frame)
        this._rebuildNodeMap();

        // Cache max token value for _nodeWidth() to avoid O(N) recalc per draw call
        this._rebuildMaxTokens();
        // Bug 5: layout applied inside _resize() on first call, after W/H are set from DOM.
    }

    /** Cache max token value so _nodeWidth avoids per-draw array allocation. */
    _rebuildMaxTokens() {
        this._maxTokens = 1;
        for (const n of this.nodes) {
            if (n.tokens > this._maxTokens) this._maxTokens = n.tokens;
        }
    }

    /** Rebuild the O(1) uid→node map. Call after _initNodes or any node add/delete. */
    _rebuildNodeMap() {
        this._nodeMap = new Map(this.nodes.map(n => [n.uid, n]));
    }

    _initEdges() {
        const allEntries = this.worldEntries
            ? [...this.worldEntries.map(e => ({ ...e, _world: true })), ...this.entries]
            : this.entries;

        this.edges = _buildEdgesFromEntries(allEntries, this.nodes, this.worldEntries ? true : false);
        this._invalidateCircularCache();
        // Build per-node connection counts for hub detection in _drawNode
        this._computeConnectionCounts();
        // Analyse keyword overlaps (entries that share a keyword — always co-activate)
        this._analyzeKeywordOverlaps();
    }

    /** Build a map of shared keywords so we can warn the user about unintended co-activation. */
    _analyzeKeywordOverlaps() {
        // keyToUids: keyword -> [uid, uid, ...]
        const keyToUids = new Map();
        for (const entry of this.entries) {
            for (const key of (entry.keys || [])) {
                const lk = key.toLowerCase().trim();
                if (lk.length < 2) continue; // skip single-char keys
                if (!keyToUids.has(lk)) keyToUids.set(lk, []);
                keyToUids.get(lk).push(entry.uid);
            }
        }
        // Per-node: which keywords are shared with at least one other entry
        this._keyOverlaps = new Map();           // uid -> [keyword, ...]
        this._keyOverlapFull = new Map();         // keyword -> [uid, ...] (only conflicts)
        for (const [k, uids] of keyToUids) {
            if (uids.length < 2) continue;
            this._keyOverlapFull.set(k, uids);
            for (const uid of uids) {
                if (!this._keyOverlaps.has(uid)) this._keyOverlaps.set(uid, []);
                this._keyOverlaps.get(uid).push(k);
            }
        }
    }

    /** Count incoming + outgoing edges per node. Stored as node.connectionCount. */
    _computeConnectionCounts() {
        const counts = new Map();
        for (const edge of this.edges) {
            counts.set(edge.sourceUid, (counts.get(edge.sourceUid) || 0) + 1);
            counts.set(edge.targetUid, (counts.get(edge.targetUid) || 0) + 1);
        }
        for (const node of this.nodes) {
            node.connectionCount = counts.get(node.uid) || 0;
        }
    }

    _applyStaticCategoryLayout() {
        // Use this.W / this.H set by _resize() — never read clientWidth again (could be 0).
        const W = this.W || 800;
        const H = this.H || 600;

        // Group nodes by category
        const groups = new Map();
        for (const node of this.nodes) {
            if (!groups.has(node.category)) groups.set(node.category, []);
            groups.get(node.category).push(node);
        }

        // Vogel / sunflower-spiral placement within each category cluster.
        // Golden angle ensures even angular distribution with no grid artifacts.
        const GOLDEN_ANGLE = 2.399963229; // 137.508° in radians
        // Minimum radius step between nodes — keeps them non-overlapping.
        const STEP = Math.max(NODE_W * 1.3, NODE_H * 2.4);

        for (const [cat, catNodes] of groups) {
            const anchor = CATEGORY_ANCHORS[cat] || CATEGORY_ANCHORS['Uncategorized'];
            // Map anchor 0-1 to canvas with 80px edge padding so nodes don't clip.
            const cx = 80 + (W - 160) * anchor.nx;
            const cy = 80 + (H - 160) * anchor.ny;

            const total = catNodes.length;
            catNodes.forEach((node, i) => {
                if (total === 1) {
                    node.x = cx;
                    node.y = cy;
                } else {
                    // r grows with sqrt(i+0.5) → even packing density throughout the spiral
                    // The 0.72 vertical scale gives a flatter, map-like aspect ratio
                    const r = STEP * Math.sqrt(i + 0.5);
                    const theta = i * GOLDEN_ANGLE;
                    node.x = cx + r * Math.cos(theta);
                    node.y = cy + r * Math.sin(theta) * 0.72;
                }
                node.vx = 0;
                node.vy = 0;
            });
        }
    }

    // ─── Resize ───────────────────────────────────────────────────────────────

    _resize() {
        // Guard: ResizeObserver can fire after destroy() removes canvas from DOM.
        const parent = this.canvas.parentElement;
        if (!parent) return;

        const W = parent.clientWidth || 800;
        const H = parent.clientHeight || 600;
        this.dpr = window.devicePixelRatio || 1;

        this.canvas.style.width = W + 'px';
        this.canvas.style.height = H + 'px';
        this.canvas.width = Math.round(W * this.dpr);
        this.canvas.height = Math.round(H * this.dpr);

        // Minimap: set logical size so clearRect covers the whole canvas (fixes trail bug).
        const mmDpr = this.dpr;
        this.minimapCanvas.width = Math.round(MINIMAP_W * mmDpr);
        this.minimapCanvas.height = Math.round(MINIMAP_H * mmDpr);
        this.minimapCanvas.style.width = MINIMAP_W + 'px';
        this.minimapCanvas.style.height = MINIMAP_H + 'px';

        this.W = W;
        this.H = H;

        // Bug 5 fix: apply static layout here, after W/H are known from the real DOM size.
        // _initNodes() calls this with a guard so it only runs once on first paint.
        if (!this._initialLayoutDone && this.nodes?.length) {
            this._initialLayoutDone = true;
            this._applyStaticCategoryLayout();
            this._markDirty();
        }
    }

    // ─── Animation Loop ───────────────────────────────────────────────────────

    start() {
        this.simRunning = true;
        this._dirty = true;
        this._animRunning = false; // tracks whether the rAF loop is actively scheduled
        this._scheduleFrame();
    }

    /**
     * Schedule a single rAF frame if not already scheduled.
     * The loop exits when nothing is dirty and physics is off — it does NOT
     * continuously schedule itself. _markDirty() restarts it on demand.
     * This means zero GPU activity when the graph is idle (just open, not interacting).
     */
    _scheduleFrame() {
        if (this._animRunning || !this.simRunning) return;
        this._animRunning = true;
        this.animId = requestAnimationFrame(() => {
            this._animRunning = false;
            if (!this.simRunning) return;

            if (this.physicsEnabled) {
                this._physicsTick();
                this._dirty = true;
            }

            if (this._dirty) {
                this._render();
                this._renderMinimap();
                this._dirty = false;
            }

            // Only keep looping if physics is still running; otherwise go idle.
            // Next user interaction will call _markDirty() which calls _scheduleFrame().
            if (this.physicsEnabled) {
                this._scheduleFrame();
            }
        });
    }

    /** Mark canvas dirty and restart the idle rAF loop if needed. */
    _markDirty() {
        this._dirty = true;
        this._scheduleFrame(); // no-op if already running
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

        // Fix 3: For large graphs (>LARGE_GRAPH_THRESHOLD nodes), skip the O(N²)
        // repulsion calculation entirely. At 100 nodes that's 4950 pair comparisons
        // per 16ms frame = ~300k float ops/sec, which causes GPU/CPU thrashing and
        // OOM pressure from the JIT heat. Use spring + gravity only (O(E+N)).
        const skipRepulsion = n > LARGE_GRAPH_THRESHOLD;

        if (!skipRepulsion) {
            // Repulsion (all pairs) — O(N²)
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
        } else {
            // Simplified repulsion for large graphs: only repel nodes that are
            // very close (colliding), O(N) best-case with spatial hint.
            const COLLISION_R = (NODE_W + NODE_H) * 0.6;
            for (let i = 0; i < n; i++) {
                const a = nodes[i];
                for (let j = i + 1; j < n; j++) {
                    const b = nodes[j];
                    const dx = b.x - a.x;
                    const dy = b.y - a.y;
                    const dist2 = dx * dx + dy * dy;
                    if (dist2 > COLLISION_R * COLLISION_R) continue; // skip distant pairs
                    const dist = Math.sqrt(dist2) || 1;
                    const force = REPULSION * 0.3 / (dist * dist);
                    const fx = (dx / dist) * force;
                    const fy = (dy / dist) * force;
                    a.vx -= fx;
                    a.vy -= fy;
                    b.vx += fx;
                    b.vy += fy;
                }
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
        let totalKE = 0;
        for (const node of nodes) {
            if (node.pinned || (this.dragNode && this.dragNode.uid === node.uid)) continue;
            node.vx *= DAMPING;
            node.vy *= DAMPING;
            node.x += node.vx;
            node.y += node.vy;
            node.x = Math.max(PAD + NODE_W / 2, Math.min(W - PAD - NODE_W / 2, node.x));
            node.y = Math.max(PAD + NODE_H / 2, Math.min(H - PAD - NODE_H / 2, node.y));
            totalKE += node.vx * node.vx + node.vy * node.vy;
        }

        // Auto-stop physics when kinetic energy settles, then zero residual velocity
        // to prevent drift after the loop exits.
        if (totalKE < 0.04) {
            this.physicsEnabled = false;
            for (const node of nodes) { node.vx = 0; node.vy = 0; }
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
        const baseColor = type.color; // DIRECT edges now use warm amber (set in EDGE_TYPES)
        const alpha = this._getEdgeAlpha(s, t);

        ctx.save();
        ctx.globalAlpha = alpha;

        ctx.strokeStyle = baseColor;
        ctx.lineWidth = (edge.type === 'CONSTANT' ? 2.8 : 1.8) / this.scale; // Visual: slightly thicker for readability
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

        // Memory opt: NO shadowBlur. canvas.shadowBlur forces the browser to allocate
        // a separate offscreen compositing buffer per draw call and run a gaussian blur
        // pass. For 100 nodes that was hundreds of shadow ops per frame.
        // Selected nodes get a thick bright border instead (same visual signal, zero cost).

        // Node background — 0.28 opacity so edges behind the node don't bleed through
        ctx.fillStyle = isSimActive ? _simPassColor(isSimActive) : _hexWithAlpha(baseColor, 0.28);
        _roundRect(ctx, x, y, nw, nh, NODE_R / this.scale);
        ctx.fill();

        // Hub ring: nodes with many connections get a subtle outer ring
        const cc = node.connectionCount || 0;
        if (cc >= 4 && !isFiltered) {
            const ringW = Math.min(cc, 10) * 0.35 + 1;
            ctx.strokeStyle = _hexWithAlpha(baseColor, 0.35);
            ctx.lineWidth = ringW / this.scale;
            ctx.setLineDash([]);
            _roundRect(ctx, x - ringW / this.scale, y - ringW / this.scale,
                       nw + ringW * 2 / this.scale, nh + ringW * 2 / this.scale,
                       (NODE_R + ringW) / this.scale);
            ctx.stroke();
        }

        // Border — thick bright purple for selected, category color otherwise.
        // Constant entries get a brighter, slightly thicker border (static, not pulsing).
        const borderWidth = isSelected ? 2.5 : (node.entry.constant ? 2 : 1.5);
        const borderColor = isSelected
            ? '#a78bfa'
            : (node.entry.constant ? baseColor : _hexWithAlpha(baseColor, 0.7));
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = borderWidth / this.scale;
        ctx.setLineDash(node.entry.constant ? [4, 2] : []);
        _roundRect(ctx, x, y, nw, nh, NODE_R / this.scale);
        ctx.stroke();
        ctx.setLineDash([]);

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
        const mmDpr = this.dpr;

        // Fix 2: scale context to account for the device pixel ratio set in _resize()
        mc.save();
        mc.scale(mmDpr, mmDpr);
        mc.clearRect(0, 0, mw, mh);

        // Background
        mc.fillStyle = 'rgba(10,10,18,0.85)';
        mc.fillRect(0, 0, mw, mh);
        mc.strokeStyle = 'rgba(255,255,255,0.1)';
        mc.lineWidth = 1;
        mc.strokeRect(0, 0, mw, mh);

        if (!this.nodes.length) { mc.restore(); return; }

        // Bug 2 fix: avoid Math.min(...spread) — allocates a full array copy per call.
        // Use a simple loop instead (O(N) with zero allocations).
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const n of this.nodes) {
            if (n.x < minX) minX = n.x;
            if (n.x > maxX) maxX = n.x;
            if (n.y < minY) minY = n.y;
            if (n.y > maxY) maxY = n.y;
        }
        minX -= NODE_W; maxX += NODE_W; minY -= NODE_H; maxY += NODE_H;
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

        mc.restore();
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    // Bug 15: O(1) uid→node lookup via Map (replaces O(n) array.find per edge per frame)
    _nodeByUid(uid) {
        return this._nodeMap?.get(uid) || null;
    }

    _nodeWidth(node) {
        if (!this.tokenSizeMode) return NODE_W;
        // Fix 3: use cached _maxTokens instead of O(N) Math.max(…spread) on every draw call.
        // At 100 nodes × 60fps that's 6000 full-array allocations per second.
        const maxTokens = this._maxTokens || 1;
        const ratio = node.tokens / maxTokens;
        return NODE_W * (0.6 + ratio * 0.8);
    }

    _getEdgeAlpha(s, t) {
        if (this.matchedUids && (this.matchedUids.has(s.uid) || this.matchedUids.has(t.uid))) return 0.88;
        if (this.matchedUids) return 0.05; // strongly dim non-matched edges
        return 0.40; // default: visible but not overwhelming (was 0.70)
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
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const n of this.nodes) {
            if (n.x < minX) minX = n.x;
            if (n.x > maxX) maxX = n.x;
            if (n.y < minY) minY = n.y;
            if (n.y > maxY) maxY = n.y;
        }
        minX -= NODE_W; maxX += NODE_W; minY -= NODE_H; maxY += NODE_H;
        // Bug 4 guard: avoid divide-by-zero when all nodes overlap (returns Infinity scale)
        const worldW = (maxX - minX) || 1;
        const worldH = (maxY - minY) || 1;
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
        this._markDirty();
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
        const circles = this._getCircularChains();
        const totalTokens = this.nodes.reduce((s, n) => s + (n.tokens || 0), 0);
        const edgeCapped = this.edges.length >= 400;
        const conflictCount = this._keyOverlapFull?.size || 0;

        const setTxt = (id, txt) => {
            const el = this.overlayEl.querySelector('#' + id);
            if (el) el.textContent = txt;
        };
        setTxt('ccs_graph_stat_entries', `${this.nodes.length} entries`);
        setTxt('ccs_graph_stat_edges', edgeCapped
            ? `${this.edges.length} edges (capped)`
            : `${this.edges.length} edges`);
        setTxt('ccs_graph_stat_orphaned', `⚠️ ${orphaned.length} orphaned`);
        setTxt('ccs_graph_stat_tokens', `~${totalTokens}t total`);

        // Budget bar: compare total enabled tokens vs sim budget setting
        const budgetEl = this.overlayEl.querySelector('#ccs_graph_sim_budget');
        const budget = budgetEl ? parseInt(budgetEl.value, 10) : 2000;
        const enabledTokens = this.nodes
            .filter(n => n.entry.enabled !== false)
            .reduce((s, n) => s + (n.tokens || 0), 0);
        const pct = Math.min(100, (enabledTokens / budget) * 100);
        const fill = this.overlayEl.querySelector('#ccs_graph_budget_fill');
        if (fill) {
            fill.style.width = pct + '%';
            fill.style.background = pct > 85 ? '#ef4444' : pct > 60 ? '#f59e0b' : '#22c55e';
        }
        const budgetLbl = pct > 85 ? '⚠️ Over budget' : pct > 60 ? '🟡 Near limit' : '✅ In budget';
        setTxt('ccs_graph_stat_budget', `${Math.round(pct)}% context ${budgetLbl}`);

        // Warnings badge
        const badge = this.overlayEl.querySelector('#ccs_graph_warn_badge');
        if (badge) {
            badge.textContent = conflictCount;
            badge.classList.toggle('ccs-hidden', conflictCount === 0);
        }
        const warnBtn = this.overlayEl.querySelector('#ccs_graph_warn_btn');
        if (warnBtn) warnBtn.classList.toggle('ccs-graph-tool-btn--warn', conflictCount > 0);
    }

    /**
     * Return cached circular chains. The cache is invalidated whenever edges change
     * (i.e. after _initEdges() or a node-save). This avoids re-running the expensive
     * DFS on every stats update and every search keystroke.
     */
    _getCircularChains() {
        if (!this._circularChainCache) {
            this._circularChainCache = _detectCircularChains(this.entries, this.edges);
        }
        return this._circularChainCache;
    }

    /** Invalidate the circular chain cache. Call after edges change. */
    _invalidateCircularCache() {
        this._circularChainCache = null;
    }

    // ─── Toolbar Wiring ───────────────────────────────────────────────────────

    _wireToolbar() {
        const qs = (id) => this.overlayEl.querySelector('#' + id);

        qs('ccs_graph_back_btn')?.addEventListener('click', () => closeLoreGraphOverlay());
        qs('ccs_graph_fit_btn')?.addEventListener('click', () => this._fitAll());
        qs('ccs_graph_warn_btn')?.addEventListener('click', () => {
            const panel = qs('ccs_graph_warn_panel');
            if (!panel) return;
            const isHidden = panel.classList.contains('ccs-hidden');
            panel.classList.toggle('ccs-hidden', !isHidden);
            if (isHidden) this._renderWarningsPanel();
        });

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
            if (this.physicsEnabled) {
                // Restart the rAF loop (it went idle when physics was off)
                this._scheduleFrame();
            } else {
                this._applyStaticCategoryLayout();
                this._markDirty();
            }
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
        this._markDirty();
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
        // Bug 3 fix: use cached circular chains instead of re-running DFS on every keystroke
        const circularUids = new Set(this._getCircularChains().flat());

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
        this._markDirty();
    }


    // ─── Warnings Panel ──────────────────────────────────────────────────────────

    _wireWarnings() {
        const qs = (id) => this.overlayEl.querySelector('#' + id);
        qs('ccs_graph_warn_close')?.addEventListener('click', () =>
            qs('ccs_graph_warn_panel')?.classList.add('ccs-hidden'));
    }

    _renderWarningsPanel() {
        const body = this.overlayEl.querySelector('#ccs_graph_warn_body');
        if (!body) return;

        const uidToName = new Map(this.nodes.map(n => [n.uid, n.name]));
        const overlaps = this._keyOverlapFull;
        // Dead entries: enabled, no keys, not constant — will never activate
        const dead = this.entries.filter(e =>
            e.enabled !== false && !e.constant && !(e.keys?.length));

        let html = '';

        if (dead.length) {
            html += `<div class="ccs-warn-section">Dead entries (no keywords &amp; not constant)</div>`;
            html += dead.map(e =>
                `<div class="ccs-warn-item ccs-warn-item--dead">` +
                `<i class="fa-solid fa-circle-xmark"></i> ` +
                `<span>${_escHtml(e.name || String(e.uid))}</span>` +
                `<span class="ccs-warn-tip">Will never activate</span></div>`
            ).join('');
        }

        if (!overlaps || overlaps.size === 0) {
            html += '<div class="ccs-warn-ok">\u2705 No keyword conflicts found.</div>';
        } else {
            html += `<div class="ccs-warn-section">${overlaps.size} shared keyword${overlaps.size !== 1 ? 's' : ''} (always co-activate)</div>`;
            for (const [key, uids] of overlaps) {
                const names = uids.map(uid => _escHtml(uidToName.get(uid) || String(uid))).join(', ');
                html += `<div class="ccs-warn-item">` +
                    `<span class="ccs-tt-key">${_escHtml(key)}</span>` +
                    `<span class="ccs-warn-affected">\u2192 ${names}</span></div>`;
            }
        }
        body.innerHTML = html;
    }

    // ─── Quick Keyword Editor ────────────────────────────────────────────────────

    _wireKeywordEditor() {
        const qs = (id) => this.overlayEl.querySelector('#' + id);
        qs('ccs_graph_kw_close')?.addEventListener('click', () =>
            qs('ccs_graph_kw_panel')?.classList.add('ccs-hidden'));
        qs('ccs_graph_kw_cancel')?.addEventListener('click', () =>
            qs('ccs_graph_kw_panel')?.classList.add('ccs-hidden'));
        qs('ccs_graph_kw_save')?.addEventListener('click', () => this._saveKeywords());
        qs('ccs_graph_kw_input')?.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') this._saveKeywords();
            if (ev.key === 'Escape') qs('ccs_graph_kw_panel')?.classList.add('ccs-hidden');
        });
    }

    _openKeywordEditor(node) {
        const qs = (id) => this.overlayEl.querySelector('#' + id);
        this._kwEditNode = node;
        const input = qs('ccs_graph_kw_input');
        const status = qs('ccs_graph_kw_status');
        const title = qs('ccs_graph_kw_title');
        if (!input) return;
        if (title) title.textContent = `Keywords \u2014 ${node.name}`;
        input.value = (node.entry.keys || []).join(', ');
        if (status) status.textContent = '';
        qs('ccs_graph_kw_panel')?.classList.remove('ccs-hidden');
        qs('ccs_graph_editor_panel')?.classList.add('ccs-hidden');
        qs('ccs_graph_warn_panel')?.classList.add('ccs-hidden');
        this._hideTooltip();
        setTimeout(() => input.focus(), 60);
    }

    _saveKeywords() {
        const qs = (id) => this.overlayEl.querySelector('#' + id);
        const node = this._kwEditNode;
        const input = qs('ccs_graph_kw_input');
        const status = qs('ccs_graph_kw_status');
        if (!node || !input) return;

        const newKeys = input.value.split(',').map(k => k.trim()).filter(k => k.length > 0);
        node.entry.keys = newKeys;
        if (this.onEntryEdit) this.onEntryEdit(node.entry.uid, { keys: newKeys });

        // Refresh edges + overlaps since keyword changes affect connections
        this._initEdges();
        this._updateStats();
        this._markDirty();

        if (status) {
            status.textContent = `\u2705 Saved ${newKeys.length} keyword${newKeys.length !== 1 ? 's' : ''}`;
            status.style.color = '#22c55e';
        }
        setTimeout(() => qs('ccs_graph_kw_panel')?.classList.add('ccs-hidden'), 900);
    }

    // ─── Batch Actions ───────────────────────────────────────────────────────────

    _wireBatchBar() {
        const qs = (id) => this.overlayEl.querySelector('#' + id);
        qs('ccs_batch_enable')?.addEventListener('click', () => this._executeBatchAction('enable'));
        qs('ccs_batch_disable')?.addEventListener('click', () => this._executeBatchAction('disable'));
        qs('ccs_batch_clear')?.addEventListener('click', () => {
            this.selectedUids.clear();
            this.focusedUid = null;
            this.matchedUids = null;
            this._updateBatchBar();
            this._markDirty();
        });
    }

    _updateBatchBar() {
        const bar = this.overlayEl?.querySelector('#ccs_graph_batch_bar');
        if (!bar) return;
        const n = this.selectedUids.size;
        if (n < 2) { bar.classList.add('ccs-hidden'); return; }
        bar.classList.remove('ccs-hidden');
        const lbl = bar.querySelector('#ccs_batch_label');
        if (lbl) lbl.textContent = `${n} selected`;
    }

    _executeBatchAction(action) {
        const newEnabled = action === 'enable';
        for (const uid of this.selectedUids) {
            const node = this._nodeByUid(uid);
            if (!node) continue;
            node.entry.enabled = newEnabled;
            if (this.onEntryEdit) this.onEntryEdit(node.entry.uid, { enabled: newEnabled });
        }
        this._updateStats();
        this._markDirty();
    }

    // ─── Hover Tooltip ───────────────────────────────────────────────────────────

    _showTooltip(node, screenX, screenY) {
        const tt = this.overlayEl?.querySelector('#ccs_graph_tooltip');
        if (!tt) return;

        const e = node.entry;
        const keys = e.keys || [];
        const cc = node.connectionCount || 0;
        const overlapping = this._keyOverlaps?.get(node.uid) || [];

        // Plain-English "why isn't this triggering?" diagnosis
        let triggerNote;
        if (e.constant) {
            triggerNote = '\ud83d\udccc Always loaded \u2014 constant entry';
        } else if (e.enabled === false) {
            triggerNote = '\ud83d\udeab Disabled \u2014 will never load';
        } else if (!keys.length) {
            triggerNote = '\u26a0\ufe0f No keywords \u2014 mark Constant or add keywords to activate';
        } else if ((e.probability ?? 100) < 100) {
            triggerNote = `\ud83c\udfb2 ${e.probability}% chance per match`;
        } else {
            const sample = keys.slice(0, 2).map(k => `"${k}"`).join(' or ');
            triggerNote = `Triggers when ${sample}${keys.length > 2 ? ` (+${keys.length - 2} more)` : ''} appears in chat`;
        }

        const keyPills = keys.length
            ? keys.map(k => `<span class="ccs-tt-key">${_escHtml(k)}</span>`).join(' ')
            : '<span class="ccs-tt-nokeys">none</span>';

        const overlapHtml = overlapping.length
            ? `<div class="ccs-tt-warning">\u26a0\ufe0f Shared keywords: ${
                overlapping.map(k => `<b>${_escHtml(k)}</b>`).join(', ')}</div>`
            : '';

        const probRow = (e.probability ?? 100) < 100
            ? `<div class="ccs-tt-row"><span class="ccs-tt-label">Probability</span><b>${e.probability}%</b></div>`
            : '';

        tt.innerHTML =
            `<div class="ccs-tt-title">${_escHtml(node.name)}</div>` +
            `<div class="ccs-tt-meta">` +
            `<div class="ccs-tt-row"><span class="ccs-tt-label">Category</span><b>${_escHtml(node.category)}</b></div>` +
            `<div class="ccs-tt-row"><span class="ccs-tt-label">Tokens</span><b>~${node.tokens}t</b></div>` +
            `<div class="ccs-tt-row"><span class="ccs-tt-label">Connections</span><b>${cc}</b></div>` +
            probRow +
            `</div>` +
            `<div class="ccs-tt-section">Keywords</div>` +
            `<div class="ccs-tt-keys">${keyPills}</div>` +
            overlapHtml +
            `<div class="ccs-tt-trigger">${triggerNote}</div>` +
            `<div class="ccs-tt-hint">Double-click to edit \u2022 Right-click for options</div>`;

        tt.classList.remove('ccs-hidden');

        // Position near cursor, clamped inside overlay
        const ovl = this.overlayEl.getBoundingClientRect();
        let tx = (screenX - ovl.left) + 14;
        let ty = (screenY - ovl.top) + 14;
        if (tx + 240 > ovl.width)  tx = (screenX - ovl.left) - 254;
        if (ty + 230 > ovl.height) ty = (screenY - ovl.top)  - 244;
        tt.style.left = Math.max(4, tx) + 'px';
        tt.style.top  = Math.max(4, ty) + 'px';
    }

    _hideTooltip() {
        this.overlayEl?.querySelector('#ccs_graph_tooltip')?.classList.add('ccs-hidden');
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

        // Bug 3+6 fix: build O(1) UID lookup map once — replaces O(N) entries.find() inside loops.
        const uidToEntry = new Map(entries.map(e => [e.uid, e]));

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
            const circularChains = this._getCircularChains();
            return { passes: allPasses, activated, usedTokens, tokenBudget, circularChains };
        }

        // Recursive passes
        let prevPass = pass1;
        let passNum = 2;
        const MAX_RECURSION = 6;

        while (prevPass.size > 0 && passNum <= MAX_RECURSION) {
            // Bug 3 fix: use uidToEntry Map (O(1)) instead of entries.find() (O(N)) per uid.
            const newContent = [...prevPass]
                .map(uid => uidToEntry.get(uid)?.content || '')
                .join('\n');

            // Bug 6 fix: compute preventRecursion check ONCE per pass, not per entry.
            // Checking every prevPass uid against entries was O(P×N) per entry.
            let prevPassPreventsRecursion = false;
            for (const srcUid of prevPass) {
                if (uidToEntry.get(srcUid)?.preventRecursion) {
                    prevPassPreventsRecursion = true;
                    break;
                }
            }
            if (prevPassPreventsRecursion) break; // entire recursion chain stops

            const passN = new Set();
            for (const e of entries) {
                if (activated.has(e.uid)) continue;
                if (e.enabled === false) continue;
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

        const circularChains = this._getCircularChains();

        // Sync to graph highlighting
        this.simActivated = {};
        let p = 1;
        for (const [key, uidSet] of Object.entries(allPasses)) {
            if (key === 'constant') continue;
            this.simActivated[`pass${p}`] = uidSet;
            p++;
        }
        this._markDirty(); // redraw so highlight appears immediately

        return { passes: allPasses, activated, usedTokens, tokenBudget, circularChains, entries, uidToEntry };
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
                const entry = result.uidToEntry?.get(uid) || result.entries?.find(e => e.uid === uid);
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
                node.tokens = changes.tokens ?? node.tokens;
                // Rebuild edges to reflect key changes
                this._initEdges();
                this._rebuildMaxTokens(); // token counts may have changed
                this._updateStats();
                this._markDirty();
                panel.classList.add('ccs-hidden');
            });

            qs('ccs_ged_delete')?.addEventListener('click', () => {
                if (!confirm(`Delete entry "${node.name}"? This cannot be undone.`)) return;
                if (this.onEntryDelete) this.onEntryDelete(e.uid);
                // Remove from local state
                this.nodes = this.nodes.filter(n => n.uid !== node.uid);
                this.edges = this.edges.filter(ed => ed.sourceUid !== node.uid && ed.targetUid !== node.uid);
                this._rebuildNodeMap(); // keep O(1) map in sync
                this._rebuildMaxTokens(); // max may have changed
                this._updateStats();
                this._markDirty();
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
            this._hideTooltip(); // hide while dragging
            this._markDirty();
        } else if (this.isLassoing) {
            const rect = this.canvas.getBoundingClientRect();
            const world = this._screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
            this.lassoX2 = world.x;
            this.lassoY2 = world.y;
            this._hideTooltip();
            this._markDirty();
        } else if (this.isPanning) {
            this.vpX = e.clientX - this.panStartX;
            this.vpY = e.clientY - this.panStartY;
            this._hideTooltip();
            this._markDirty();
        } else {
            // Idle — show tooltip on node hover
            const rect = this.canvas.getBoundingClientRect();
            const world = this._screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
            const hit = this._hitTest(world.x, world.y);
            if (hit) {
                this._showTooltip(hit, e.clientX, e.clientY);
            } else {
                this._hideTooltip();
            }
        }
    }

    _handleMouseUp(e) {
        if (this.dragNode) {
            this._snapToGrid(this.dragNode);
            if (!this.isDragging) {
                const uid = this.dragNode.uid;
                if (e.ctrlKey || e.metaKey) {
                    if (this.selectedUids.has(uid)) this.selectedUids.delete(uid);
                    else this.selectedUids.add(uid);
                } else {
                    this.selectedUids.clear();
                    this.selectedUids.add(uid);
                }
                this._setFocusedUid(uid);
            }
            this.dragNode = null;
            this.isDragging = false;
            this._updateBatchBar();
            this._markDirty();
        } else if (this.isLassoing) {
            this._applyLassoSelection();
            this.isLassoing = false;
            this._updateBatchBar();
            this._markDirty();
        } else if (this.isPanning) {
            this.isPanning = false;
        } else {
            // Click on empty space — deselect
            if (!e.shiftKey) {
                this.selectedUids.clear();
                this.focusedUid = null;
                this.matchedUids = null;
                this._markDirty();
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
            this._markDirty();
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
            this._markDirty();
        } else if (this.isPanning) {
            this.vpX = touch.clientX - this.panStartX;
            this.vpY = touch.clientY - this.panStartY;
            this._markDirty();
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
                    case 'edit-keys': this._openKeywordEditor(node); break;
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
                        this._rebuildNodeMap(); // keep O(1) map in sync
                        this._rebuildMaxTokens(); // max may have changed
                        this._updateStats();
                        this._markDirty();
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
    // Fix 3: cap total edges to prevent OOM. A 100-entry lorebook can produce
    // up to 9900 directed edges — each drawn as a bezier with arrowhead every frame.
    const MAX_EDGES = 400;

    // Build inclusion group map
    const groupToEntries = new Map();
    for (const e of entries) {
        if (e.group) {
            if (!groupToEntries.has(e.group)) groupToEntries.set(e.group, []);
            groupToEntries.get(e.group).push(e);
        }
    }

    // Keyword activation edges (A's content contains B's key → A activates B)
    // Fix 3: pre-compute lowercased, truncated content and filtered key arrays
    // outside the inner loop to avoid repeated work for each (A,B) pair.
    // Bug 4 fix: raised from 800 → 2000 chars. SillyTavern entries routinely have
    // 2000-5000 token content; 800 chars missed keywords appearing mid-entry.
    // OOM risk is still bounded by the MAX_EDGES=400 cap on total output edges.
    const CONTENT_SCAN_LEN = 2000;
    for (const entryA of entries) {
        if (edges.length >= MAX_EDGES) break;
        // Truncate content to avoid scanning huge strings 100× per entry
        const contentA = (entryA.content || '').slice(0, CONTENT_SCAN_LEN).toLowerCase();
        const uidA = entryA._world ? `world_${entryA.uid}` : entryA.uid;

        for (const entryB of entries) {
            if (edges.length >= MAX_EDGES) break;
            if (entryA.uid === entryB.uid) continue;
            const uidB = entryB._world ? `world_${entryB.uid}` : entryB.uid;
            // Fix 3: filter keys outside inner search (avoid recomputing per every B for same A)
            const keysB = (entryB.keys || []).filter(k => k.length > 2);
            const matchedKey = keysB.find(k => contentA.includes(k.toLowerCase()));
            if (!matchedKey) continue;

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
                label: `Contains key: "${matchedKey}"`,
            });
        }
    }

    // Inclusion group edges (pairs within same group)
    for (const [, groupEntries] of groupToEntries) {
        if (edges.length >= MAX_EDGES) break;
        for (let i = 0; i < groupEntries.length; i++) {
            for (let j = i + 1; j < groupEntries.length; j++) {
                if (edges.length >= MAX_EDGES) break;
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
    // Memory opt: avoid flatMap intermediate array allocation
    const connected = new Set();
    for (const e of edges) {
        connected.add(e.sourceUid);
        connected.add(e.targetUid);
    }
    return nodes.filter(n => !connected.has(n.uid));
}

/**
 * Detect circular activation chains in the lorebook edge graph.
 *
 * Bug 2 fix: replaced recursive DFS (exponential stack growth on dense graphs)
 * with an iterative stack-based DFS. This eliminates JS call-stack overflows
 * on lorebooks with 80+ entries and dense keyword connections.
 */
/**
 * Bug 1 fix: replaced the old DFS that cloned `new Set(visited)` on every stack frame.
 * On a 100-node dense graph that created thousands of Set copies, causing GC pressure.
 *
 * New approach: proper backtracking DFS using a path array + inPath Set.
 * We push/pop from path as we go, so we never clone — O(V+E) time, O(V) space.
 */
function _detectCircularChains(entries, edges) {
    const chains = [];
    const uidToEntry = new Map(entries.map(e => [e.uid, e]));

    // Build adjacency list
    const edgeMap = new Map();
    for (const edge of edges) {
        if (!edgeMap.has(edge.sourceUid)) edgeMap.set(edge.sourceUid, []);
        edgeMap.get(edge.sourceUid).push(edge.targetUid);
    }

    // Collect all unique UIDs that appear in edges
    const allUids = new Set();
    for (const edge of edges) {
        allUids.add(edge.sourceUid);
        allUids.add(edge.targetUid);
    }

    // Standard iterative DFS with backtracking — no Set copies, zero allocations per frame
    const globalVisited = new Set(); // nodes fully processed (all descendants explored)
    for (const startUid of allUids) {
        if (globalVisited.has(startUid)) continue;

        const path = [];       // current DFS path
        const inPath = new Set(); // O(1) cycle check

        // Stack holds [uid, childIndex] pairs for iterative DFS with backtracking
        const stack = [[startUid, 0]];
        path.push(startUid);
        inPath.add(startUid);

        while (stack.length > 0) {
            const frame = stack[stack.length - 1];
            const uid = frame[0];
            const neighbors = edgeMap.get(uid) || [];
            const ci = frame[1];

            if (ci < neighbors.length) {
                frame[1]++; // advance child pointer
                const next = neighbors[ci];
                if (inPath.has(next)) {
                    // Back edge → cycle found
                    const cycleStart = path.indexOf(next);
                    if (cycleStart !== -1) {
                        const chain = path.slice(cycleStart).map(u => {
                            const e = uidToEntry.get(u);
                            return e?.name || u;
                        });
                        chains.push(chain);
                    }
                } else if (!globalVisited.has(next)) {
                    path.push(next);
                    inPath.add(next);
                    stack.push([next, 0]);
                }
            } else {
                // All children explored — backtrack
                stack.pop();
                path.pop();
                inPath.delete(uid);
                globalVisited.add(uid);
            }
        }
    }

    // Deduplicate chains by sorted-key fingerprint
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
