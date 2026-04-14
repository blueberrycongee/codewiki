import type { Layer } from "../config/schema.js";
import type { ExtractedFact } from "../types.js";

export interface PageMeta {
  id: string;
  title: string;
  layer: Layer;
  project: string;
  repo: string;
  confidence: "high" | "medium" | "low";
  sources: ExtractedFact["source"][];
  related: string[];
  summary: string;
  compilerModel: string;
  dataHash: string;
}

export function buildFrontmatter(meta: PageMeta): string {
  const sourcesYaml = meta.sources
    .slice(0, 10)
    .map(
      (s) =>
        `  - type: ${s.type}\n    url: ${s.url}\n    ref: "${s.ref}"`,
    )
    .join("\n");

  const relatedYaml = meta.related
    .map((r) => `  - "[[${r}]]"`)
    .join("\n");

  return `---
id: ${meta.id}
title: "${meta.title}"
layer: ${meta.layer}
project: ${meta.project}
repo: ${meta.repo}
confidence: ${meta.confidence}
sources:
${sourcesYaml}
related:
${relatedYaml}
compiled_at: "${new Date().toISOString().split("T")[0]}"
compiler_model: ${meta.compilerModel}
summary: "${meta.summary.replace(/"/g, "''")}"
data_hash: "${meta.dataHash}"
---

`;
}
