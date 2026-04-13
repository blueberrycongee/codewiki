import { z } from "zod";

export const pageKinds = [
  "architecture",
  "mechanism",
  "pattern",
  "evolution",
  "comparison",
  "antipattern",
  "decision",
] as const;

export const confidenceLevels = ["high", "medium", "low"] as const;

export const sourceTypes = [
  "commit",
  "pr",
  "issue",
  "code",
  "readme",
] as const;

export const sourceSchema = z.object({
  type: z.enum(sourceTypes),
  url: z.string().url(),
  ref: z.string(),
  relevance: z.string(),
});

export const frontmatterSchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.enum(pageKinds),
  project: z.union([z.string(), z.array(z.string())]),
  topic: z.string(),
  confidence: z.enum(confidenceLevels),
  sources: z.array(sourceSchema),
  related: z.array(z.string()),
  compiled_at: z.string(),
  compiler_model: z.string(),
  summary: z.string(),
});

export type PageKind = z.infer<typeof frontmatterSchema>["kind"];
export type Confidence = z.infer<typeof frontmatterSchema>["confidence"];
export type Source = z.infer<typeof sourceSchema>;
export type Frontmatter = z.infer<typeof frontmatterSchema>;

export const PAGE_TEMPLATE = `\
## Summary

<!-- 2-3 sentences. What this page covers and why it matters. -->

## Key Insight

<!-- The single most important takeaway. -->

## Detail

<!-- Main content with ### subsections. Code snippets reference specific files + line ranges. -->

## Sources

<!-- Auto-generated from frontmatter sources. -->

## Related

<!-- Auto-generated from frontmatter related pages. -->
`;
