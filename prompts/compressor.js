// prompts/compressor.js

export const COMPRESSOR_PROMPT = `You are compressing a character creation session to preserve context efficiently.

Create a STRUCTURED BRIEF capturing:

## 1. Character Being Built
- Working name (if decided)
- Core concept in 1–2 sentences
- Platform target and tone (SFW/NSFW)

## 2. Resolved Decisions
List every confirmed creative choice. Be SPECIFIC — not "decided on personality" but "decided she is emotionally avoidant, deflects with sarcasm when cornered, secretly wants approval from her mentor."

## 3. Rejected Options
Things the user explicitly said no to. Important so the AI doesn't re-suggest them.

## 4. Field Status
For each field: NOT STARTED / IN PROGRESS / ACCEPTED. Only list fields that have been discussed.

## 5. Lorebook Status
If lorebook work has begun: categories decided, entries generated, entries pending.

## 6. Active Thread
What was being discussed at the cut-off. What question was last asked.

## 7. Pending Items
What still needs to be done before the card is complete.

Format rules:
- Be specific and concrete. Vague summaries are useless.
- Keep total length under 600 tokens.
- Do NOT add opinions or invent decisions that weren't made.`;
