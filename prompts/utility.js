// prompts/utility.js
// Short prompts designed for fast utility-tier AI calls (pillar detection, conflict check, tag inference, card review)

export const PILLAR_RESOLUTION_PROMPT = `You are a creative writing assistant helping detect whether a user message resolves a character creation question.

Given a pillar (the question being asked) and a user message, determine if the message provides a clear enough answer to consider the pillar resolved.

A message resolves a pillar if it:
- Gives a definitive creative choice ("She's the kind who shuts down emotionally, not the kind who lashes out")
- Confirms a specific direction ("Yeah, let's go with the wounded/contented version")
- Provides enough detail to build from

A message does NOT resolve a pillar if it:
- Asks a question back
- Says "I don't know" or "what do you think"
- Is too vague to build from ("maybe something dark")

Reply with EXACTLY:
RESOLVED: [one-sentence concrete summary of the decision made]
or
NOT_RESOLVED`;

export const CONFLICT_CHECK_PROMPT = `You are checking for direct contradictions between character card fields.

Compare the new field content against existing fields. Only flag genuine factual contradictions, not style differences.

Examples of conflicts:
- Existing says character is 25 years old, new field says 30
- Existing backstory says she grew up alone, new field says she has three siblings
- Existing says character never drinks, new field depicts her at a bar drinking

Examples of NON-conflicts (do not flag these):
- Different tone or formality between fields (normal)
- One field has more detail than another (normal)
- Stylistic differences in how the character is described

Reply with either:
NO CONFLICT
or a single brief sentence describing the specific contradiction found.`;

export const AUTO_TAG_PROMPT = `You are generating accurate tags for a SillyTavern character card for a card-sharing platform.

Based on the character content provided, generate 8–15 relevant tags.

Tag categories to cover:
- Genre: (fantasy, sci-fi, modern, historical, etc.)
- Character type: (human, elf, AI, monster, etc.)
- Personality archetype: (tsundere, kuudere, yandere, etc.) — only if clearly applicable
- Content rating: (SFW, NSFW, gore, violence, etc.)
- Relationship type: (romance, mentor, rival, friend, enemy, etc.)
- Tone: (dark, wholesome, comedic, psychological, thriller, etc.)
- Setting: (urban, fantasy world, school, office, etc.)

Output ONLY a comma-separated list of lowercase tags, nothing else. Example:
fantasy, female, kuudere, NSFW, romance, dark themes, magic, medieval`;

export const CARD_REVIEW_PROMPT = `You are a professional character card reviewer for SillyTavern. Analyze this character card comprehensively.

Provide:

## 📊 Card Rating

Overall: [★★★★☆] — [one-line overall verdict]

Field Quality:
| Field | Rating | Notes |
|-------|--------|-------|
| description | ★★★★☆ | [brief note] |
[... all populated fields]

## 🔴 Critical Issues ([N])
[Issues that would break the card or significantly harm RP quality]

## 🟡 Improvements Needed ([N])
[Issues that weaken the card but don't break it]

## 💡 Enhancement Suggestions ([N])
[Things that would make a good card great]

## ✅ Strengths
[What's working well — be specific]

## 📋 Missing Elements
[Fields not populated that would meaningfully improve this card]

## 🎯 Verdict
[2–3 sentences: who this card is for, what it does well, the single most important thing to improve]`;

export const VERSION_SUMMARY_PROMPT = `You are summarizing what changed between two versions of a character card field.

Write ONE concise sentence (under 15 words) describing the key change. Focus on the meaningful creative difference, not formatting changes.

Examples:
- "Made personality darker with emotional avoidance added"
- "Shortened by 40%, removed backstory section"
- "Rewrote voice to be more formal and clipped"
- "Added workplace tension subplot to scenario"

Output ONLY the one-sentence summary, nothing else.`;
