// Quick verification script to check if fixes are actually applied
const fs = require('fs');

console.log('🔍 Verifying Bug Fixes...\n');

// BUG-001: Settings Modal z-index
const css = fs.readFileSync('style.css', 'utf8');
const modalZIndex = css.match(/\.ccs-modal-overlay[^}]*z-index:\s*(\d+)/);
const studioZIndex = css.match(/\.ccs-studio-overlay[^}]*z-index:\s*(\d+)/);

console.log('BUG-001: Settings Modal z-index');
console.log('  Studio overlay z-index:', studioZIndex ? studioZIndex[1] : 'NOT FOUND');
console.log('  Modal overlay z-index:', modalZIndex ? modalZIndex[1] : 'NOT FOUND');
if (modalZIndex && parseInt(modalZIndex[1]) > parseInt(studioZIndex[1])) {
    console.log('  ✅ FIXED: Modal z-index is higher than studio\n');
} else {
    console.log('  ❌ NOT FIXED: Modal z-index should be > ' + (studioZIndex ? studioZIndex[1] : '2147483640') + '\n');
}

// BUG-002: Minimize Bar CSS
const minBarDef = css.match(/\.ccs-min-bar\s*\{[^}]+\}/g);
console.log('BUG-002: Minimize Bar CSS');
console.log('  Found definitions:', minBarDef ? minBarDef.length : 0);
if (minBarDef && minBarDef.length > 0) {
    const hasZIndex = minBarDef.some(def => /z-index/.test(def));
    const hasMobile = css.includes('@media (max-width: 768px)') && css.match(/@media[^}]*max-width:\s*768px[^}]*\{[^}]*\.ccs-min-bar/);
    console.log('  Has z-index:', hasZIndex);
    console.log('  Has mobile breakpoint:', !!hasMobile);
    if (hasZIndex && hasMobile) {
        console.log('  ✅ FIXED: Minimize bar has proper styling\n');
    } else {
        console.log('  ❌ NOT FIXED: Missing required CSS\n');
    }
} else {
    console.log('  ❌ NOT FIXED: No .ccs-min-bar definition found\n');
}

// BUG-003: Duplicate _handleQuickEdit
const popup = fs.readFileSync('ui/popup.js', 'utf8');
const matches = popup.match(/async _handleQuickEdit/g);
console.log('BUG-003: Duplicate _handleQuickEdit function');
console.log('  Found occurrences:', matches ? matches.length : 0);
if (matches && matches.length === 1) {
    console.log('  ✅ FIXED: Only one _handleQuickEdit function\n');
} else {
    console.log('  ❌ NOT FIXED: Should have exactly 1 definition\n');
}

// BUG-004: Drawer Auto-Expand
const hasDrawerExpand = popup.includes('_setDrawerExpanded') && popup.includes('120');
console.log('BUG-004: Drawer Auto-Expand on Mobile');
console.log('  Has auto-expand code:', hasDrawerExpand);
if (hasDrawerExpand) {
    console.log('  ✅ FIXED: Drawer auto-expand implemented\n');
} else {
    console.log('  ❌ NOT FIXED: No auto-expand logic found\n');
}

// BUG-009: addFieldVersion method
const memory = fs.readFileSync('core/memory.js', 'utf8');
const hasAddFieldVersion = memory.includes('addFieldVersion(');
console.log('BUG-009: addFieldVersion method exists');
console.log('  Method exists:', hasAddFieldVersion);
if (hasAddFieldVersion) {
    console.log('  ✅ FIXED: addFieldVersion method exists\n');
} else {
    console.log('  ❌ NOT FIXED: Method not found\n');
}

// BUG-016: generateWithContext usage in ideation
const ideation = fs.readFileSync('phases/ideation.js', 'utf8');
const usesBackground = ideation.match(/generateBackground/g);
const usesContext = ideation.match(/generateWithContext/g);
console.log('BUG-016: Ideation Context Loss');
console.log('  Uses generateBackground:', usesBackground ? usesBackground.length : 0, 'times');
console.log('  Uses generateWithContext:', usesContext ? usesContext.length : 0, 'times');
if (!usesBackground || usesBackground.length === 0) {
    console.log('  ✅ FIXED: All calls use generateWithContext\n');
} else {
    console.log('  ❌ NOT FIXED: Still using generateBackground\n');
}

console.log('═'.repeat(60));
console.log('Summary: Check above for ❌ markers to see what needs fixing');
