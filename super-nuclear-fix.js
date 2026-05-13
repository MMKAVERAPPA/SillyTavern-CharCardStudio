/**
 * SUPER NUCLEAR FIX
 * Forces modal and minimize bar to work by completely bypassing CSS
 */

console.log('☢️ SUPER NUCLEAR FIX STARTING...\n');

// ============================================================================
// FIX #1: Remove isolation: isolate from studio overlay
// ============================================================================
const studioOverlay = document.querySelector('.ccs-studio-overlay');
if (studioOverlay) {
    studioOverlay.style.isolation = 'auto';
    console.log('✅ Removed isolation: isolate from studio overlay');
}

// ============================================================================
// FIX #2: Force modal to be visible and full-screen
// ============================================================================
const modalOverlay = document.getElementById('ccs-settings-modal');
if (modalOverlay) {
    // Detach from any parent and re-append to body
    if (modalOverlay.parentElement !== document.body) {
        console.log('⚠️  Modal was NOT in document.body! Moving it...');
        document.body.appendChild(modalOverlay);
    }
    
    // Force ALL styles inline
    modalOverlay.style.cssText = `
        display: flex !important;
        position: fixed !important;
        inset: 0 !important;
        top: 0 !important;
        left: 0 !important;
        right: 0 !important;
        bottom: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        z-index: 2147483647 !important;
        background: rgba(0, 0, 0, 0.75) !important;
        align-items: center !important;
        justify-content: center !important;
        padding: 16px !important;
        box-sizing: border-box !important;
        overflow-y: auto !important;
        margin: 0 !important;
        transform: none !important;
        isolation: auto !important;
    `;
    
    const modal = modalOverlay.querySelector('.ccs-modal');
    if (modal) {
        modal.style.cssText = `
            display: flex !important;
            flex-direction: column !important;
            width: 100% !important;
            max-width: min(680px, 90vw) !important;
            min-height: 500px !important;
            max-height: 90vh !important;
            overflow: hidden !important;
            position: relative !important;
            margin: auto !important;
            transform: none !important;
        `;
    }
    
    console.log('✅ Modal forced to full-screen');
} else {
    console.log('ℹ️  No modal found (click settings button first)');
}

// ============================================================================
// FIX #3: Force minimize bar to be visible at bottom
// ============================================================================
const minBar = document.querySelector('.ccs-min-bar');
if (minBar) {
    // Detach from any parent and re-append to body
    if (minBar.parentElement !== document.body) {
        console.log('⚠️  Minimize bar was NOT in document.body! Moving it...');
        document.body.appendChild(minBar);
    }
    
    // Force ALL styles inline
    minBar.style.cssText = `
        display: flex !important;
        position: fixed !important;
        bottom: 0 !important;
        left: 0 !important;
        right: 0 !important;
        top: auto !important;
        width: 100vw !important;
        height: auto !important;
        min-height: 50px !important;
        z-index: 2147483646 !important;
        background: #1a1b26 !important;
        border-top: 2px solid #7aa2f7 !important;
        padding: 10px 16px !important;
        align-items: center !important;
        gap: 10px !important;
        box-sizing: border-box !important;
        font-family: sans-serif !important;
        font-size: 0.85rem !important;
        color: #c0caf5 !important;
        box-shadow: 0 -4px 20px rgba(0,0,0,0.8) !important;
        pointer-events: auto !important;
        margin: 0 !important;
        transform: none !important;
        isolation: auto !important;
        visibility: visible !important;
        opacity: 1 !important;
    `;
    
    console.log('✅ Minimize bar forced to bottom');
    console.log('   Position:', minBar.getBoundingClientRect());
} else {
    console.log('ℹ️  No minimize bar found (minimize studio first)');
}

// ============================================================================
// FIX #4: Ensure body and html don't hide elements
// ============================================================================
document.documentElement.style.overflow = 'visible';
document.body.style.overflow = 'visible';

console.log('\n☢️ SUPER NUCLEAR FIX COMPLETE!');
console.log('   Try clicking settings/minimize now');
console.log('   If modal/bar exist, they should be visible\n');
