// prompts/audit.js

export const COHERENCE_AUDIT_PROMPT = `Perform a COHERENCE AUDIT on this character card.

## 🔴 Errors (Direct Contradictions)
- Factual conflicts between fields (different ages, conflicting backstory)
- Character behaves differently in description vs system_prompt
- First message contradicts scenario setup
- Lorebook contradicts card field content
- {{user}} actions written in {{char}}'s fields

## 🟡 Warnings (Weaknesses / Inconsistencies)
- Tone mismatch between fields
- Important trait in description but no supporting behavior in mes_example
- Scenario references unexplained location/situation
- Character voice inconsistent between first_mes and mes_example
- Lorebook references characters/places not established in the card

## 💡 Smart Suggestions (Missing Best Practices)
- Headers in alternate_greetings but no format instruction in system_prompt
- Critical behavioral rules in mes_example (gets dropped from context)
- system_prompt empty but description has AI behavioral instructions
- No scenario set but first_mes assumes a specific location
- Lorebook has entries but no Constant entries when some clearly should be
- Tags incomplete or missing obvious categorizations
- creator_notes empty for a card intended for sharing

## Format:
### Coherence Audit Results

**🔴 Errors Found: [N]**
[Each error: which fields conflict, what conflicts, suggested fix]

**🟡 Warnings: [N]**
[Each warning: what's weak, why it matters, suggested improvement]

**💡 Smart Suggestions: [N]**
[Each suggestion: what's missing, why it helps, how to fix]

**✅ Overall Assessment:** [1–2 sentence summary]

If no issues in a category: "None found ✅"`;

export const MES_EXAMPLE_AUDIT_PROMPT = `Check this mes_example for behavioral instructions that belong in system_prompt.

Behavioral instructions that should be in system_prompt (NOT mes_example):
- Response format rules (length, style, formatting)
- "Always/never" behavioral rules
- Content restrictions or permissions
- Meta-instructions about how the AI plays the character

Voice/tone content that's FINE in mes_example:
- Natural dialogue showing character voice
- Character reactions demonstrating personality

Flag any instructions found. If found, output the corrected mes_example (pure examples only) and list what should move to system_prompt.`;

export const SMART_SUGGESTION_CHECK_PROMPT = `Quick check — are there any obvious best-practice issues in the current card?

Focus only on actionable, specific suggestions. Skip obvious things like "add more content."

Check:
1. mes_example contains behavioral rules that should be in system_prompt
2. Headers/format in greetings but no format rules in system_prompt
3. system_prompt empty despite complex card mechanics
4. Lorebook has entries but none set Constant when some clearly should be
5. Card clearly designed for adult content but no appropriate tags
6. No alternate greetings for a card with multiple potential scenarios

Report only real issues found, one per line. If everything looks fine, say so.`;
