// core/api.js
// Two-tier API manager: Primary (generation) + Utility (fast background calls)
// FIX: Added CCSApiError, classifyApiError, parallel toggle support

import { memoryManager } from './memory.js';

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

    // Network / generic errors
    const msg = err?.message || String(err);
    if (/network|fetch|failed to fetch|econnrefused|timeout/i.test(msg)) {
        return new CCSApiError(`Network error: ${msg}`, {
            errorType: 'network', retryable: true,
            userMessage: '⚠️ Network error — check your connection and API status.',
        });
    }
    if (/rate|limit|429|too many/i.test(msg)) {
        return new CCSApiError(`Rate limit detected: ${msg}`, {
            errorType: 'rate_limit', retryable: true,
            userMessage: '⚠️ Rate limited — too many requests. Wait a moment and try again.',
        });
    }
    if (/balance|credit|quota|402|insufficient/i.test(msg)) {
        return new CCSApiError(`Balance error: ${msg}`, {
            errorType: 'balance', retryable: false,
            userMessage: '⚠️ Insufficient API balance. Check your account credits.',
        });
    }
    if (/auth|401|403|key|unauthorized|forbidden/i.test(msg)) {
        return new CCSApiError(`Auth error: ${msg}`, {
            errorType: 'auth', retryable: false,
            userMessage: '⚠️ API authentication failed. Check your API key.',
        });
    }

    return new CCSApiError(msg, {
        errorType: 'unknown', retryable: false,
        userMessage: `⚠️ ${context} failed: ${msg.substring(0, 120)}`,
    });
}

export class ApiManager {
    constructor() {
        this._previousProfile = null;
    }

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
            // Profile mode: temporarily switch profile
            if (settings.apiMode === 'profile' && settings.selectedProfile) {
                return await this.withProfile(settings.selectedProfile, () =>
                    generateRaw(prompt, undefined, false, false, systemPrompt, signal)
                );
            }

            return await generateRaw(prompt, undefined, false, false, systemPrompt, signal);
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
            if (err instanceof CCSApiError) {
                // For utility calls, non-retryable errors should fall back to primary
                if (!err.retryable) {
                    console.warn('[CCS] Utility API failed (non-retryable), falling back to primary:', err.userMessage);
                    return this.generatePrimary(systemPrompt, prompt, null);
                }
                throw err;
            }
            console.warn('[CCS] Utility API failed, falling back to primary:', err);
            return this.generatePrimary(systemPrompt, prompt, null);
        }
    }

    // ── parallel generation — fires N primary calls simultaneously or sequentially ──

    async generateParallel(requests) {
        const settings = memoryManager.getGlobalSettings();
        const parallelEnabled = settings.parallelApiCalls !== false; // default true

        if (parallelEnabled) {
            // Parallel mode (original behavior)
            const promises = requests.map(req =>
                this.generatePrimary(req.systemPrompt, req.userPrompt, null)
                    .catch(err => {
                        const classified = classifyApiError(err, 'Parallel generation');
                        // If rate-limited or balance error, throw to stop all
                        if (classified.errorType === 'rate_limit' || classified.errorType === 'balance') {
                            throw classified;
                        }
                        return `[Generation failed: ${classified.userMessage}]`;
                    })
            );
            return Promise.all(promises);
        } else {
            // Sequential mode — one at a time
            const results = [];
            for (const req of requests) {
                try {
                    const result = await this.generatePrimary(req.systemPrompt, req.userPrompt, null);
                    results.push(result);
                } catch (err) {
                    const classified = classifyApiError(err, 'Sequential generation');
                    if (classified.errorType === 'rate_limit' || classified.errorType === 'balance') {
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
