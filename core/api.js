// core/api.js
// Two-tier API manager: Primary (generation) + Utility (fast background calls)
// FIX: Added CCSApiError, classifyApiError, parallel toggle support

import { memoryManager } from './memory.js';
import { statsManager } from './stats.js';
import { toastManager } from '../ui/toast.js';

// ── Typed API error class ───────────────────────────────────────────────────
export class CCSApiError extends Error {
    constructor(message, { errorType = 'unknown', retryable = false, userMessage = '', statusCode = 0 } = {}) {
        super(message);
        this.name = 'CCSApiError';
        this.errorType = errorType;       // 'rate_limit' | 'balance' | 'auth' | 'server' | 'network' | 'aborted' | 'unknown'
        this.retryable = retryable;
        this.userMessage = userMessage || message;
        this.statusCode = statusCode;
    }
}

/**
 * Classify an HTTP response or error into a CCSApiError.
 * Works for both fetch Response objects and raw Error objects.
 */
export function classifyApiError(err, context = 'API call') {
    // Already classified
    if (err instanceof CCSApiError) return err;

    // Abort
    if (err?.name === 'AbortError') {
        return new CCSApiError('Generation aborted', {
            errorType: 'aborted', retryable: false,
            userMessage: '⏹ Generation stopped.',
        });
    }

    // HTTP Response object (from fetch)
    if (err?.status || err?.statusCode) {
        const status = err.status || err.statusCode;
        const statusText = err.statusText || err.message || '';

        if (status === 429) {
            return new CCSApiError(`Rate limited (429): ${statusText}`, {
                errorType: 'rate_limit', retryable: true, statusCode: 429,
                userMessage: '⚠️ Rate limited — too many requests. Wait a moment and try again.',
            });
        }
        if (status === 402) {
            return new CCSApiError(`Insufficient balance (402): ${statusText}`, {
                errorType: 'balance', retryable: false, statusCode: 402,
                userMessage: '⚠️ Insufficient API balance. Check your account credits.',
            });
        }
        if (status === 401 || status === 403) {
            return new CCSApiError(`Auth error (${status}): ${statusText}`, {
                errorType: 'auth', retryable: false, statusCode: status,
                userMessage: '⚠️ API authentication failed. Check your API key.',
            });
        }
        if (status >= 500) {
            return new CCSApiError(`Server error (${status}): ${statusText}`, {
                errorType: 'server', retryable: true, statusCode: status,
                userMessage: '⚠️ API server error. The service may be temporarily unavailable.',
            });
        }
        return new CCSApiError(`HTTP ${status}: ${statusText}`, {
            errorType: 'unknown', retryable: false, statusCode: status,
            userMessage: `⚠️ ${context} failed (HTTP ${status}).`,
        });
    }

    // BUG-024 FIX: Detect CORS and timeout errors before the generic network check
    const msg = err?.message || String(err); // define msg before use
    if (/cors/i.test(msg)) {
        return new CCSApiError(`CORS error: ${msg}`, {
            errorType: 'network', retryable: false,
            userMessage: '⚠️ CORS blocked — check your API endpoint URL and that the server allows cross-origin requests.',
        });
    }
    if (/timeout|timed out/i.test(msg)) {
        return new CCSApiError(`Timeout: ${msg}`, {
            errorType: 'network', retryable: true,
            userMessage: '⚠️ Request timed out — the API server may be overloaded. Try again.',
        });
    }
    // Detect HTML error pages returned instead of JSON (Cloudflare, nginx, etc.)
    if (/unexpected token|<!doctype|<html/i.test(msg)) {
        return new CCSApiError(`Non-JSON response: ${msg}`, {
            errorType: 'server', retryable: false,
            userMessage: '⚠️ API returned an HTML error page instead of JSON — check your endpoint URL.',
        });
    }

    // Network / generic errors
    const networkMsg = msg; // already extracted above
    if (/network|fetch|failed to fetch|econnrefused/i.test(networkMsg)) {
        return new CCSApiError(`Network error: ${networkMsg}`, {
            errorType: 'network', retryable: true,
            userMessage: '⚠️ Network error — check your connection and API status.',
        });
    }
    if (/rate|limit|429|too many/i.test(networkMsg)) {
        return new CCSApiError(`Rate limit detected: ${networkMsg}`, {
            errorType: 'rate_limit', retryable: true,
            userMessage: '⚠️ Rate limited — too many requests. Wait a moment and try again.',
        });
    }
    if (/balance|credit|quota|402|insufficient/i.test(networkMsg)) {
        return new CCSApiError(`Balance error: ${networkMsg}`, {
            errorType: 'balance', retryable: false,
            userMessage: '⚠️ Insufficient API balance. Check your account credits.',
        });
    }
    if (/auth|401|403|key|unauthorized|forbidden/i.test(networkMsg)) {
        return new CCSApiError(`Auth error: ${networkMsg}`, {
            errorType: 'auth', retryable: false,
            userMessage: '⚠️ API authentication failed. Check your API key.',
        });
    }

    return new CCSApiError(msg, {
        errorType: 'unknown', retryable: false,
        userMessage: `⚠️ ${context} failed: ${msg.substring(0, 120)}`,
    });
}

// ── Retry with exponential backoff ─────────────────────────────────────────────────
/**
 * Retries an async fn up to maxAttempts times with exponential backoff.
 * Only retries on retryable CCSApiErrors (rate_limit, server, network).
 * Abort signals are respected — AbortError is never retried.
 */
async function retryWithBackoff(fn, maxAttempts = 3) {
    for (let i = 0; i < maxAttempts; i++) {
        try {
            return await fn();
        } catch (err) {
            const classified = err instanceof CCSApiError ? err : classifyApiError(err, 'retried call');
            const isLast = i === maxAttempts - 1;
            if (isLast || !classified.retryable || classified.errorType === 'aborted') throw classified;
            const delayMs = Math.min(1000 * Math.pow(2, i), 30000); // 1s → 2s → 4s…
            console.warn(`[CCS] API ${classified.errorType}, retrying in ${delayMs}ms (attempt ${i + 1}/${maxAttempts - 1})…`);
            await new Promise(r => setTimeout(r, delayMs));
        }
    }
}

export class ApiManager {
    constructor() {
        this._previousProfile = null;
        // BUG-022 FIX: Shared flag — set on first 429/balance error, prevents
        // further requests from firing in the same parallel or sequential batch.
        this.rateLimitHit = false;
    }

    // Clear the flag at the start of each new user-initiated action
    clearRateLimitFlag() { this.rateLimitHit = false; }

    // ── Profile management ──────────────────────────────────────────────────

    async getProfiles() {
        try {
            const r = await fetch('/api/profiles/list', { method: 'GET' });
            if (!r.ok) return [];
            const d = await r.json();
            return d.profiles || [];
        } catch { return []; }
    }

    async withProfile(profileName, fn) {
        const settings = memoryManager.getGlobalSettings();
        if (settings.apiMode !== 'profile' || !profileName) return fn();
        try {
            const current = await this._getCurrentProfile();
            await this._switchProfile(profileName);
            const result = await fn();
            if (current) await this._switchProfile(current).catch(() => {});
            return result;
        } catch (err) {
            console.error('[CCS] Profile switch error:', err);
            throw err;
        }
    }

    async _getCurrentProfile() {
        try {
            const r = await fetch('/api/profiles/current', { method: 'GET' });
            if (!r.ok) return null;
            const d = await r.json();
            return d.name || null;
        } catch { return null; }
    }

    async _switchProfile(name) {
        const r = await fetch('/api/profiles/apply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
        });
        if (!r.ok) throw new Error(`Failed to switch profile to "${name}"`);
    }

    // ── generateRaw wrapper — PRIMARY calls ─────────────────────────────────
    // ST's generateRaw signature: generateRaw(prompt, api, instructOverride, quietToConsole, systemPrompt, signal)
    // Returns a string (full response, not streaming)

    async generatePrimary(systemPrompt, prompt, signal = null) {
        const context = SillyTavern.getContext();
        const { generateRaw } = context;

        if (typeof generateRaw !== 'function') {
            throw new CCSApiError('generateRaw not available — check ST version (requires 1.12+)', {
                errorType: 'unknown', retryable: false,
                userMessage: '⚠️ SillyTavern 1.12+ required. Please update SillyTavern.',
            });
        }

        const settings = memoryManager.getGlobalSettings();

        try {
            const result = await retryWithBackoff(() => {
                if (settings.apiMode === 'profile' && settings.selectedProfile) {
                    return this.withProfile(settings.selectedProfile, () =>
                        generateRaw(prompt, undefined, false, false, systemPrompt, signal)
                    );
                }
                return generateRaw(prompt, undefined, false, false, systemPrompt, signal);
            });

            // Estimate tokens (approx 4 chars per token)
            const inputChars = (systemPrompt?.length || 0) + (prompt?.length || 0);
            const outputChars = result?.length || 0;
            statsManager.record('tokensIn', Math.round(inputChars / 4));
            statsManager.record('tokensOut', Math.round(outputChars / 4));

            return result;
        } catch (err) {
            throw classifyApiError(err, 'Generation');
        }
    }

    // ── generateRaw wrapper — UTILITY calls ─────────────────────────────────
    // Utility calls are for fast, cheap background tasks (pillar detection, conflict check, etc.)
    // Falls back to primary if utility is set to 'same'

    async generateUtility(systemPrompt, prompt) {
        const settings = memoryManager.getGlobalSettings();

        // If utility is set to 'same' as primary, just use primary
        if (settings.utilityApiMode !== 'custom') {
            return this.generatePrimary(systemPrompt, prompt, null);
        }

        // Custom utility endpoint (OpenAI-compatible)
        if (!settings.utilityEndpoint) {
            console.warn('[CCS] Utility endpoint not configured, falling back to primary');
            return this.generatePrimary(systemPrompt, prompt, null);
        }

        let response;
        try {
            response = await fetch(`${settings.utilityEndpoint}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${settings.utilityApiKey || ''}`,
                },
                body: JSON.stringify({
                    model: settings.utilityModel || 'gpt-4o-mini',
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: prompt },
                    ],
                    max_tokens: 512,
                    temperature: 0.3,
                }),
            });

            if (!response.ok) {
                // Classify the HTTP error
                throw classifyApiError(response, 'Utility API');
            }

            const data = await response.json();
            return data.choices?.[0]?.message?.content || '';
        } catch (err) {
            const classified = classifyApiError(err, 'Utility API');
            if (classified instanceof CCSApiError) {
                if (!classified.retryable) {
                    // BUG-023 FIX: Show a non-intrusive toast so user knows background check failed
                    toastManager.show('⚠️ Background check failed — using offline mode', 'warn');
                    console.warn('[CCS] Utility API failed (non-retryable), falling back to primary:', classified.userMessage);
                    return this.generatePrimary(systemPrompt, prompt, null);
                }
                throw classified;
            }
            toastManager.show('⚠️ Background check failed — using offline mode', 'warn');
            console.warn('[CCS] Utility API failed, falling back to primary:', err);
            return this.generatePrimary(systemPrompt, prompt, null);
        }
    }

    // ── parallel generation — fires N primary calls simultaneously or sequentially ──

    async generateParallel(requests) {
        const settings = memoryManager.getGlobalSettings();
        const parallelEnabled = settings.parallelApiCalls !== false;

        // BUG-022 FIX: Reset the rate-limit flag at the start of each new batch
        this.rateLimitHit = false;

        if (parallelEnabled) {
            // Parallel mode — fire all at once but propagate rate-limit errors immediately
            const promises = requests.map(req =>
                this.generatePrimary(req.systemPrompt, req.userPrompt, null)
                    .catch(err => {
                        const classified = classifyApiError(err, 'Parallel generation');
                        if (classified.errorType === 'rate_limit' || classified.errorType === 'balance') {
                            // BUG-022: Set flag so sequential fallback and any future calls
                            // can check it. Promise.all already aborts on throw.
                            this.rateLimitHit = true;
                            throw classified;
                        }
                        return `[Generation failed: ${classified.userMessage}]`;
                    })
            );
            return Promise.all(promises);
        } else {
            // Sequential mode — check flag before each request so we stop immediately
            const results = [];
            for (const req of requests) {
                if (this.rateLimitHit) {
                    results.push('[Skipped: rate limit active]');
                    continue;
                }
                try {
                    const result = await this.generatePrimary(req.systemPrompt, req.userPrompt, null);
                    results.push(result);
                } catch (err) {
                    const classified = classifyApiError(err, 'Sequential generation');
                    if (classified.errorType === 'rate_limit' || classified.errorType === 'balance') {
                        this.rateLimitHit = true;
                        throw classified;
                    }
                    results.push(`[Generation failed: ${classified.userMessage}]`);
                }
            }
            return results;
        }
    }

    // ── API support check ───────────────────────────────────────────────────

    checkApiSupport() {
        const context = SillyTavern.getContext();
        return {
            generateRaw: typeof context.generateRaw === 'function',
            isConnected: context.online_status !== 'no_connection',
            apiType: context.main_api || 'unknown',
        };
    }

    getApiModeLabel() {
        const s = memoryManager.getGlobalSettings();
        switch (s.apiMode) {
            case 'current': return '🔗 ST Current';
            case 'profile': return `👤 ${s.selectedProfile || 'No profile'}`;
            case 'custom': return `⚙️ ${s.customModel || 'Custom'}`;
            default: return '🔗 ST Current';
        }
    }

    getUtilityLabel() {
        const s = memoryManager.getGlobalSettings();
        if (s.utilityApiMode === 'same') return '↳ Same as primary';
        return `↳ Custom: ${s.utilityModel || s.utilityEndpoint || 'Not set'}`;
    }
}

export const apiManager = new ApiManager();
