/**
 * Centralized SillyTavern Context Accessor
 * Extracted to break circular dependencies between tools, app, and index.
 */
export function getCtx() {
    return window.SillyTavern?.getContext?.() ?? null;
}
