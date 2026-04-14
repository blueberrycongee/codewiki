import type { LayerDefinition } from "./index.js";

export const constraintLayer: LayerDefinition = {
  layer: "constraint",
  description: "Rules that must not be broken when modifying the code",
  classifyHint:
    "Mentions 'must not', 'never', 'always ensure', 'breaking change', invariants, safety checks, permission requirements",

  extractFactsPrompt: (repoName, repoFullName) => `You are analyzing the ${repoName} project (${repoFullName}) to extract CONSTRAINTS — rules that must not be broken.

A constraint is something that, if violated, would cause crashes, security issues, data corruption, or architectural regression. Look for:
- Interface contracts that implementations must follow
- Event ordering/protocol requirements
- Permission/safety checks that must happen before certain operations
- Shutdown/initialization ordering requirements
- Data format invariants (serialization, database schema)
- Test assertions that protect critical behavior

For each constraint, extract:
- claim: The specific rule that must be maintained
- source: { type, url, ref } pointing to where the constraint is enforced
- confidence: "high" (explicitly coded/documented), "medium" (implied by code structure)
- relevance: What breaks if this constraint is violated

Return JSON: { "facts": [...] }

Focus on constraints that are NOT obvious from reading the code — things a developer might accidentally violate.`,

  composePagePrompt: (repoName) => `Write a Constraints page for ${repoName}.

Format each constraint as:
## C1: [Constraint Title]

**Rule:** Clear statement of what must not be violated
**Why:** What breaks if this is violated (crash, security hole, data loss, etc.)
**Where:** Code location where this constraint is enforced
**Example:** A concrete scenario of how someone might accidentally violate this

Number all constraints (C1, C2, C3...). Order by severity — most dangerous violations first.
Cross-reference [[${repoName.toLowerCase()}/decision]] when a constraint was established by a design decision.
Write in the language that matches the source material. Be specific — cite file paths and function names.`,
};
