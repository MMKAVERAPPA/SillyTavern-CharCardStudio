/**
 * CharCardStudio v4.1.0 — core/api-router.js
 *
 * Routes background/utility API calls to a configurable alternate ST connection
 * profile. Uses ConnectionManagerRequestService (ST-Copilot pattern) when the
 * profile is set and the service is available, otherwise falls back to the
 * standard generateText() so the extension always works.
 *
 * Extension settings are stored in ctx.extensionSettings['CharCardStudio']
 * and persisted via ctx.saveSettingsDebounced().
 */

import { generateText } from './silent-generation.js';

// ─── Extension Settings ───────────────────────────────────────────────────────

const EXT_NAME = 'CharCardStudio';

function _extSettings() {
    const ctx = SillyTavern?.getContext?.();
    if (!ctx) return {};
    if (!ctx.extensionSettings[EXT_NAME]) ctx.extensionSettings[EXT_NAME] = {};
    return ctx.extensionSettings[EXT_NAME];
}

function _saveExtSettings() {
    SillyTavern?.getContext?.()?.saveSettingsDebounced?.();
}

// ─── Public: Profile Management ───────────────────────────────────────────────

/**
 * Return all available ST connection profiles for the settings dropdown.
 * Source: ctx.extensionSettings.connectionManager.profiles (ST-Copilot confirmed pattern).
 * @returns {Array<{id: string, name: string}>}
 */
export function getAvailableProfiles() {
    const ctx = SillyTavern?.getContext?.();
    const profiles = ctx?.extensionSettings?.connectionManager?.profiles;
    if (!Array.isArray(profiles)) return [];
    return profiles.map(p => ({ id: p.id || p.name, name: p.name || p.id }));
}

/**
 * Get the currently selected utility API profile ID.
 * @returns {string|null}
 */
export function getUtilityProfileId() {
    return _extSettings().utilityApiProfileId ?? null;
}

/**
 * Persist the selected utility API profile ID.
 * Pass null or empty string to revert to the default connection.
 * @param {string|null} profileId
 */
export function setUtilityProfileId(profileId) {
    _extSettings().utilityApiProfileId = profileId || null;
    _saveExtSettings();
    console.log(`[CCS] Utility API profile set to: ${profileId || 'default'}`);
}

// ─── Public: Routed Generation ────────────────────────────────────────────────

/**
 * Generate text using the utility API profile when configured.
 * Falls back silently to the default generateText() on any failure or when
 * no profile is selected.
 *
 * @param {Array<{role:string, content:string}>} messages
 * @param {Object} [opts]
 * @param {AbortSignal} [opts.signal]
 * @param {string}      [opts.name]       - Label for logging
 * @param {number}      [opts.maxTokens]  - Max tokens for utility calls (default 500)
 * @returns {Promise<string>}
 */
export async function generateTextWithProfile(messages, opts = {}) {
    const profileId = getUtilityProfileId();

    if (profileId) {
        const ctx = SillyTavern?.getContext?.();
        const service = ctx?.ConnectionManagerRequestService;

        if (service && typeof service.sendRequest === 'function') {
            try {
                const maxTokens = opts.maxTokens ?? 500;
                const gen = await service.sendRequest(profileId, messages, maxTokens, {
                    stream: false,
                    signal: opts.signal ?? null,
                });

                // Handle non-streaming: direct value
                if (typeof gen === 'string') return gen.trim();
                if (gen?.text) return gen.text.trim();
                if (gen?.content) return gen.content.trim();
                if (gen?.message?.content) return gen.message.content.trim();

                // Handle streaming: async generator
                const isGenerator = (
                    typeof gen === 'function' ||
                    (gen != null && typeof gen[Symbol.asyncIterator] === 'function') ||
                    (gen != null && typeof gen.next === 'function')
                );

                let text = '';
                if (isGenerator) {
                    const generator = typeof gen === 'function' ? gen() : gen;
                    for await (const chunk of generator) {
                        if (opts.signal?.aborted) break;
                        // Handle different chunk shapes (OpenAI, Claude, raw string)
                        if (typeof chunk === 'string') {
                            text += chunk;
                        } else if (chunk?.text) {
                            text += chunk.text;
                        } else if (chunk?.choices?.[0]?.delta?.content) {
                            text += chunk.choices[0].delta.content;
                        } else if (chunk?.choices?.[0]?.message?.content) {
                            text += chunk.choices[0].message.content;
                        }
                    }
                } else {
                    console.warn('[CCS] Unexpected utility API return type:', typeof gen);
                    return String(gen ?? '').trim();
                }

                if (text.trim()) {
                    console.log(`[CCS] Utility API (profile: ${profileId}) success for "${opts.name || 'request'}"`);
                    return text.trim();
                }
                // Empty response — fall through to default
            } catch (err) {
                if (err.name === 'AbortError') throw err; // Propagate abort
                // Any other error: log and fall back gracefully
                console.warn(`[CCS] Utility API profile "${profileId}" failed, using default:`, err.message);
            }
        } else {
            console.warn('[CCS] ConnectionManagerRequestService not available — using default generation');
        }
    }

    // Default: standard ST generation
    return generateText(messages, opts);
}
