/**
 * CharCardStudio v4.0.0 — Silent Generation Module
 *
 * Cancellable, abort-aware generation wrapper for all AI calls.
 * Supports two generation paths:
 *   1. generateRaw() — text/chat completion via ST's main API
 *   2. ConnectionManagerRequestService — chat completion via specific connection profile
 *
 * All generation jobs are tracked in an active jobs map. Any job can be
 * cancelled individually or all at once. The cancel button in the UI
 * calls cancelAllGenerations().
 *
 * Inspired by Saints-Silly-Extensions' silent-generation pattern.
 */

// ─── Module State ─────────────────────────────────────────────────────────────

/** @type {Map<string, { controller: AbortController, name: string, startedAt: number }>} */
const activeJobs = new Map();
let nextJobId = 1;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Get SillyTavern context safely.
 * @returns {object} ST context
 * @throws {Error} If context unavailable
 */
function getSTContext() {
    const ctx = SillyTavern?.getContext?.();
    if (!ctx) throw new Error('[CCS] SillyTavern context not available');
    return ctx;
}

/**
 * Check if an error is an abort/cancel error.
 * @param {Error} err
 * @returns {boolean}
 */
export function isAbortError(err) {
    if (!err) return false;
    if (err.name === 'AbortError') return true;
    if (err.message?.includes('Cancelled') || err.message?.includes('aborted')) return true;
    return false;
}

/**
 * Create a unique job ID.
 * @param {string} [name]
 * @returns {string}
 */
function createJobId(name) {
    return `job_${name || 'gen'}_${nextJobId++}`;
}

// ─── Core Generation Functions ────────────────────────────────────────────────

/**
 * Generate text using ST's generateRaw API.
 *
 * This is the primary generation method. It uses whatever API the user
 * has configured in ST (OpenAI, Claude, local, etc.).
 *
 * @param {string|Array} prompt - Text prompt string OR array of chat-style messages
 *   [{role: 'system', content: '...'}, {role: 'user', content: '...'}]
 * @param {object} [options]
 * @param {string} [options.name] - Human-readable name for this job (for debugging)
 * @param {number} [options.maxTokens] - Override response length
 * @param {string} [options.systemPrompt] - System prompt (for text completion APIs)
 * @param {string} [options.prefill] - Assistant prefill text
 * @param {object} [options.jsonSchema] - JSON schema for structured output
 * @param {AbortSignal} [options.signal] - External abort signal to chain
 * @returns {Promise<string>} Generated text
 * @throws {DOMException} AbortError if cancelled
 */
export async function generateText(prompt, options = {}) {
    const {
        name = 'generateText',
        maxTokens = null,
        systemPrompt = '',
        prefill = '',
        jsonSchema = null,
        signal = null,
    } = options;

    const jobId = createJobId(name);
    const controller = new AbortController();

    // Chain external signal if provided
    if (signal) {
        if (signal.aborted) {
            throw new DOMException('Generation aborted before start', 'AbortError');
        }
        signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
    }

    activeJobs.set(jobId, { controller, name, startedAt: Date.now() });

    try {
        const ctx = getSTContext();

        // Call ST's generateRaw with named parameters (the modern API)
        const result = await ctx.generateRaw({
            prompt,
            systemPrompt,
            responseLength: maxTokens,
            prefill,
            jsonSchema,
            signal: controller.signal,
        });

        const text = typeof result === 'string' ? result.trim() : String(result ?? '').trim();
        if (options.returnObject) return { text, reasoning: '' };
        return text;
    } catch (err) {
        if (isAbortError(err)) {
            throw new DOMException(`Generation "${name}" was cancelled`, 'AbortError');
        }
        throw err;
    } finally {
        activeJobs.delete(jobId);
    }
}

/**
 * Generate text for background/utility tasks.
 *
 * Identical to generateText() but does NOT register in activeJobs.
 * This means isGenerating() returns false while background jobs run,
 * so tab switching and other UI interactions remain unblocked.
 *
 * Use this for: conflict checks, token analysis, auto-summarization.
 * Do NOT use for the main agent loop (use generateText there).
 *
 * @param {string|Array} prompt
 * @param {object} [options] - Same as generateText options
 * @returns {Promise<string>}
 */
export async function generateTextBackground(prompt, options = {}) {
    const {
        name = 'generateTextBackground',
        maxTokens = null,
        systemPrompt = '',
        prefill = '',
        jsonSchema = null,
        signal = null,
    } = options;

    // No activeJobs registration — background tasks are invisible to isGenerating()
    const controller = new AbortController();

    if (signal) {
        if (signal.aborted) {
            throw new DOMException('Background generation aborted before start', 'AbortError');
        }
        signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
    }

    try {
        const ctx = getSTContext();
        const result = await ctx.generateRaw({
            prompt,
            systemPrompt,
            responseLength: maxTokens,
            prefill,
            jsonSchema,
        });
        return typeof result === 'string' ? result.trim() : String(result ?? '').trim();
    } catch (err) {
        if (isAbortError(err)) {
            throw new DOMException(`Background generation "${name}" was cancelled`, 'AbortError');
        }
        throw err;
    }
}


/**
 * Generate using ConnectionManagerRequestService for a specific connection profile.
 *
 * This allows using a different API (e.g., a cheap/fast model for background
 * checks) than the user's main chat API. Falls back to generateText if
 * ConnectionManagerRequestService is not available.
 *
 * @param {Array<{role: string, content: string}>} messages - Chat messages array
 * @param {object} [options]
 * @param {string} [options.name] - Human-readable name for this job
 * @param {string} [options.profileId] - Connection profile ID/name to use
 * @param {number} [options.maxTokens=1024] - Max response tokens
 * @param {boolean} [options.stream=false] - Whether to stream (currently unused)
 * @param {function} [options.onToken] - Streaming callback: fn(accumulatedText)
 * @param {AbortSignal} [options.signal] - External abort signal
 * @returns {Promise<string>} Generated text
 * @throws {DOMException} AbortError if cancelled
 */
export async function generateChat(messages, options = {}) {
    const {
        name = 'generateChat',
        profileId = null,
        maxTokens = 1024,
        stream = false,
        onToken = null,
        signal = null,
    } = options;

    const ctx = getSTContext();
    const Service = ctx.ConnectionManagerRequestService;

    // Fallback: if no ConnectionManagerRequestService, use generateRaw with messages array
    if (!Service || typeof Service.sendRequest !== 'function') {
        console.warn('[CCS] ConnectionManagerRequestService not available, falling back to generateRaw');
        return generateText(messages, { name, maxTokens, signal });
    }

    const jobId = createJobId(name);
    const controller = new AbortController();

    // Chain external signal
    if (signal) {
        if (signal.aborted) {
            throw new DOMException('Generation aborted before start', 'AbortError');
        }
        signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
    }

    activeJobs.set(jobId, { controller, name, startedAt: Date.now() });

    try {
        const result = await Service.sendRequest(profileId, messages, maxTokens, {
            stream,
            signal: controller.signal,
        });

        let rawText = '';
        let rawReasoning = '';

        // Handle non-streaming: direct value
        if (typeof result === 'string') rawText = result;
        else if (result?.text) rawText = result.text;
        else if (result?.content) rawText = result.content;
        else if (result?.message?.content) {
            rawText = result.message.content;
            if (result.message.reasoning) rawReasoning = result.message.reasoning;
        }

        if (rawText !== '' || !isGenerator(result)) {
            const text = rawText.trim();
            if (options.returnObject) return { text, reasoning: rawReasoning.trim() };
            return text;
        }

        // Handle streaming: async generator
        const isGeneratorFunc = (
            typeof result === 'function' ||
            (result != null && typeof result[Symbol.asyncIterator] === 'function') ||
            (result != null && typeof result.next === 'function')
        );

        if (isGeneratorFunc) {
            const gen = typeof result === 'function' ? result() : result;
            let text = '';

            for await (const chunk of gen) {
                // Check abort between chunks
                if (controller.signal.aborted) {
                    throw new DOMException('Generation cancelled during streaming', 'AbortError');
                }

                if (typeof chunk === 'string') {
                    text += chunk;
                } else if (chunk?.text !== undefined) {
                    text = chunk.text; // Some generators give accumulated text
                } else if (chunk?.content) {
                    text += chunk.content;
                }

                if (chunk?.reasoning !== undefined) {
                    rawReasoning += chunk.reasoning;
                } else if (chunk?.message?.reasoning) {
                    rawReasoning += chunk.message.reasoning;
                }

                if (onToken) {
                    try { onToken(text); } catch (_) { /* don't let callback errors kill generation */ }
                }
            }

            if (options.returnObject) return { text: text.trim(), reasoning: rawReasoning.trim() };
            return text.trim();
        }

        // Unknown return type — try to extract something useful
        console.warn('[CCS] Unexpected sendRequest return type:', typeof result, result);
        return String(result ?? '').trim();

    } catch (err) {
        if (isAbortError(err)) {
            throw new DOMException(`Generation "${name}" was cancelled`, 'AbortError');
        }
        throw err;
    } finally {
        activeJobs.delete(jobId);
    }
}

// ─── Cancellable Wrapper ──────────────────────────────────────────────────────

/**
 * Run any async function as a cancellable generation job.
 *
 * The `run` callback receives an AbortSignal it should pass to any
 * generation calls. If the job is cancelled, the signal aborts and
 * the promise rejects with AbortError.
 *
 * @param {object} params
 * @param {string} params.name - Human-readable job name
 * @param {function(AbortSignal): Promise<*>} params.run - Async function to execute
 * @returns {Promise<*>} Whatever `run` returns
 * @throws {DOMException} AbortError if cancelled
 */
export async function runCancellableGeneration({ name, run }) {
    const jobId = createJobId(name);
    const controller = new AbortController();

    activeJobs.set(jobId, { controller, name, startedAt: Date.now() });

    try {
        const result = await run(controller.signal);
        return result;
    } catch (err) {
        if (isAbortError(err)) {
            throw new DOMException(`Job "${name}" was cancelled`, 'AbortError');
        }
        throw err;
    } finally {
        activeJobs.delete(jobId);
    }
}

// ─── Job Management ───────────────────────────────────────────────────────────

/**
 * Cancel a specific generation job by ID.
 * @param {string} jobId
 * @returns {boolean} Whether the job existed and was cancelled
 */
export function cancelGeneration(jobId) {
    const job = activeJobs.get(jobId);
    if (!job) return false;

    console.log(`[CCS] Cancelling job: ${job.name} (${jobId})`);
    job.controller.abort(new DOMException(`Job "${job.name}" cancelled by user`, 'AbortError'));
    activeJobs.delete(jobId);
    return true;
}

/**
 * Cancel all active generation jobs.
 * @returns {number} Number of jobs cancelled
 */
export function cancelAllGenerations() {
    const count = activeJobs.size;

    console.log(`[CCS] Cancelling all ${count} active generation(s)`);
    for (const [jobId, job] of activeJobs) {
        job.controller.abort(new DOMException(`Job "${job.name}" cancelled (cancel all)`, 'AbortError'));
    }
    activeJobs.clear();

    // Fallback: invoke SillyTavern's global StopGeneration to ensure API drops
    if (typeof window.StopGeneration === 'function') {
        try { window.StopGeneration(); } catch (e) { /* ignore */ }
    }

    return count;
}

/**
 * Get list of currently active jobs.
 * @returns {Array<{id: string, name: string, startedAt: number, elapsed: number}>}
 */
export function getActiveJobs() {
    const now = Date.now();
    return Array.from(activeJobs.entries()).map(([id, job]) => ({
        id,
        name: job.name,
        startedAt: job.startedAt,
        elapsed: now - job.startedAt,
    }));
}

/**
 * Check if any generation is currently running.
 * @returns {boolean}
 */
export function isGenerating() {
    return activeJobs.size > 0;
}

/**
 * Get count of active jobs.
 * @returns {number}
 */
export function getActiveJobCount() {
    return activeJobs.size;
}
