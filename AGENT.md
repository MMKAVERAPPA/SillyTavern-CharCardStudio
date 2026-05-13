# AGENT.md - CharCardStudio Extension Debugging

## Project Context
SillyTavern third-party extension with 3 critical bugs:
1. Settings modal not opening/visible
2. Minimize function not working
3. Save function causing 403 errors

## Key Learnings

### Import Paths for Third-Party Extensions
- **CRITICAL**: Third-party extensions ARE installed at `public/scripts/extensions/third-party/ExtensionName/`
- From `index.js`: Use `../../../../script.js` to reach ST's script.js
- From `core/*.js`: Use `../../../../../script.js` (one more level up)
- TunnelVision extension confirms this pattern works

### CSRF Token Access
- **CORRECT METHOD**: Import `getRequestHeaders` from script.js
- ST exports this function: `export function getRequestHeaders({ omitContentType = false } = {})`
- Returns headers with CSRF token: `{ 'Content-Type': 'application/json', 'X-CSRF-Token': token }`
- **DO NOT** try to access via `window.getRequestHeaders` - doesn't work in module scope

### Z-Index Strategy in SillyTavern
From ST's style.css:
- `z-index: 29999` - ST's popup/modal overlays
- `z-index: 3000-3005` - Left nav panel and UI elements
- `z-index: 30` - Regular content

**Current CharCardStudio values**:
- Studio overlay: 29900 (below ST modals)
- Settings modal: 30000 (above ST modals)
- Minimize bar: 29998 (below modals, above studio)

**ISSUE**: Settings modal at 30000 might work, but need to verify it's actually rendering

## Failed Attempts

### Attempt 1: Global window.getRequestHeaders()
```javascript
function getHeaders() {
    if (typeof window.getRequestHeaders === 'function') {
        return window.getRequestHeaders();
    }
    // ...fallbacks
}
```
**FAILED**: `window.getRequestHeaders` is undefined in module scope

### Attempt 2: Wrong import path
```javascript
import { getRequestHeaders } from '../../../../script.js';
```
**FAILED**: Extension failed to load with `[object Event]` error
**REASON**: Used path from index.js, but file was in core/ subdirectory

### Attempt 3: Correct import path
```javascript
import { getRequestHeaders } from '../../../../../script.js';
```
**STATUS**: Currently testing - should work based on folder structure

## Working Extensions to Study
1. TunnelVision - Uses imports from `../../../../script.js` successfully
2. WorldInfoInfo - Uses ES6 imports, handles world info saves
3. MemoryBooks - Referenced in CharCardStudio's own code as "proven pattern"

## Current Status

### Bug #3 (403 Save Errors)
- **Fix Applied**: Added proper import of `getRequestHeaders`
- **Confidence**: HIGH - This should work
- **Next**: User needs to restart ST and test

### Bug #1 (Settings Modal)
- **Fix Applied**: Changed z-index to 30000
- **Confidence**: MEDIUM - Modal should render but might need debugging
- **Possible Issues**:
  - CSS might not be loading
  - Modal element might not be created properly
  - Event handler might not be firing
- **Next**: Need to check if modal element exists in DOM

### Bug #2 (Minimize)
- **Fix Applied**: Changed z-index to 29998
- **Confidence**: MEDIUM - Same concerns as settings modal
- **Next**: Verify minimize bar actually appears in DOM

## Next Steps
1. ✅ Fixed import path to `../../../../../script.js`
2. ✅ Changed fetch calls to use `getRequestHeaders()`
3. ⏳ Wait for user to restart ST and test
4. ⏳ If modal still doesn't appear: Debug DOM creation and CSS
5. ⏳ If minimize still doesn't work: Check event handlers

## Testing Checklist
- [ ] Extension loads without errors
- [ ] Can open studio with `/studio` command
- [ ] Settings button exists and is clickable
- [ ] Settings modal appears when clicked
- [ ] Minimize button exists and is clickable
- [ ] Minimize bar appears at bottom
- [ ] Can restore from minimize bar
- [ ] Can edit field and save
- [ ] No 403 error in console
- [ ] Toast shows "Saved [field name]"

## Notes for Next Session
- If settings modal still doesn't appear: Check browser DevTools Elements tab for `.ccs-settings-modal` element
- If element exists but not visible: Check computed z-index in DevTools
- If element doesn't exist: Debug _build() method in settings-modal.js
- Consider adding console.log statements to track execution flow
