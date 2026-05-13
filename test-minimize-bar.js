// Comprehensive minimize bar test
console.log('🔍 MINIMIZE BAR DIAGNOSIS');
console.log('========================\n');

const minBar = document.querySelector('.ccs-min-bar');
if (!minBar) {
    console.log('❌ Minimize bar not found - click minimize button first');
} else {
    console.log('✅ Minimize bar exists\n');
    
    // Get computed styles
    const computed = window.getComputedStyle(minBar);
    const rect = minBar.getBoundingClientRect();
    
    console.log('📐 POSITION & SIZE:');
    console.log('  getBoundingClientRect():');
    console.log('    top:', rect.top, 'bottom:', rect.bottom);
    console.log('    left:', rect.left, 'right:', rect.right);
    console.log('    width:', rect.width, 'height:', rect.height);
    console.log('  Computed position:', computed.position);
    console.log('  Computed display:', computed.display);
    console.log('  Computed visibility:', computed.visibility);
    console.log('  Computed opacity:', computed.opacity);
    console.log('  Computed z-index:', computed.zIndex);
    
    console.log('\n🎨 COLORS & VISIBILITY:');
    console.log('  Background:', computed.backgroundColor);
    console.log('  Color:', computed.color);
    console.log('  Border:', computed.border);
    
    console.log('\n🔍 VIEWPORT CHECK:');
    console.log('  Window height:', window.innerHeight);
    console.log('  Bar bottom position:', rect.bottom);
    console.log('  Is bar visible in viewport?', rect.top < window.innerHeight && rect.bottom > 0);
    console.log('  Is bar at bottom?', rect.bottom === window.innerHeight || Math.abs(rect.bottom - window.innerHeight) < 5);
    
    console.log('\n🚫 POTENTIAL BLOCKERS:');
    // Check if anything is covering it
    const elementAtBottom = document.elementFromPoint(window.innerWidth / 2, window.innerHeight - 10);
    console.log('  Element at bottom center:', elementAtBottom?.tagName, elementAtBottom?.className);
    console.log('  Is it the minimize bar?', elementAtBottom === minBar || minBar.contains(elementAtBottom));
    
    // Check parent constraints
    console.log('\n📦 PARENT CONSTRAINTS:');
    let parent = minBar.parentElement;
    let level = 0;
    while (parent && level < 5) {
        const pComputed = window.getComputedStyle(parent);
        console.log(`  Level ${level}: ${parent.tagName}.${parent.className || '(no class)'}`);
        console.log(`    overflow: ${pComputed.overflow}`);
        console.log(`    isolation: ${pComputed.isolation}`);
        console.log(`    transform: ${pComputed.transform}`);
        parent = parent.parentElement;
        level++;
    }
    
    console.log('\n💡 SUGGESTED FIXES:');
    if (rect.bottom < 0 || rect.top > window.innerHeight) {
        console.log('  ⚠️ Bar is outside viewport - position issue');
    }
    if (computed.opacity === '0' || computed.visibility === 'hidden') {
        console.log('  ⚠️ Bar is hidden by opacity/visibility');
    }
    if (rect.height < 5) {
        console.log('  ⚠️ Bar height is too small:', rect.height);
    }
    if (elementAtBottom !== minBar && !minBar.contains(elementAtBottom)) {
        console.log('  ⚠️ Something else is covering the bar:', elementAtBottom?.className);
    }
}

console.log('\n========================');
