import { z } from "zod";

export const repoSchema = z.object({
  url: z.string().url(),
  name: z.string().optional(),
});

export const configSchema = z.object({
  repos: z.array(repoSchema).default([]),
  models: z
    .object({
      filter: z.string().default("claude-haiku-4-5-20251001"),
      compile: z.string().default("claude-sonnet-4-20250514"),
    })
    .default({}),
  outputDir: z.string().default("./wiki"),
  cacheDir: z.string().default("./.codewiki-cache"),
  limits: z
    .object({
      maxCommits: z.number().default(500),
      maxPRs: z.number().default(200),
      maxIssues: z.number().default(100),
      filterScoreThreshold: z.number().default(7),
      filterBatchSize: z.number().default(50),
    })
    .default({}),
});

export type RepoConfig = z.infer<typeof repoSchema>;
export type Config = z.infer<typeof configSchema>;

export const LAYERS = [
  "decision",
  "evolution",
  "constraint",
  "pitfall",
  "convention",
] as const;

export type Layer = (typeof LAYERS)[number];
