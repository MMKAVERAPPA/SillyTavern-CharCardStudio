/**
 * CharCardStudio v4.1.0 — core/token-utils.js
 * Centralized token counting with caching and accurate ST tokenizer.
 *
 * Uses ctx.getTokenCountAsync() (model-aware tokenizer) when available,
 * falls back to char/4 estimate otherwise. Results are cached by content
 * hash to avoid redundant API calls.
 *
 * @module core/token-utils
 */

// ─── Cache ──────────────────────────────────────────────────────────────────

const _cache = new Map();
const MAX_CACHE_SIZE = 300;

/**
 * Simple FNV-1a-inspired hash for cache keys.
 * Not cryptographic — just fast and low-collision for our use case.
 * @param {string} str
 * @returns {number}
 */
function _hash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = (h * 0x01000193) >>> 0;
    }
    return h;
}

function _cacheSet(key, value) {
    // Evict oldest entries if cache grows too large
    if (_cache.size >= MAX_CACHE_SIZE) {
        const firstKey = _cache.keys().next().value;
        _cache.delete(firstKey);
    }
    _cache.set(key, value);
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Count tokens for a text string using ST's model-aware tokenizer.
 * Async — uses the real tokenizer when available, caches results.
 *
 * @param {string} text - Text to count tokens for
 * @returns {Promise<number>} Token count
 */
export async function countTokens(text) {
    if (!text) return 0;

    const key = _hash(text);
    if (_cache.has(key)) return _cache.get(key);

    // Try the real tokenizer
    try {
        const ctx = SillyTavern?.getContext?.();
        if (ctx?.getTokenCountAsync) {
            const count = await ctx.getTokenCountAsync(text);
            _cacheSet(key, count);
            return count;
        }
    } catch (_) {
        // Tokenizer unavailable — fall through to estimate
    }

    // Fallback estimate
    const estimate = Math.round(text.length / 4);
    _cacheSet(key, estimate);
    return estimate;
}

/**
 * Synchronous token count — returns cached value or char/4 estimate.
 * Use this for initial UI rendering; follow up with countTokens() for accuracy.
 *
 * @param {string} text - Text to count tokens for
 * @returns {number} Token count (cached or estimated)
 */
export function countTokensSync(text) {
    if (!text) return 0;

    const key = _hash(text);
    if (_cache.has(key)) return _cache.get(key);

    return Math.round(text.length / 4);
}

/**
 * Count tokens for multiple texts in parallel.
 * Useful for counting all card fields at once.
 *
 * @param {string[]} texts - Array of texts
 * @returns {Promise<number[]>} Array of token counts
 */
export async function countTokensBatch(texts) {
    return Promise.all(texts.map(t => countTokens(t)));
}

/**
 * Pre-warm the cache for a set of texts.
 * Call this after rendering to upgrade estimates to real counts.
 *
 * @param {Object<string, string>} fieldMap - { fieldName: content, ... }
 * @returns {Promise<Object<string, number>>} { fieldName: tokenCount, ... }
 */
export async function countTokensForFields(fieldMap) {
    const results = {};
    const promises = Object.entries(fieldMap).map(async ([name, content]) => {
        results[name] = await countTokens(content || '');
    });
    await Promise.all(promises);
    return results;
}

/**
 * Clear the token count cache. Call when the tokenizer/model changes.
 */
export function clearTokenCache() {
    _cache.clear();
}
