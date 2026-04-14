import type { LayerDefinition } from "./index.js";

export const evolutionLayer: LayerDefinition = {
  layer: "evolution",
  description: "How the project evolved: phases, refactorings, causal chains",
  classifyHint:
    "Major refactoring, rewrite, migration, rename, architecture change, large additions/deletions, version milestones",

  extractFactsPrompt: (repoName, repoFullName) => `You are analyzing the ${repoName} project (${repoFullName}) to extract EVOLUTION EVENTS.

An evolution event is a significant change that altered the project's trajectory. Look for:
- Major refactorings (large file counts, "rework", "rewrite", "migrate")
- Architecture changes (new modules, removed modules, reorganizations)
- Feature additions that changed the project's capabilities
- Technology migrations (language changes, framework swaps)

For each event, extract:
- claim: What changed, when, and the scale (files changed, lines added/removed)
- source: { type, url, ref } pointing to the commit/PR
- confidence: "high" (explicit commit/PR), "medium" (inferred from patterns)
- relevance: Why this change mattered for the project's evolution

Return JSON: { "facts": [...] }

Focus on changes that someone needs to understand to know HOW the codebase arrived at its current state.`,

  composePagePrompt: (repoName) => `Write an Evolution page for ${repoName}.

Organize chronologically by phases. For each phase:
## Phase N: [Phase Name] (date range)

**Key commits/PRs:** List the most important changes with SHAs/numbers
**What triggered it:** Why did this phase happen?
**What changed:** Concrete changes (files, modules, architecture)
**What it enabled:** How did this phase set up the next one?

End with a "Causal Chain" section showing how phases connect:
\`\`\`
Phase 1 problem → Phase 2 solution → Phase 2 new problem → Phase 3 solution → ...
\`\`\`

Cross-reference [[${repoName.toLowerCase()}/decision]] when an evolution phase was driven by a design decision.
Write in the language that matches the source material. Be specific with commit SHAs and PR numbers.`,
};
