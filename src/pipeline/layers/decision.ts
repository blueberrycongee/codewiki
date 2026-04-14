import type { LayerDefinition } from "./index.js";

export const decisionLayer: LayerDefinition = {
  layer: "decision",
  description: "Design decisions: why X was chosen over Y, constraints, trade-offs",
  classifyHint:
    "Mentions choosing between alternatives, trade-offs, 'instead of', 'rather than', 'decided', architectural reasoning",

  extractFactsPrompt: (repoName, repoFullName) => `You are analyzing the ${repoName} project (${repoFullName}) to extract DESIGN DECISIONS.

A design decision is a deliberate choice between alternatives. Look for:
- Why a specific technology/pattern/approach was chosen
- What alternatives were considered and rejected
- What constraints drove the decision
- What trade-offs were accepted

For each decision, extract:
- claim: A clear statement of what was decided
- source: { type, url, ref } pointing to the evidence
- confidence: "high" (explicitly stated), "medium" (strongly implied), "low" (inferred)
- relevance: Why this decision matters

Return JSON: { "facts": [...] }

Focus on decisions that would help someone understand WHY the code is the way it is, not just WHAT it does.`,

  composePagePrompt: (repoName) => `Write a Design Decisions page for ${repoName}.

Format each decision as:
## D1: [Decision Title]

**Choice:** What was chosen
**Alternatives:** What else could have been done
**Rationale:** Why this was chosen (constraints, trade-offs)
**Consequences:** What followed from this decision (both good and bad)

Cross-reference other layers using [[${repoName.toLowerCase()}/constraint]], [[${repoName.toLowerCase()}/pitfall]], etc. when a decision connects to a constraint or caused a pitfall.

Number all decisions (D1, D2, D3...). Order by importance, not chronology.
Write in the language that matches the source material. Be specific — cite file paths, commit SHAs, PR numbers.`,
};
