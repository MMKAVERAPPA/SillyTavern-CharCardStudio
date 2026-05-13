/**
 * UI Debug Script - Run in browser console
 * Copy/paste this entire script into console while Card Studio is open
 */

console.log("🔍 Card Studio UI Debug");
console.log("========================\n");

// Test 1: Check if modal exists in DOM
console.log("1️⃣ SETTINGS MODAL CHECK:");
const modalOverlay = document.getElementById('ccs-settings-modal');
if (modalOverlay) {
    console.log("✅ Modal exists in DOM");
    const computedOverlay = window.getComputedStyle(modalOverlay);
    console.log("  Display:", computedOverlay.display);
    console.log("  Z-index:", computedOverlay.zIndex);
    console.log("  Position:", computedOverlay.position);
    console.log("  Visibility:", computedOverlay.visibility);
    console.log("  Opacity:", computedOverlay.opacity);

    const modal = modalOverlay.querySelector('.ccs-modal');
    if (modal) {
        const computedModal = window.getComputedStyle(modal);
        console.log("  Modal height:", computedModal.height);
        console.log("  Modal min-height:", computedModal.minHeight);
        console.log("  Modal max-height:", computedModal.maxHeight);
        console.log("  Modal display:", computedModal.display);
    }
} else {
    console.log("❌ Modal NOT in DOM - clicking settings button should create it");
}

// Test 2: Check minimize bar
console.log("\n2️⃣ MINIMIZE BAR CHECK:");
const minBar = document.querySelector('.ccs-min-bar');
if (minBar) {
    console.log("✅ Minimize bar exists in DOM");
    const computed = window.getComputedStyle(minBar);
    console.log("  Display:", computed.display);
    console.log("  Position:", computed.position);
    console.log("  Bottom:", computed.bottom);
    console.log("  Left:", computed.left);
    console.log("  Right:", computed.right);
    console.log("  Width:", computed.width);
    console.log("  Z-index:", computed.zIndex);
    console.log("  Visibility:", computed.visibility);
    console.log("  Opacity:", computed.opacity);
    console.log("  Transform:", computed.transform);
} else {
    console.log("❌ Minimize bar NOT in DOM - studio must be minimized first");
}

// Test 3: Check viewport and media queries
console.log("\n3️⃣ VIEWPORT & MEDIA QUERIES:");
console.log("  Window width:", window.innerWidth);
console.log("  Window height:", window.innerHeight);
console.log("  Device pixel ratio:", window.devicePixelRatio);
console.log("  Mobile view (<768px):", window.innerWidth < 768);

// Test 4: Check studio overlay z-index
console.log("\n4️⃣ Z-INDEX STACK:");
const studioOverlay = document.querySelector('.ccs-studio-overlay');
if (studioOverlay) {
    const computed = window.getComputedStyle(studioOverlay);
    console.log("  Studio overlay z-index:", computed.zIndex);
}
const stModals = document.querySelectorAll('[class*="modal"]');
console.log("  ST modal elements found:", stModals.length);
stModals.forEach((el, i) => {
    const z = window.getComputedStyle(el).zIndex;
    if (z !== 'auto') {
        console.log(`    [${i}] ${el.className}: z-index ${z}`);
    }
});

// Test 5: Check CSS custom properties
console.log("\n5️⃣ CSS VARIABLES:");
const root = document.documentElement;
const rootStyles = window.getComputedStyle(root);
console.log("  --ccs-surface:", rootStyles.getPropertyValue('--ccs-surface'));
console.log("  --ccs-text:", rootStyles.getPropertyValue('--ccs-text'));

// Test 6: Simulate click on settings button
console.log("\n6️⃣ CLICK TEST:");
console.log("Run this command to test settings button click:");
console.log("  document.querySelector('.ccs-hdr-btn[title*=\"Settings\"]')?.click()");
console.log("\nRun this command to test minimize button click:");
console.log("  document.querySelector('.ccs-hdr-btn[title*=\"Minimize\"]')?.click()");

console.log("\n========================");
console.log("📋 Copy the output above and send to me");
