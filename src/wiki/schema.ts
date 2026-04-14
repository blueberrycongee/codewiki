import { z } from "zod";

// Support both old "kind" and new "layer" field names during migration
export const pageKinds = [
  "architecture",
  "mechanism",
  "pattern",
  "evolution",
  "comparison",
  "antipattern",
  "decision",
  "constraint",
  "pitfall",
  "convention",
] as const;

export const confidenceLevels = ["high", "medium", "low"] as const;

export const sourceTypes = [
  "commit",
  "pr",
  "issue",
  "code",
  "readme",
  "review",
] as const;

export const sourceSchema = z.object({
  type: z.enum(sourceTypes),
  url: z.string(),
  ref: z.string(),
  relevance: z.string().optional(),
});

export const frontmatterSchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.enum(pageKinds).optional(),
  layer: z.enum(pageKinds).optional(),
  project: z.union([z.string(), z.array(z.string())]),
  topic: z.string().optional(),
  repo: z.string().optional(),
  confidence: z.enum(confidenceLevels),
  sources: z.array(sourceSchema),
  related: z.array(z.string()),
  compiled_at: z.string(),
  compiler_model: z.string(),
  summary: z.string(),
  data_hash: z.string().optional(),
});

export type PageKind = z.infer<typeof frontmatterSchema>["kind"];
export type Confidence = z.infer<typeof frontmatterSchema>["confidence"];
export type Source = z.infer<typeof sourceSchema>;
export type Frontmatter = z.infer<typeof frontmatterSchema>;
