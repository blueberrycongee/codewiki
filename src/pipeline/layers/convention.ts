import type { LayerDefinition } from "./index.js";

export const conventionLayer: LayerDefinition = {
  layer: "convention",
  description: "How things are done in this codebase — patterns and idioms",
  classifyHint:
    "Repeated code patterns, naming conventions, standard structures, interface patterns, error handling idioms",

  extractFactsPrompt: (repoName, repoFullName) => `You are analyzing the ${repoName} project (${repoFullName}) to extract CODING CONVENTIONS — the patterns and idioms used consistently across the codebase.

A convention is a way of doing things that repeats across multiple files/modules. Look for:
- Interface/struct patterns (e.g., "every service implements X interface")
- Constructor patterns (e.g., "factory functions return interfaces, not structs")
- Error handling patterns (e.g., "tool errors return ToolResponse with IsError, not Go errors")
- Naming conventions (e.g., "files are named after the tool they implement")
- Directory structure conventions
- Dependency injection patterns
- Testing patterns
- Logging/observability patterns
- Configuration patterns

For each convention, extract:
- claim: The specific pattern, with examples from at least 2 different files
- source: { type, url, ref } pointing to an example
- confidence: "high" (used consistently everywhere), "medium" (used in most places)
- relevance: Why deviating from this convention would cause problems

Return JSON: { "facts": [...] }

Focus on conventions that a new contributor NEEDS to follow to write consistent code.`,

  composePagePrompt: (repoName) => `Write a Conventions page for ${repoName}.

Format each convention as:
## CV1: [Convention Title]

**Pattern:** Description of the convention
**Example:** Code snippet showing correct usage (use the project's actual code)
**Why:** Why this convention exists (consistency, safety, framework requirement)
**Deviation consequence:** What goes wrong if you don't follow this

Number all conventions (CV1, CV2, CV3...). Group by category (e.g., "Service Patterns", "Tool Patterns", "Error Handling").
Write in the language that matches the source material. Include file paths and actual code snippets from the codebase.`,
};
