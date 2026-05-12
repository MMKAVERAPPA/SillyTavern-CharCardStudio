/**
 * CharCardStudio Bug Verification Test
 * Tests all critical bugs in a real browser
 */

const { chromium } = require('playwright');

(async () => {
    console.log('🧪 Starting CharCardStudio Bug Verification...\n');
    
    const browser = await chromium.launch({ 
        headless: false,
        slowMo: 500 // Slow down so we can see what's happening
    });
    
    const context = await browser.newContext({
        viewport: { width: 375, height: 667 }, // iPhone SE
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15'
    });
    
    const page = await context.newPage();
    
    // Listen for console messages
    page.on('console', msg => {
        const type = msg.type();
        if (type === 'error' || type === 'warning') {
            console.log(`  [Browser ${type}]:`, msg.text());
        }
    });
    
    // Listen for page errors
    page.on('pageerror', err => {
        console.log(`  [Page Error]:`, err.message);
    });
    
    try {
        console.log('📱 Opening SillyTavern at http://127.0.0.1:8000/');
        await page.goto('http://127.0.0.1:8000/', { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(2000);
        
        console.log('📸 Taking initial screenshot...');
        await page.screenshot({ path: 'test-screenshots/01-initial-page.png', fullPage: true });
        
        // Check if CharCardStudio extension is loaded
        console.log('\n🔍 Checking if CharCardStudio extension is loaded...');
        const extensionLoaded = await page.evaluate(() => {
            return window._ccsModules !== undefined;
        });
        
        if (!extensionLoaded) {
            console.log('⚠️  Extension not loaded. Checking extensions menu...');
            
            // Try to find and click the extensions menu
            const extButton = await page.$('#extensionsMenuButton, [title*="Extensions"], [aria-label*="Extensions"]');
            if (extButton) {
                await extButton.click();
                await page.waitForTimeout(1000);
                await page.screenshot({ path: 'test-screenshots/02-extensions-menu.png' });
            }
            
            // Look for Card Studio menu item
            const cardStudioItem = await page.$('text=/Card Studio|CharCardStudio|Character Card Studio/i');
            if (cardStudioItem) {
                console.log('✅ Found Card Studio menu item, clicking...');
                await cardStudioItem.click();
                await page.waitForTimeout(2000);
            } else {
                console.log('❌ Card Studio menu item not found');
                await page.screenshot({ path: 'test-screenshots/02-no-card-studio.png' });
            }
        } else {
            console.log('✅ Extension is loaded');
        }
        
        // Try to open studio via command
        console.log('\n🎬 Attempting to open Card Studio...');
        await page.evaluate(() => {
            if (window.openCharCardStudio) {
                window.openCharCardStudio();
            }
        });
        await page.waitForTimeout(1500);
        
        // Check if studio overlay is visible
        const studioVisible = await page.isVisible('.ccs-studio-overlay');
        if (!studioVisible) {
            console.log('⚠️  Studio not visible. Trying to select a character first...');
            // Try to select first character
            const firstChar = await page.$('.character_select:first-child, [data-char-id]:first-child');
            if (firstChar) {
                await firstChar.click();
                await page.waitForTimeout(1000);
                
                // Try opening studio again
                await page.evaluate(() => {
                    if (window.openCharCardStudio) {
                        window.openCharCardStudio();
                    }
                });
                await page.waitForTimeout(1500);
            }
        }
        
        const studioVisibleAfter = await page.isVisible('.ccs-studio-overlay');
        console.log(studioVisibleAfter ? '✅ Studio is visible' : '❌ Studio failed to open');
        
        if (!studioVisibleAfter) {
            console.log('\n❌ Cannot proceed with tests - studio did not open');
            await page.screenshot({ path: 'test-screenshots/03-studio-failed-to-open.png', fullPage: true });
            await browser.close();
            return;
        }
        
        await page.screenshot({ path: 'test-screenshots/03-studio-opened.png', fullPage: true });
        
        // ==================== BUG-001: Settings Modal ====================
        console.log('\n🧪 TEST: BUG-001 - Settings Modal on Mobile');
        const settingsBtn = await page.$('.ccs-header-btn[title*="Settings"], #ccs-settings-btn');
        
        if (settingsBtn) {
            console.log('  Clicking settings button...');
            await settingsBtn.click();
            await page.waitForTimeout(1000);
            
            const modalVisible = await page.isVisible('.ccs-modal-overlay');
            const modalClickable = await page.evaluate(() => {
                const modal = document.querySelector('.ccs-modal-overlay');
                if (!modal) return false;
                const rect = modal.getBoundingClientRect();
                const computedStyle = window.getComputedStyle(modal);
                return {
                    visible: computedStyle.display !== 'none' && computedStyle.visibility !== 'hidden',
                    zIndex: computedStyle.zIndex,
                    opacity: computedStyle.opacity,
                    position: { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
                };
            });
            
            console.log('  Modal state:', modalClickable);
            await page.screenshot({ path: 'test-screenshots/04-settings-modal.png', fullPage: true });
            
            if (modalClickable && modalClickable.visible) {
                console.log('  ✅ BUG-001: FIXED - Settings modal is visible');
            } else {
                console.log('  ❌ BUG-001: NOT FIXED - Settings modal not visible');
            }
            
            // Close modal
            const backdrop = await page.$('.ccs-modal-overlay');
            if (backdrop) {
                await backdrop.click({ position: { x: 10, y: 10 } });
                await page.waitForTimeout(500);
            }
        } else {
            console.log('  ⚠️  Settings button not found');
        }
        
        // ==================== BUG-004: Drawer Auto-Expand ====================
        console.log('\n🧪 TEST: BUG-004 - Workspace Drawer Auto-Expand on Mobile');
        const drawer = await page.$('#ccs-workspace-col, .ccs-drawer');
        
        if (drawer) {
            const drawerExpanded = await page.evaluate(() => {
                const col = document.querySelector('#ccs-workspace-col');
                return col?.classList.contains('expanded') || false;
            });
            
            console.log(`  Drawer expanded: ${drawerExpanded}`);
            await page.screenshot({ path: 'test-screenshots/05-drawer-state.png', fullPage: true });
            
            if (drawerExpanded) {
                console.log('  ✅ BUG-004: FIXED - Drawer is auto-expanded on mobile');
            } else {
                console.log('  ❌ BUG-004: NOT FIXED - Drawer is not expanded');
            }
        } else {
            console.log('  ⚠️  Drawer not found');
        }
        
        // ==================== BUG-002: Minimize Bar ====================
        console.log('\n🧪 TEST: BUG-002 - Minimize Bar Visibility');
        const minimizeBtn = await page.$('.ccs-header-btn[title*="Minimize"], button:has-text("−")');
        
        if (minimizeBtn) {
            console.log('  Clicking minimize button...');
            await minimizeBtn.click();
            await page.waitForTimeout(1000);
            
            const minBarVisible = await page.evaluate(() => {
                const bar = document.querySelector('.ccs-min-bar');
                if (!bar) return { exists: false };
                
                const rect = bar.getBoundingClientRect();
                const style = window.getComputedStyle(bar);
                
                return {
                    exists: true,
                    visible: style.display !== 'none',
                    zIndex: style.zIndex,
                    position: { top: rect.top, left: rect.left, bottom: rect.bottom, right: rect.right },
                    width: rect.width,
                    height: rect.height,
                    inViewport: rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth
                };
            });
            
            console.log('  Minimize bar state:', minBarVisible);
            await page.screenshot({ path: 'test-screenshots/06-minimize-bar.png', fullPage: true });
            
            if (minBarVisible.exists && minBarVisible.inViewport) {
                console.log('  ✅ BUG-002: FIXED - Minimize bar is visible in viewport');
            } else {
                console.log('  ❌ BUG-002: NOT FIXED - Minimize bar not visible or off-screen');
            }
            
            // Try to restore
            const restoreBtn = await page.$('.ccs-min-bar-restore');
            if (restoreBtn) {
                console.log('  Clicking restore button...');
                await restoreBtn.click();
                await page.waitForTimeout(1000);
                await page.screenshot({ path: 'test-screenshots/07-restored.png', fullPage: true });
            }
        } else {
            console.log('  ⚠️  Minimize button not found');
        }
        
        // ==================== BUG-003: Quick Edit Save ====================
        console.log('\n🧪 TEST: BUG-003 - Quick Edit Field Save');
        
        // First, check if we're in the right phase
        await page.evaluate(() => {
            if (window._ccsModules?.popup) {
                const popup = window._ccsModules.popup;
                // Try to switch to generation phase if not already there
                if (popup._routeToPhase) {
                    popup._routeToPhase('generation');
                }
            }
        });
        await page.waitForTimeout(1000);
        
        const editBtn = await page.$('.ccs-field-btn[title*="Quick edit"], button[data-action="quick-edit"]');
        
        if (editBtn) {
            console.log('  Clicking quick edit button...');
            await editBtn.click();
            await page.waitForTimeout(1000);
            
            const textareaVisible = await page.isVisible('textarea.ccs-quick-edit-area, .ccs-quick-edit textarea');
            
            if (textareaVisible) {
                const testText = 'TEST EDIT ' + Date.now();
                console.log(`  Typing test text: "${testText}"`);
                
                await page.fill('textarea.ccs-quick-edit-area, .ccs-quick-edit textarea', testText);
                await page.waitForTimeout(500);
                
                const saveBtn = await page.$('button:has-text("Save"), .ccs-quick-edit button[type="submit"]');
                if (saveBtn) {
                    console.log('  Clicking save button...');
                    await saveBtn.click();
                    await page.waitForTimeout(2000);
                    
                    // Check console for errors
                    const consoleErrors = [];
                    page.on('console', msg => {
                        if (msg.type() === 'error') {
                            consoleErrors.push(msg.text());
                        }
                    });
                    
                    // Check if field was saved
                    const fieldSaved = await page.evaluate(() => {
                        return document.querySelector('.ccs-toast, [class*="toast"]')?.textContent || 'No toast';
                    });
                    
                    console.log('  Toast message:', fieldSaved);
                    await page.screenshot({ path: 'test-screenshots/08-after-quick-edit.png', fullPage: true });
                    
                    if (fieldSaved.includes('Saved') || fieldSaved.includes('success')) {
                        console.log('  ✅ BUG-003: FIXED - Quick edit saved successfully');
                    } else {
                        console.log('  ❌ BUG-003: NOT FIXED - No success confirmation');
                    }
                    
                    if (consoleErrors.length > 0) {
                        console.log('  ⚠️  Console errors detected:', consoleErrors);
                    }
                } else {
                    console.log('  ⚠️  Save button not found');
                }
            } else {
                console.log('  ⚠️  Quick edit textarea not visible');
            }
            
            await page.screenshot({ path: 'test-screenshots/08-quick-edit.png', fullPage: true });
        } else {
            console.log('  ⚠️  Quick edit button not found');
        }
        
        console.log('\n✅ Test complete! Screenshots saved to test-screenshots/');
        console.log('\n📊 Summary:');
        console.log('  - Check test-screenshots/ folder for visual evidence');
        console.log('  - Review console output above for detailed results');
        
    } catch (error) {
        console.error('\n❌ Test failed with error:', error.message);
        await page.screenshot({ path: 'test-screenshots/error.png', fullPage: true });
    } finally {
        console.log('\n⏸️  Browser will stay open for 10 seconds for inspection...');
        await page.waitForTimeout(10000);
        await browser.close();
    }
})();
