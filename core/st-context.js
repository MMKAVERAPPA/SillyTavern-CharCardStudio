/**
 * CharCardStudio v5.0.0 — core/st-context.js
 *
 * Tiny zero-dependency wrapper around the SillyTavern global context.
 *
 * WHY THIS FILE EXISTS (Bug E — circular import fix):
 * The circular chain  tools.js → index.js → app.js → tools.js  caused
 * partially-evaluated modules when the bundle was first loaded, making
 * getCtx() potentially undefined at call time in tools.js.
 *
 * By extracting getCtx() here (no imports at all), every module that
 * needs the ST context can import from this single, leaf-node file with
 * no risk of a circular dependency.
 */

/**
 * Return the live SillyTavern context object, or null if not available.
 * Safe to call at any time — never throws.
 * @returns {object|null}
 */
export function getCtx() {
    return SillyTavern?.getContext?.() ?? null;
}
