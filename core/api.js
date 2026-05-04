// core/api.js
// Two-tier API manager: Primary (generation) + Utility (fast background calls)

import { memoryManager } from './memory.js';

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
            throw new Error('generateRaw not available — check ST version (requires 1.12+)');
        }

        const settings = memoryManager.getGlobalSettings();

        // Profile mode: temporarily switch profile
        if (settings.apiMode === 'profile' && settings.selectedProfile) {
            return this.withProfile(settings.selectedProfile, () =>
                generateRaw(prompt, undefined, false, false, systemPrompt, signal)
            );
        }

        return generateRaw(prompt, undefined, false, false, systemPrompt, signal);
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

        try {
            const response = await fetch(`${settings.utilityEndpoint}/chat/completions`, {
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
                throw new Error(`Utility API error: ${response.statusText}`);
            }

            const data = await response.json();
            return data.choices?.[0]?.message?.content || '';
        } catch (err) {
            console.warn('[CCS] Utility API failed, falling back to primary:', err);
            return this.generatePrimary(systemPrompt, prompt, null);
        }
    }

    // ── parallel generation — fires N primary calls simultaneously ──────────

    async generateParallel(requests) {
        const promises = requests.map(req =>
            this.generatePrimary(req.systemPrompt, req.userPrompt, null)
                .catch(err => `[Generation failed: ${err.message}]`)
        );
        return Promise.all(promises);
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
