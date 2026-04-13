export const FILTER_COMMITS_PROMPT = `You are analyzing git commit messages to identify high-value commits for understanding how a coding agent is built.

Score each commit 0-10 based on relevance to these topics:
- Architecture and system design (how components are organized)
- Tool system (how tools are defined, dispatched, executed)
- Agent loop (how the LLM conversation cycle works)
- Context management (how context window is managed, compacted)
- Sandbox/security (how code execution is secured, permissions)
- Provider abstraction (how multiple LLM providers are supported)
- Session/state management (how conversations are persisted)

Scoring guide:
- 9-10: Major architectural change, new subsystem, core design decision
- 7-8: Significant feature that reveals design patterns
- 4-6: Useful feature but doesn't reveal much about architecture
- 1-3: Minor fix, docs update, dependency bump
- 0: Irrelevant (typo, formatting, CI config)

For each commit, also assign 1-3 topic tags from: architecture, tool-system, agent-loop, context-management, sandbox-security, provider, session-management, other.

Input: JSON array of {sha, message}
Output: JSON array of {sha, score, topicTags, message}

IMPORTANT: Return valid JSON only. No markdown, no explanation.`;

export const FILTER_PRS_PROMPT = `You are analyzing pull request titles and descriptions to identify high-value PRs for understanding how a coding agent is built.

Score each PR 0-10 based on relevance to these topics:
- Architecture and system design
- Tool system (tool definition, dispatch, execution)
- Agent loop (LLM conversation cycle)
- Context management (context window management)
- Sandbox/security (permissions, code execution safety)
- Provider abstraction (multi-LLM support)

Scoring guide:
- 9-10: Major architectural change, new subsystem
- 7-8: Significant feature revealing design patterns
- 4-6: Useful but architecturally thin
- 1-3: Minor improvement
- 0: Irrelevant

For each PR, also assign 1-3 topic tags from: architecture, tool-system, agent-loop, context-management, sandbox-security, provider, session-management, other.

Input: JSON array of {number, title, body}
Output: JSON array of {number, score, topicTags, title}

IMPORTANT: Return valid JSON only. No markdown, no explanation.`;

export function makeExtractFactsPrompt(
  projectName: string,
  topic: string,
  topicDescription: string,
): string {
  return `You are analyzing the ${projectName} codebase to extract structured facts about: ${topic}.

Topic description: ${topicDescription}

You will be given source material including code files, commit diffs, and PR descriptions.

For each fact you extract:
1. State the claim clearly and specifically
2. Cite the exact source (file path, commit SHA, or PR number)
3. Rate your confidence: "high" (directly stated in code/docs), "medium" (inferred from code structure), "low" (inferred from patterns/naming)

Focus on:
- HOW things work (implementation details)
- WHY decisions were made (if evident from PR descriptions or commit messages)
- What CHANGED over time (if you see evolution in commits)
- What ALTERNATIVES were considered (from PR discussions)

Return a JSON object:
{
  "facts": [
    {
      "claim": "string - the specific factual claim",
      "source": {
        "type": "code" | "commit" | "pr" | "readme",
        "url": "https://github.com/...",
        "ref": "file path or commit SHA or PR number"
      },
      "confidence": "high" | "medium" | "low",
      "relevance": "string - why this fact matters for understanding ${topic}"
    }
  ]
}

IMPORTANT: Return valid JSON only. Be specific — vague claims like "the code is well-organized" are useless. Include file paths and function names.`;
}

export function makeComposePagePrompt(
  projectName: string,
  topic: string,
  pageKind: string,
): string {
  return `You are writing a wiki page about "${topic}" for the ${projectName} coding agent project.

Page kind: ${pageKind}

**Audience**: Developers building their own coding agents. They want to understand specific implementation patterns, design decisions, and trade-offs — not generic descriptions.

You will receive a list of extracted facts with source citations. Compose them into a well-structured wiki page.

## Format

Write in markdown with this structure:

## Summary
2-3 sentences. What this page covers and why it matters for someone building a coding agent.

## Key Insight
The single most important takeaway, stated directly. What would surprise or enlighten a developer trying to build something similar?

## Detail
Main content organized with ### subsections. For each major point:
- Explain the mechanism or pattern
- Include specific code references (file:line format)
- Note any trade-offs or alternatives when known
- Use code blocks for important interfaces or patterns

## Rules
- Every factual claim must be traceable to the provided sources
- Be specific: include file paths, function names, type signatures
- Focus on WHY decisions were made, not just WHAT exists
- If a fact has "low" confidence, phrase it as "appears to" or "likely"
- Write in a mix of English technical terms and Chinese explanations (matching the existing wiki style)
- Do NOT include a Sources or Related section — those are auto-generated

IMPORTANT: Return only the markdown content (starting from ## Summary). No frontmatter, no extra wrapper.`;
}

export function makeComparisonPagePrompt(topic: string): string {
  return `You are writing a cross-project comparison wiki page about "${topic}" across multiple coding agent projects.

**Audience**: Developers deciding how to implement ${topic} in their own coding agent. They need to understand the different approaches and trade-offs.

You will receive per-project analysis pages. Synthesize them into a comparison.

## Format

## Summary
2-3 sentences framing the comparison.

## Key Insight
The most important difference or convergence across projects.

## Detail

### Approach Comparison
A clear comparison of how each project handles this topic. Use a table where appropriate.

### Where They Converge
Common patterns that all or most projects share. These represent "industry consensus".

### Where They Diverge
Different approaches to the same problem, with trade-offs for each.

### Recommendation
If building a new coding agent, which approach to consider and when.

## Rules
- Be specific: reference actual code patterns, not abstract descriptions
- Focus on trade-offs, not just differences
- Write in a mix of English technical terms and Chinese explanations
- Do NOT include a Sources or Related section

IMPORTANT: Return only the markdown content (starting from ## Summary). No frontmatter.`;
}
