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

### Character Save Pattern - CRITICAL LEARNING (CORRECTED)
- **WRONG #1**: Don't make direct API calls to `/api/characters/save` (doesn't exist)
- **WRONG #2**: Don't call `/api/characters/edit` (wrong endpoint)
- **WRONG #3**: Don't try to click `$('#create_button')` from extension code (unreliable)
- **CORRECT**: Use `/api/characters/merge-attributes` endpoint
- **Pattern** (from sillytavern-utils-lib):
  1. Build update payload with `avatar` (filename) + fields to update
  2. POST to `/api/characters/merge-attributes` with CSRF headers
  3. Handle response and update local character object
  4. Optionally call `getCharacters()` to refresh UI
- **Example**:
  ```javascript
  const updateData = {
    avatar: char.avatar, // Required: character filename
    name: 'New Name',
    data: {
      name: 'New Name',
      description: 'New description'
    }
  };
  const response = await fetch('/api/characters/merge-attributes', {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify(updateData),
    cache: 'no-cache'
  });
  ```
- **Why**: This merges attributes into existing character without needing FormData or file uploads
- **Source**: Character Creator extension by bmen25124 uses sillytavern-utils-lib which uses this pattern

### `isolation: isolate` Breaks `position: fixed` - CRITICAL BUG
- **Problem**: `.ccs-studio-overlay` had `isolation: isolate` in CSS
- **Effect**: Creates a new containing block for `position: fixed` descendants
- **Result**: `position: fixed` elements are positioned relative to the isolating parent, NOT the viewport
- **Symptoms**:
  - Modal appeared in tiny header area instead of full-screen
  - Minimize bar existed but wasn't visible
  - Z-index was correct but element was still clipped
- **Solution**: Remove `isolation: isolate` from parent elements
- **Alternative**: Append modal/bar OUTSIDE the isolating parent (which we already do, but `isolation` still affects it)
- **CSS properties that create containing blocks for position:fixed**:
  - `transform` (any value except `none`)
  - `perspective` (any value except `none`)
  - `filter` (any value except `none`)
  - `backdrop-filter` (any value except `none`)
  - `will-change: transform | perspective | filter | backdrop-filter`
  - **`isolation: isolate`** ← This was the culprit
  - `contain: layout | paint | strict`
  - `-webkit-transform` / `-webkit-perspective` / etc.

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
**SUCCESS**: Import works correctly

### Attempt 4: Direct API call to `/api/characters/save`
```javascript
fetch('/api/characters/save', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify(payload) })
```
**FAILED**: 404 Not Found
**REASON**: Endpoint doesn't exist

### Attempt 5: Direct API call to `/api/characters/edit`
```javascript
fetch('/api/characters/edit', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify(payload) })
```
**FAILED**: Still 404 Not Found
**REASON**: Wrong endpoint - this is for editing character metadata, not saving fields

### Attempt 6: Modify character + trigger save button
```javascript
this._updateLocalChar(char, fieldName, value);
$('#create_button').trigger('click');
```
**FAILED**: Says "saved" but nothing actually happens
**REASON**: Third-party extensions can't reliably trigger ST's internal save flow

### Attempt 7: Use `/api/characters/merge-attributes` ✅
```javascript
const updateData = { avatar: char.avatar, [fieldName]: value, data: { [fieldName]: value } };
fetch('/api/characters/merge-attributes', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify(updateData) })
```
**SUCCESS**: This is the correct endpoint used by working extensions (Character Creator)

## Working Extensions to Study
1. **Character Creator** by bmen25124 - Uses `/api/characters/merge-attributes` via sillytavern-utils-lib
2. **WorldInfo Recommender** by bmen25124 - Also uses sillytavern-utils-lib patterns
3. **sillytavern-utils-lib** - Utility library that provides `saveCharacter()` function
   - Uses `/api/characters/merge-attributes` endpoint
   - Requires `avatar` (filename) + partial character data
   - Source: https://github.com/bmen25124/sillytavern-utils-lib/blob/main/src/character-utils.ts

**Key Insight**: Both extensions use React + TypeScript + sillytavern-utils-lib, but the core pattern (merge-attributes endpoint) works in vanilla JS too.

## Current Status

### Bug #3 (Save Errors) - ✅ FIXED
- **Root Cause**: Was using wrong endpoints (`/api/characters/save`, `/api/characters/edit`)
- **Fix Applied**: Refactored to use `/api/characters/merge-attributes` endpoint
- **Pattern**: Send avatar filename + fields to update → API merges into existing character
- **Status**: WORKING - User confirmed saves work now

### Bug #1 (Settings Modal - 412 x 0) - ☢️ SUPER NUCLEAR FIX APPLIED
- **Root Cause FOUND**: `.ccs-studio-overlay` had `isolation: isolate` which **breaks position:fixed**!
- **How it breaks**: When a parent has `isolation: isolate`, `position: fixed` children are positioned relative to THAT element, not the viewport
- **Evidence**: Debug showed modal had correct z-index/position, but was clipped to tiny header area
- **Fix Applied**:
  1. Removed `isolation: isolate` from `.ccs-studio-overlay` in CSS
  2. Kept nuclear inline styles in JavaScript (belt-and-suspenders)
  3. Modal now appends to `document.body` with full viewport coverage
- **Why it failed before**: Even with z-index 2147483647, `isolation: isolate` on parent created containing block
- **Status**: Should be FIXED - test after restart

### Bug #2 (Minimize Bar - Not Displaying Properly) - ☢️ SUPER NUCLEAR FIX APPLIED
- **Root Cause**: Same as modal - affected by parent's `isolation: isolate`
- **Evidence**: Debug showed bar exists with correct styles (display:flex, position:fixed, bottom:0, z-index:2147483646) but not visible
- **Fix Applied**:
  1. Removed `isolation: isolate` from `.ccs-studio-overlay` in CSS
  2. Kept nuclear inline styles in JavaScript
  3. Bar should now be visible at viewport bottom
- **Additional fix**: Super nuclear script also:
  - Verifies element is direct child of `document.body`
  - Forces `isolation: auto` inline
  - Uses `100vw` instead of `100%` for width
  - Adds bright blue border for visibility
- **Status**: Should be FIXED - test after restart

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

---

## Session 2 — Mobile-Specific Fixes (2026-05-13)

### NEW CRITICAL LEARNING: position:fixed Containment on Mobile

**Problem**: `position: fixed; inset: 0` on elements appended to `document.body` breaks on mobile
when SillyTavern's page-level elements (left nav panel, wand menu) have active CSS transforms.
Any CSS `transform` on an ancestor creates a new "containing block" for `position: fixed` descendants,
causing them to be positioned relative to the transformed element instead of the viewport.

**This affects any element appended to document.body AFTER ST's DOM is animated**, including:
- Settings modal (`#ccs-settings-modal`)
- Minimize restore bar (`.ccs-min-bar`)

**Symptoms on mobile**:
- Settings modal appears inside the studio header bar area, not full-screen
- Minimize bar doesn't appear at viewport bottom at all

**THE CORRECT PATTERN** for all CCS overlay children:
1. The studio overlay itself (`#ccs-studio`) is appended to `document.body` once, BEFORE any animations — this works reliably.
2. ALL elements that need to cover the viewport should be `position: absolute; inset: 0` INSIDE the studio overlay.
3. The studio overlay is `position: fixed; inset: 0` — its absolute children inherit the same full-viewport frame with zero stacking context risk.
4. **Never** append new `position: fixed` elements to `document.body` from within the extension.

### Bug #1 (Settings Modal - Mobile) — ✅ FIXED
- **Root Cause**: `open()` ignored the `container` param and always used `document.body` + `position:fixed`
- **Fix**: Use passed `container` (studio overlay element); CSS handles `position:absolute` via scoped rule
- **Files**: `ui/settings-modal.js` (open method), `style.css` (new .ccs-studio-overlay .ccs-modal-overlay rule)

### Bug #2 (Minimize Bar - Mobile) — ✅ FIXED
- **Root Cause**: `minimize()` used `display:none` on overlay (orphaning the bar) + appended bar to `document.body` with `position:fixed`
- **Fix**: Add/remove `ccs-minimized` CSS class instead of display:none; append bar to `this.el` (inside overlay)
- **Files**: `ui/popup.js` (minimize/restore methods), `style.css` (.ccs-min-bar position, new .ccs-minimized rules)

### CSS Properties Created for These Fixes
```css
/* Settings modal inside overlay */
.ccs-studio-overlay .ccs-modal-overlay { position: absolute; z-index: 100; }

/* Minimized state */
.ccs-studio-overlay.ccs-minimized { background: transparent; pointer-events: none; }
.ccs-studio-overlay.ccs-minimized .ccs-studio-inner { display: none; }
.ccs-studio-overlay.ccs-minimized .ccs-min-bar { pointer-events: auto; }

/* Min bar — was position:fixed, now position:absolute */
.ccs-min-bar { position: absolute; bottom: 0; left: 0; right: 0; z-index: 50; }
```
