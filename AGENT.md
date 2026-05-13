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

### Bug #1 (Settings Modal - 412 x 0) - 🔧 SHOULD BE FIXED NOW
- **Root Cause #1**: Modal had no minimum height, collapsed to 0px
- **Root Cause #2**: Multiple duplicate CSS definitions (lines 535, 983, 1125) with inconsistent values
- **Root Cause #3**: Z-index using extreme value (2147483647) instead of ST-compatible value (30000)
- **Fix Applied**: 
  - Added `min-height: 500px !important` to `.ccs-modal` (all 3 locations)
  - Changed z-index from 2147483647 to 30000 (all locations including mobile media query)
  - Added !important to force override any inline styles
- **Confidence**: HIGH - CSS should now properly apply
- **Status**: Ready to test after browser refresh

### Bug #2 (Minimize Bar - Not Displaying Properly) - 🔧 SHOULD BE FIXED NOW
- **Root Cause #1**: Inline styles conflicting with CSS positioning
- **Root Cause #2**: CSS used `left: 50%; transform: translateX(-50%)` (centering) but inline had `left: 0; right: 0`
- **Root Cause #3**: Transform conflict causing layout issues
- **Fix Applied**:
  - Simplified inline styles to only override positioning: `left: 0; right: 0; transform: none; max-width: 100%`
  - Updated CSS to use full-width layout (`left: 0; right: 0; width: 100%`) instead of centering
  - Changed `display: ''` to `display: 'flex'` explicitly
  - Removed transform from CSS positioning, only used in animation
- **Confidence**: HIGH - No more style conflicts
- **Status**: Ready to test after browser refresh

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
