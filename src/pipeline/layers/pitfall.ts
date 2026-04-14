import type { LayerDefinition } from "./index.js";

export const pitfallLayer: LayerDefinition = {
  layer: "pitfall",
  description: "What failed, what paths didn't work, non-obvious bugs",
  classifyHint:
    "Bug fix, revert, workaround, hack, regression, rejected PR, 'this broke', security vulnerability, compatibility issue",

  extractFactsPrompt: (repoName, repoFullName) => `You are analyzing the ${repoName} project (${repoFullName}) to extract PITFALLS — things that went wrong and lessons learned.

A pitfall is a failure, bug, or bad approach that someone could easily repeat. Look for:
- Reverted PRs (approaches that were tried and abandoned)
- Bug fix commits (especially ones fixing non-obvious issues)
- Closed-but-not-merged PRs (rejected approaches)
- Issues describing unexpected behavior
- Commits mentioning "workaround", "hack", "fix", "regression"
- Compatibility problems between components

For each pitfall, extract:
- claim: What went wrong and why it was non-obvious
- source: { type, url, ref } pointing to the evidence (issue, PR, commit)
- confidence: "high" (explicit bug report/fix), "medium" (inferred from code changes)
- relevance: The lesson — how to avoid repeating this mistake

Return JSON: { "facts": [...] }

Focus on pitfalls that are SURPRISING — things that a competent developer might not anticipate.`,

  composePagePrompt: (repoName) => `Write a Pitfalls page for ${repoName}.

Format each pitfall as:
## P1: [Pitfall Title]

**What happened:** Description of the failure or bug
**Why it was surprising:** Why someone might not expect this
**Root cause:** The underlying reason
**Fix:** How it was resolved (with commit/PR reference)
**Lesson:** How to avoid this in the future

Number all pitfalls (P1, P2, P3...). Order by how likely someone is to repeat them.
Cross-reference [[${repoName.toLowerCase()}/constraint]] when a pitfall led to establishing a constraint.
Write in the language that matches the source material. Include issue numbers, PR numbers, commit SHAs.`,
};
