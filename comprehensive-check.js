// Comprehensive check of all potential issues
const fs = require('fs');

console.log('🔍 Comprehensive Code Verification\n');

const css = fs.readFileSync('style.css', 'utf8');
const popup = fs.readFileSync('ui/popup.js', 'utf8');
const memory = fs.readFileSync('core/memory.js', 'utf8');
const api = fs.readFileSync('core/api.js', 'utf8');
const settingsModal = fs.readFileSync('ui/settings-modal.js', 'utf8');

// Check all z-index values for potential conflicts
console.log('Z-Index Analysis:');
const zIndexMatches = css.matchAll(/([.#][\w-]+)[^}]*z-index:\s*(\d+)/g);
const zIndexes = [...zIndexMatches].map(m => ({ selector: m[1], value: parseInt(m[2]) }));
zIndexes.sort((a, b) => b.value - a.value);
zIndexes.slice(0, 10).forEach(z => console.log(`  ${z.selector.padEnd(30)} z-index: ${z.value}`));

// Check if settings modal properly uses document.body
console.log('\nSettings Modal Container:');
const containerLine = settingsModal.match(/this\._container\s*=\s*(.+);/);
console.log('  Container:', containerLine ? containerLine[1] : 'NOT FOUND');
if (containerLine && containerLine[1].includes('document.body')) {
    console.log('  ✅ Correctly uses document.body');
} else {
    console.log('  ⚠️  May have issues with container');
}

// Check for any console.log or debugger statements (code cleanup)
console.log('\nCode Cleanliness:');
const debugStatements = popup.match(/console\.(log|debug|warn)/g);
const debuggers = popup.match(/debugger/g);
console.log('  Console statements in popup.js:', debugStatements ? debugStatements.length : 0);
console.log('  Debugger statements:', debuggers ? debuggers.length : 0);

// Check error handling in critical functions
console.log('\nError Handling:');
const tryBlocks = popup.match(/try\s*\{/g);
const catchBlocks = popup.match(/catch\s*\(/g);
console.log('  Try blocks:', tryBlocks ? tryBlocks.length : 0);
console.log('  Catch blocks:', catchBlocks ? catchBlocks.length : 0);
if (tryBlocks && catchBlocks && tryBlocks.length === catchBlocks.length) {
    console.log('  ✅ All try blocks have catch handlers');
} else {
    console.log('  ⚠️  Unmatched try/catch blocks');
}

// Check API rate limit handling
console.log('\nAPI Rate Limiting:');
const hasRateLimitFlag = api.includes('rateLimitHit');
const hasRateLimitCheck = api.includes('if (this.rateLimitHit)');
console.log('  Has rate limit flag:', hasRateLimitFlag);
console.log('  Has rate limit check:', hasRateLimitCheck);
if (hasRateLimitFlag && hasRateLimitCheck) {
    console.log('  ✅ Rate limiting properly implemented');
} else {
    console.log('  ⚠️  Rate limiting may be incomplete');
}

// Check mobile responsiveness
console.log('\nMobile Responsiveness:');
const mobileBreakpoints = css.match(/@media[^{]*max-width:\s*768px/g);
const touchMediaQueries = css.match(/@media[^{]*hover:\s*none/g);
console.log('  Mobile breakpoints (max-width: 768px):', mobileBreakpoints ? mobileBreakpoints.length : 0);
console.log('  Touch-specific rules (hover: none):', touchMediaQueries ? touchMediaQueries.length : 0);

// Check for touch event handlers
const touchEvents = popup.match(/touch(start|end|move)/g);
console.log('  Touch event handlers in popup.js:', touchEvents ? touchEvents.length : 0);

// Check refreshCardFields implementation
console.log('\nRefresh Card Fields:');
const hasRefreshMethod = popup.includes('refreshCardFields()');
const refreshCalls = popup.match(/refreshCardFields\(/g);
console.log('  Method defined:', hasRefreshMethod);
console.log('  Total calls:', refreshCalls ? refreshCalls.length : 0);

console.log('\n' + '═'.repeat(60));
console.log('✅ Verification complete!');
