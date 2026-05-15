// core/lorebook-summarizer.js
// Handles lorebook summarization with full and partial (rate-limited) modes

import { apiManager } from './api.js';
import { memoryManager } from './memory.js';

export class LorebookSummarizer {
    constructor() {
        this.isGenerating = false;
    }

    /**
     * Summarize a lorebook (all existing + generated entries)
     * @param {string} lorebookName - Name of the lorebook
     * @param {Array} existingEntries - Existing entries from the lorebook file
     * @param {Array} generatedEntries - Newly generated entries
     * @param {Function} onProgress - Progress callback (percent, message)
     * @returns {Promise<string>} The summary text
     */
    async summarizeLorebook(lorebookName, existingEntries = [], generatedEntries = [], onProgress = null) {
        if (this.isGenerating) {
            throw new Error('Summary generation already in progress');
        }

        this.isGenerating = true;
        
        try {
            const settings = memoryManager.getGlobalSettings();
            const mode = settings.lorebookSummaryMode || 'full';
            const maxTokens = settings.lorebookSummaryMaxTokens || 500;
            
            onProgress?.(0, 'Preparing entries...');
            
            const allEntries = [...existingEntries, ...generatedEntries];
            
            if (!allEntries.length) {
                return 'This lorebook is currently empty.';
            }
            
            let summary;
            if (mode === 'full') {
                summary = await this._summarizeFull(lorebookName, allEntries, maxTokens, onProgress);
            } else {
                summary = await this._summarizePartial(lorebookName, allEntries, maxTokens, onProgress, settings);
            }
            
            onProgress?.(100, 'Summary complete!');
            return summary;
            
        } finally {
            this.isGenerating = false;
        }
    }

    /**
     * Full mode: Send all entries in one API call
     */
    async _summarizeFull(lorebookName, entries, maxTokens, onProgress) {
        onProgress?.(20, 'Analyzing entries...');
        
        const entryList = entries.map((e, idx) => {
            const keys = (e.keys || e.key || []).join(', ');
            const category = e.category || 'General';
            const title = e.comment || e.name || `Entry ${idx + 1}`;
            const content = (e.content || '').substring(0, 500); // Cap content preview
            
            return `${idx + 1}. **${title}** (${category})\n   Keys: ${keys}\n   ${content}${e.content?.length > 500 ? '...' : ''}`;
        }).join('\n\n');
        
        onProgress?.(40, 'Sending to AI...');
        
        const prompt = `You are analyzing a SillyTavern lorebook called "${lorebookName}".

Below are ALL ${entries.length} entries in this lorebook (existing + newly generated):

${entryList}

Your task: Write a comprehensive summary of this lorebook in ${maxTokens} tokens or less. Include:
1. Overall theme/setting
2. Key locations, factions, characters, or concepts covered
3. Tone and genre
4. Any unique mechanics or worldbuilding elements

Be concise but informative. This summary will be used to give AI context about the lorebook without sending all entries.

Summary:`;

        const response = await apiManager.generateUtility(
            'You are a concise lorebook analyst. Summarize lorebooks for AI context.',
            prompt
        );
        
        onProgress?.(90, 'Processing response...');
        
        return response.trim();
    }

    /**
     * Partial mode: Process entries in batches with delays
     */
    async _summarizePartial(lorebookName, entries, maxTokens, onProgress, settings) {
        const batchSize = settings.lorebookBatchSize || 5;
        const delaySeconds = settings.lorebookBatchDelay || 2;
        const useParallel = settings.lorebookUseParallel !== false && settings.parallelApiCalls !== false;
        
        const batches = [];
        for (let i = 0; i < entries.length; i += batchSize) {
            batches.push(entries.slice(i, i + batchSize));
        }
        
        onProgress?.(10, `Processing ${batches.length} batches...`);
        
        const batchSummaries = [];
        
        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            const percent = 10 + Math.floor((i / batches.length) * 70);
            onProgress?.(percent, `Batch ${i + 1}/${batches.length}...`);
            
            const entryList = batch.map((e, idx) => {
                const keys = (e.keys || e.key || []).join(', ');
                const category = e.category || 'General';
                const title = e.comment || e.name || `Entry ${idx + 1}`;
                const content = (e.content || '').substring(0, 400);
                
                return `- **${title}** (${category}): ${content}${e.content?.length > 400 ? '...' : ''}`;
            }).join('\n');
            
            const prompt = `Summarize these ${batch.length} lorebook entries in 2-3 sentences:\n\n${entryList}\n\nSummary:`;
            
            const response = await apiManager.generateUtility(
                'You are a concise summarizer. Keep summaries under 100 words.',
                prompt
            );
            
            batchSummaries.push(response.trim());
            
            // Delay before next batch (except last one)
            if (i < batches.length - 1 && delaySeconds > 0) {
                await this._delay(delaySeconds * 1000);
            }
        }
        
        onProgress?.(80, 'Combining batch summaries...');
        
        // Now combine all batch summaries into one final summary
        const combinedPrompt = `You are analyzing a SillyTavern lorebook called "${lorebookName}".

Below are summaries of different sections of this lorebook (${entries.length} entries total):

${batchSummaries.map((s, i) => `Batch ${i + 1}:\n${s}`).join('\n\n')}

Your task: Combine these batch summaries into ONE cohesive summary in ${maxTokens} tokens or less. Include:
1. Overall theme/setting
2. Key elements covered
3. Tone and genre

Be concise but comprehensive. This summary will be used to give AI context about the lorebook.

Final Summary:`;

        const finalSummary = await apiManager.generateUtility(
            'You are a concise lorebook analyst. Combine summaries coherently.',
            combinedPrompt
        );
        
        return finalSummary.trim();
    }

    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

export const lorebookSummarizer = new LorebookSummarizer();
