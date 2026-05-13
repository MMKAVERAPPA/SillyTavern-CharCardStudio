/**
 * EMERGENCY FIX: Force modals and minimize bar to work on ALL viewports
 * 
 * This forcefully ensures settings modal and minimize bar display properly
 * regardless of viewport size, z-index conflicts, or CSS cascade issues.
 */

// ============================================================================
// FIX #1: Settings Modal - Force visibility and positioning
// ============================================================================
const forceModalStyles = () => {
    const modalCSS = `
        /* FORCE MODAL TO WORK */
        #ccs-settings-modal {
            display: flex !important;
            position: fixed !important;
            inset: 0 !important;
            z-index: 2147483647 !important;
            background: rgba(0, 0, 0, 0.75) !important;
            align-items: center !important;
            justify-content: center !important;
            padding: 16px !important;
            box-sizing: border-box !important;
            overflow-y: auto !important;
        }
        
        #ccs-settings-modal .ccs-modal {
            display: flex !important;
            flex-direction: column !important;
            width: 100% !important;
            max-width: 680px !important;
            min-height: 500px !important;
            max-height: 90vh !important;
            background: var(--ccs-surface, #1a1b26) !important;
            border: 1px solid var(--ccs-border2, #414868) !important;
            border-radius: 8px !important;
            overflow: hidden !important;
            position: relative !important;
        }
        
        #ccs-settings-modal .ccs-modal-body {
            flex: 1 !important;
            overflow-y: auto !important;
            display: flex !important;
            flex-direction: column !important;
        }
        
        @media (max-width: 768px) {
            #ccs-settings-modal {
                padding: 0 !important;
                align-items: flex-end !important;
            }
            #ccs-settings-modal .ccs-modal {
                max-width: 100% !important;
                width: 100% !important;
                min-height: 400px !important;
                max-height: 92vh !important;
                border-radius: 8px 8px 0 0 !important;
                margin: 0 !important;
            }
        }
    `;
    
    let styleEl = document.getElementById('ccs-modal-force-fix');
    if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'ccs-modal-force-fix';
        document.head.appendChild(styleEl);
    }
    styleEl.textContent = modalCSS;
};

// ============================================================================
// FIX #2: Minimize Bar - Force visibility and positioning
// ============================================================================
const forceMinimizeBarStyles = () => {
    const minBarCSS = `
        /* FORCE MINIMIZE BAR TO WORK */
        .ccs-min-bar {
            display: flex !important;
            position: fixed !important;
            bottom: 0 !important;
            left: 0 !important;
            right: 0 !important;
            width: 100% !important;
            z-index: 2147483646 !important;
            background: var(--ccs-surface2, #1a1b26) !important;
            border-top: 1px solid var(--ccs-border2, #414868) !important;
            padding: 10px 16px !important;
            align-items: center !important;
            gap: 10px !important;
            box-sizing: border-box !important;
            font-family: sans-serif !important;
            font-size: 0.85rem !important;
            color: var(--ccs-text, #c0caf5) !important;
            box-shadow: 0 -4px 20px rgba(0,0,0,0.4) !important;
        }
        
        .ccs-min-bar * {
            pointer-events: auto !important;
        }
        
        .ccs-min-bar button {
            cursor: pointer !important;
            border: none !important;
            padding: 6px 14px !important;
            border-radius: 4px !important;
            font-size: 0.8rem !important;
            font-weight: 600 !important;
            flex-shrink: 0 !important;
        }
        
        .ccs-min-bar-restore {
            background: var(--ccs-accent, #7aa2f7) !important;
            color: #fff !important;
        }
        
        .ccs-min-bar-close {
            background: none !important;
            color: var(--ccs-text3, #565f89) !important;
            padding: 4px 8px !important;
        }
    `;
    
    let styleEl = document.getElementById('ccs-minbar-force-fix');
    if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'ccs-minbar-force-fix';
        document.head.appendChild(styleEl);
    }
    styleEl.textContent = minBarCSS;
};

// ============================================================================
// Apply fixes immediately
// ============================================================================
forceModalStyles();
forceMinimizeBarStyles();

console.log('✅ Emergency UI fixes applied!');
console.log('   - Settings modal forced visible');
console.log('   - Minimize bar forced visible');
console.log('   - Try clicking settings/minimize buttons now');
