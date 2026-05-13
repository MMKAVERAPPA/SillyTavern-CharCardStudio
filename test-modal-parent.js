// Test if modal is really in document.body
const modal = document.getElementById('ccs-settings-modal');
if (modal) {
    console.log('Modal parent:', modal.parentElement.tagName);
    console.log('Modal parent classes:', modal.parentElement.className);
    console.log('Is direct child of body?', modal.parentElement === document.body);
    
    // Check for transform/isolation parents
    let parent = modal.parentElement;
    let level = 0;
    while (parent && level < 10) {
        const computed = window.getComputedStyle(parent);
        const isolation = computed.isolation;
        const transform = computed.transform;
        const willChange = computed.willChange;
        console.log(`Level ${level}: ${parent.tagName}.${parent.className}`);
        console.log(`  isolation: ${isolation}`);
        console.log(`  transform: ${transform}`);
        console.log(`  will-change: ${willChange}`);
        parent = parent.parentElement;
        level++;
    }
} else {
    console.log('No modal found - click settings button first');
}
