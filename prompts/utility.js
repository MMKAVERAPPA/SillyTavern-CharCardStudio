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

export const VERSION_SUMMARY_PROMPT = `You are summarizing what changed between two versions of a character card field.

Write ONE concise sentence (under 15 words) describing the key change. Focus on the meaningful creative difference, not formatting changes.

Examples:
- "Made personality darker with emotional avoidance added"
- "Shortened by 40%, removed backstory section"
- "Rewrote voice to be more formal and clipped"
- "Added workplace tension subplot to scenario"

Output ONLY the one-sentence summary, nothing else.`;
