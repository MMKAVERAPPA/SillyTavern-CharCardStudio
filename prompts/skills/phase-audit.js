// prompts/skills/phase-audit.js
// Enhanced audit, card review, and character simulation/testing

export const SKILL_COHERENCE_AUDIT = `## Full Coherence Audit

Perform a comprehensive coherence audit on this character card.

### 🔴 Errors (Direct Contradictions)
- Factual conflicts between fields (different ages, conflicting backstory)
- Character behaves differently in description vs system_prompt
- First message contradicts scenario setup
- Lorebook contradicts card field content
- {{user}} actions written in {{char}}'s fields
- mes_example contains behavioral instructions that will get dropped from context
- system_prompt uses negative framing ("don't", "never") that backfires on LLMs

### 🟡 Warnings (Weaknesses)
- Tone mismatch between fields
- Important trait in description but no supporting behavior in mes_example
- Scenario references unexplained location/situation
- Character voice inconsistent between first_mes and mes_example
- Lorebook references characters/places not established in the card
- Strong traits without counterweights (will be exaggerated by AI)
- Opening scene location duplicated in both scenario and first_mes
- System prompt restates personality/description content (wasted tokens)

> Note: PList, W++, and Ali:Chat are valid formats. Do not flag them as errors or weaknesses simply because they are not Prose. Judge the *content* (e.g., missing counterweights, generic traits) rather than the format itself.

### 💡 Smart Suggestions (Missing Best Practices)
- system_prompt empty but complex card mechanics need it
- Critical behavioral rules placed in mes_example (gets dropped)
- system_prompt uses "don't/never" — suggest positive reframing
- No alternate greetings for a card with multiple potential scenarios
- Creator notes empty for a card intended for sharing
- Tags incomplete or missing obvious categorizations
- Permanent token count exceeds recommended range
- No voice demonstration in mes_example
- First message doesn't show character's unique speech patterns
- PList missing counterweights for strong traits

### Format:
**📊 Card Rating**
Overall: [★★★★☆] — [one-line verdict]

| Field | Rating | Key Issue |
|-------|--------|-----------|
[For each populated field]

**🔴 Critical Issues ([N])**
[Each: which fields, what conflicts, suggested fix]

**🟡 Improvements Needed ([N])**
[Each: what's weak, why it matters, suggested fix]

**💡 Enhancement Suggestions ([N])**
[Each: what's missing, why it helps, how to add it]

**✅ Strengths**
[What's working well — be specific]

**📋 Token Budget**
Permanent tokens: ~[estimate] (description + personality + scenario + system_prompt)
Assessment: [within range / high / too high]

**🎯 Verdict**
[2-3 sentences: who this card is for, what it does well, the single most important thing to improve]`;

export const SKILL_SMART_SUGGESTIONS = `Quick-check for obvious best-practice issues in the current card.

Focus only on actionable, specific suggestions. Skip vague advice like "add more content."

Check:
1. mes_example contains behavioral rules that should be in system_prompt
2. Headers/format in greetings but no format rules in system_prompt
3. system_prompt empty despite complex card mechanics
4. system_prompt uses negative framing ("don't/never/do not") — suggest rewording
5. Lorebook has entries but none set to Constant when some clearly should be
6. Card designed for adult content but no appropriate tags
7. No alternate greetings for a card with multiple potential scenarios
8. Permanent token count appears excessive (500+ in system_prompt alone)
9. Strong personality traits without counterweights
10. Voice not demonstrated — mes_example missing or doesn't show speech patterns
11. Opening scene location appears in BOTH scenario and first_mes (duplication error)

Report only real issues found. If everything looks fine, say so.`;

export const SKILL_MES_EXAMPLE_AUDIT = `Check this mes_example for content that doesn't belong.

### Should be in system_prompt (NOT mes_example):
- Response format rules (length, style, formatting)
- "Always/never" behavioral rules
- Content restrictions or permissions
- Meta-instructions about how the AI plays the character

### Fine in mes_example:
- Natural dialogue showing character voice
- Character reactions demonstrating personality
- Physical mannerisms and behavioral patterns in action

Flag any misplaced instructions. If found, output:
1. The corrected mes_example (pure voice/tone examples only)
2. Instructions that should move to system_prompt
3. Instructions that should move to description`;

export const SKILL_CHARACTER_SIMULATION = `## Character Test Drive

You will now temporarily "become" this character to test the card. Use ONLY the information in the card fields — do not invent traits, backstory, or behaviors not present in the card.

### Test Protocol
For each test scenario provided:
1. **Respond in-character** using only the card's established voice, personality, and behavioral patterns
2. **After the response**, break character and provide a diagnostic:

**📋 Card Performance Report:**
- **Voice Consistency:** Did the card provide enough speech pattern guidance? [✅/⚠️/❌]
- **Behavioral Clarity:** Did I know how to react, or did I have to guess? [✅/⚠️/❌]
- **Emotional Range:** Could I handle this situation's emotional demands? [✅/⚠️/❌]
- **Missing Information:** What did I need but couldn't find in the card?
- **Drift Risk:** Where might the AI start drifting away from character over time?
- **Suggested Fix:** One specific edit that would improve this scenario's handling.

### Default Test Scenarios (if user doesn't specify):
1. **Casual Interaction** — A normal, low-stakes encounter
2. **Under Pressure** — A stressful or confrontational situation
3. **Vulnerability** — A moment that bypasses their defenses
4. **Core Contradiction** — A situation that forces their central contradiction to surface

After all tests, provide an overall assessment:
- **Card Strengths:** What the card handles well
- **Critical Gaps:** Information the card needs but doesn't have
- **Recommended Edits:** Specific field changes with priority order`;

export const SKILL_CONFLICT_CHECK = `Check for direct contradictions between character card fields.

Compare the new field content against ALL existing fields. Only flag genuine factual contradictions, not style differences.

### Examples of CONFLICTS:
- Existing says character is 25, new field says 30
- Backstory says she grew up alone, new field mentions three siblings
- Description says character never drinks, first_mes depicts her at a bar drinking
- Scenario says they just met, mes_example shows established relationship
- system_prompt says "always speaks formally", description says "casual, slang-heavy speech"

### Examples of NON-conflicts (do not flag):
- Different tone or formality between fields (normal)
- One field has more detail than another (normal)
- Stylistic differences in how the character is described
- Description mentions a trait that system_prompt reinforces (redundant but not contradictory)

Reply with either:
NO CONFLICT
or a brief sentence describing the specific contradiction found.`;

export const SKILL_CARD_REVIEW = `## Professional Card Review

Analyze this character card comprehensively as a card reviewer would.

### Rating Axes (1-5 stars each):
- **Concept Clarity:** Is the core idea immediately understandable?
- **Character Depth:** Layers, contradictions, psychological complexity?
- **Voice Uniqueness:** Would you recognize this character with the name hidden?
- **Structural Cleanliness:** Right content in right fields, no duplication? (CRITICAL: Do NOT penalize PList, W++, or Ali:Chat formats as "relics" or "keyword soup." These are valid, token-efficient structures. Judge the *quality of the traits* inside the format, not the format choice itself.)
- **Immersion Strength:** Does the first_mes make you want to respond?
- **Long-Term Stability:** Will this character stay consistent over a long RP?

### Output Format:

**📊 Card Rating**
Overall: [★★★★☆] — [one-line overall verdict]

| Axis | Rating | Notes |
|------|--------|-------|
| Concept Clarity | ★★★★☆ | [brief] |
| Character Depth | ★★★☆☆ | [brief] |
| Voice Uniqueness | ★★★★☆ | [brief] |
| Structural Cleanliness | ★★★★★ | [brief] |
| Immersion Strength | ★★★★☆ | [brief] |
| Long-Term Stability | ★★★☆☆ | [brief] |

**Field Quality:**
| Field | Rating | Notes |
|-------|--------|-------|
[... all populated fields]

**🔴 Critical Issues ([N])**
**🟡 Improvements ([N])**
**💡 Enhancements ([N])**
**✅ Strengths**
**🎯 Verdict:** [2-3 sentences]`;

export const SKILL_DEPTH_ANALYSIS = `## Psychological Depth Analysis

Analyze this character on 7 psychological dimensions. For each, give a score 1-10 and a one-line justification.

### Dimensions:
1. **Motivation** — Is the core drive clear, specific, and believable?
2. **Fear** — Does the character have a meaningful fear or vulnerability?
3. **Contradiction** — Do they hold opposing beliefs or desires that create tension?
4. **Growth Potential** — Is there room to evolve through roleplay?
5. **Relatability** — Can a player connect emotionally?
6. **Uniqueness** — Does this character feel distinct from common archetypes?
7. **Consistency** — Do all fields agree on who this character is?

### Output Format (use EXACTLY this structure for parsing):
DEPTH_SCORES_START
Motivation: [1-10]
Fear: [1-10]
Contradiction: [1-10]
GrowthPotential: [1-10]
Relatability: [1-10]
Uniqueness: [1-10]
Consistency: [1-10]
DEPTH_SCORES_END

### Top Suggestions:
[3 specific, actionable improvements to deepen this character — be concrete about which field to edit and what to add]

### Overall Assessment:
[2-3 sentences on the character's psychological richness and what kind of roleplay they'd support best]`;

export const SKILL_STYLE_CONSISTENCY = `## Style Consistency Check

Analyze ALL populated fields for consistency of writing style. Do not comment on content — only on how things are written.

### Check these dimensions:
1. **POV** — Is it consistently 1st person (I/me) or 3rd person (she/he/they)? Flag any field that breaks the pattern.
2. **Tense** — Consistent present or past tense? Flag mixed tense within or across fields.
3. **Format type** — Prose vs bullet points vs W++? Flag inconsistent format use across fields.
4. **Formality level** — Is the vocabulary register consistent (e.g., florid description but blunt personality)?
5. **Narrator voice** — Is the narrative stance consistent (clinical, warm, dramatic)?

### Output Format:
**POV:** [consistent/inconsistent — explain]
**Tense:** [consistent/inconsistent — explain]
**Format:** [consistent/inconsistent — explain]
**Formality:** [consistent/inconsistent — explain]
**Narrator Voice:** [consistent/inconsistent — explain]

**Issues Found:** [N]
[For each issue: field name, what the inconsistency is, suggested fix]

**Overall:** [CONSISTENT / MOSTLY CONSISTENT / INCONSISTENT] — [one sentence]`;

export const SKILL_CROSS_REF = `## Cross-Reference Validation

Extract all concrete facts from the character card fields and check for contradictions.

### What to extract:
- Ages, dates, time periods
- Relationships (family, friends, enemies)
- Locations (birthplace, home, notable places)
- Physical attributes (height, hair, eyes, build)
- Backstory events (key moments, turning points)
- Abilities and limitations
- Named characters, factions, places

### Cross-check against lorebook entries if provided.

### Output Format:
**Entity Map:**
| Type | Entity | Source Field | Details |
|------|--------|-------------|---------|
[list all extracted facts]

**Contradictions Found:** [N]
[For each: Entity, Field A says X, Field B says Y, severity: critical/minor]

**Lorebook Conflicts:** [N]
[Any card field vs lorebook entry conflicts]

**Verdict:** [CLEAN / MINOR ISSUES / CONTRADICTIONS FOUND]`;

