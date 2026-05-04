// core/audit.js
// Coherence audit, conflict detection, keyword quality, auto-tag inference

import { chatEngine } from './chat.js';
import { memoryManager } from './memory.js';
import { contextBuilder } from './context-builder.js';
import { buildBaseSystemPrompt } from '../prompts/base.js';
import { COHERENCE_AUDIT_PROMPT, SMART_SUGGESTION_CHECK_PROMPT, MES_EXAMPLE_AUDIT_PROMPT } from '../prompts/audit.js';
import { KEYWORD_QUALITY_CHECK_PROMPT } from '../prompts/lorebook.js';
import { AUTO_TAG_PROMPT, CONFLICT_CHECK_PROMPT, PILLAR_RESOLUTION_PROMPT, CARD_REVIEW_PROMPT } from '../prompts/utility.js';
import { parseCardReview } from './parser.js';

export class AuditEngine {

    // ── Full coherence audit ─────────────────────────────────────────────────

    async runCoherenceAudit(session, cardFields) {
        const base = buildBaseSystemPrompt(memoryManager.getGlobalSettings().customSystemPromptRules);
        const { systemPrompt } = contextBuilder.buildBackgroundContext({ session, cardFields, baseSystemPrompt: base });
        const result = await chatEngine.generateBackground(
            systemPrompt + '\n\n' + COHERENCE_AUDIT_PROMPT,
            'Perform a full coherence audit on the character card above.'
        );
        return this._parseAuditResult(result);
    }

    // ── Smart suggestions (lighter) ──────────────────────────────────────────

    async runSmartSuggestions(session, cardFields) {
        const base = buildBaseSystemPrompt(memoryManager.getGlobalSettings().customSystemPromptRules);
        const { systemPrompt } = contextBuilder.buildBackgroundContext({ session, cardFields, baseSystemPrompt: base });
        return chatEngine.generateBackground(
            systemPrompt + '\n\n' + SMART_SUGGESTION_CHECK_PROMPT,
            'Check for obvious best-practice issues in the card above.'
        );
    }

    // ── Auto-trigger smart suggestions after N field accepts ─────────────────

    async autoSuggestCheck(session, cardFields) {
        const accepted = Object.values(session.fieldLog).filter(f => f.acceptedAt).length;
        if (accepted > 0 && accepted % 5 === 0) {
            try {
                const s = await this.runSmartSuggestions(session, cardFields);
                if (s && s.trim() && !s.toLowerCase().includes('no issues')) return s;
            } catch {}
        }
        return null;
    }

    // ── Conflict detection on field accept (UTILITY tier) ────────────────────

    async checkConflictOnAccept(session, cardFields, newFieldName, newContent) {
        // Only check if we have enough existing content to compare against
        const acceptedFields = Object.entries(cardFields)
            .filter(([k, v]) => k !== newFieldName && typeof v === 'string' && v.trim().length > 50);
        if (acceptedFields.length < 2) return null;

        const existingSummary = acceptedFields
            .map(([k, v]) => `[${k}]: ${v.substring(0, 200)}`)
            .join('\n\n');

        try {
            const result = await chatEngine.generateUtility(
                CONFLICT_CHECK_PROMPT,
                `EXISTING FIELDS:\n${existingSummary}\n\nNEW FIELD (${newFieldName}):\n${newContent.substring(0, 400)}\n\nDoes the new field contradict anything? Reply with a single line: "NO CONFLICT" or a brief description of the conflict.`
            );

            if (!result || result.trim().toUpperCase().startsWith('NO CONFLICT')) return null;
            return result.trim();
        } catch {
            return null;
        }
    }

    // ── Keyword quality check ────────────────────────────────────────────────

    async checkKeywordQuality(entries) {
        const list = entries.map((e, i) =>
            `[${i + 1}] "${e.comment}"\n  Keys: ${e.keys?.join(', ') || 'none'}\n  Secondary: ${e.secondary_keys?.join(', ') || 'none'}`
        ).join('\n\n');
        return chatEngine.generateBackground(
            KEYWORD_QUALITY_CHECK_PROMPT,
            `Analyze these lorebook keywords:\n\n${list}`
        );
    }

    // ── Auto-tag inference (UTILITY tier) ────────────────────────────────────

    async inferTags(cardFields, platformTarget) {
        const content = `Name: ${cardFields.name || ''}\nDescription: ${(cardFields.description || '').substring(0, 400)}\nPersonality: ${(cardFields.personality || '').substring(0, 200)}\nTags already set: ${(cardFields.tags || []).join(', ')}`;
        try {
            const result = await chatEngine.generateUtility(
                AUTO_TAG_PROMPT + `\nPlatform: ${platformTarget || 'chub'}`,
                content
            );
            // Parse comma-separated tags from result
            const tagLine = result?.split('\n').find(l => l.includes(',') || /^[a-z]/.test(l.trim()));
            if (tagLine) {
                return tagLine.split(',').map(t => t.trim()).filter(t => t.length > 0 && t.length < 40);
            }
            return [];
        } catch { return []; }
    }

    // ── Pillar resolution detection (UTILITY tier) ───────────────────────────

    async detectPillarResolution(userMessage, pillarName, conversationContext) {
        try {
            const result = await chatEngine.generateUtility(
                PILLAR_RESOLUTION_PROMPT,
                `Pillar: "${pillarName}"\nUser message: "${userMessage}"\nContext (last 2 exchanges): ${conversationContext}\n\nDid this message resolve the pillar? Reply with:\nRESOLVED: [one-sentence summary of the answer]\nor\nNOT_RESOLVED`
            );
            if (!result) return null;
            const resolvedMatch = result.match(/RESOLVED:\s*(.+)/i);
            if (resolvedMatch) return resolvedMatch[1].trim();
            return null;
        } catch { return null; }
    }

    // ── Card review (load existing card) ────────────────────────────────────

    async reviewExistingCard(cardFields) {
        const fieldSummary = this._buildFullCardSummary(cardFields);
        const base = buildBaseSystemPrompt();
        const result = await chatEngine.generateBackground(
            base + '\n\n' + CARD_REVIEW_PROMPT,
            `Review this character card:\n\n${fieldSummary}`
        );
        return parseCardReview(result);
    }

    // ── mes_example audit ────────────────────────────────────────────────────

    async auditMesExample(content) {
        const result = await chatEngine.generateBackground(
            MES_EXAMPLE_AUDIT_PROMPT,
            `Check this mes_example:\n\n${content}`
        );
        const hasIssues = /should move|belongs in system_prompt|instruction found/i.test(result);
        return { hasIssues, report: result };
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    _parseAuditResult(text) {
        const errorMatch  = text.match(/🔴 Errors Found:\s*(\d+)/);
        const warnMatch   = text.match(/🟡 Warnings:\s*(\d+)/);
        const suggMatch   = text.match(/💡 Smart Suggestions:\s*(\d+)/);
        return {
            raw: text,
            hasErrors:      (parseInt(errorMatch?.[1]) || 0) > 0,
            hasWarnings:    (parseInt(warnMatch?.[1]) || 0) > 0,
            hasSuggestions: (parseInt(suggMatch?.[1]) || 0) > 0,
            errorCount:     parseInt(errorMatch?.[1]) || 0,
            warningCount:   parseInt(warnMatch?.[1]) || 0,
            suggestionCount:parseInt(suggMatch?.[1]) || 0,
        };
    }

    _buildFullCardSummary(cardFields) {
        const parts = [];
        const fields = ['name','description','personality','scenario','first_mes','mes_example','system_prompt','creator_notes'];
        for (const f of fields) {
            const v = cardFields[f];
            if (v?.trim()) parts.push(`[${f.toUpperCase()}]\n${v.substring(0, 500)}${v.length > 500 ? '...' : ''}`);
        }
        const greetings = cardFields.alternate_greetings || [];
        if (greetings.length) parts.push(`[ALTERNATE_GREETINGS: ${greetings.length} greeting(s)]\n${greetings[0]?.substring(0, 200)}...`);
        const book = cardFields.character_book;
        if (book?.entries?.length) parts.push(`[CHARACTER_BOOK: ${book.entries.length} embedded entries]`);
        const tags = cardFields.tags || [];
        if (tags.length) parts.push(`[TAGS: ${tags.join(', ')}]`);
        return parts.join('\n\n') || 'No fields populated.';
    }
}

export const auditEngine = new AuditEngine();
