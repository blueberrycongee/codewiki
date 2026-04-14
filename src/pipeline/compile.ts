import Anthropic from "@anthropic-ai/sdk";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import "dotenv/config";
import type { Config, Layer } from "../config/schema.js";
import { LAYERS } from "../config/schema.js";
import { repoFullName } from "../config/loader.js";
import type { ClassifiedItem, ExtractedFact } from "../types.js";
import { ALL_LAYERS, getLayer } from "./layers/index.js";
import { buildFrontmatter, type PageMeta } from "../output/markdown.js";

const client = new Anthropic();

function loadJSON<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function readFileFromRepo(
  cacheDir: string,
  repoSlug: string,
  relativePath: string,
  maxLines = 400,
): string | null {
  const fullPath = path.join(cacheDir, repoSlug, "repo", relativePath);
  if (!fs.existsSync(fullPath)) return null;
  const content = fs.readFileSync(fullPath, "utf-8");
  const lines = content.split("\n");
  if (lines.length > maxLines) {
    return lines.slice(0, maxLines).join("\n") + "\n\n... (truncated)";
  }
  return content;
}

function computeDataHash(data: unknown): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(data))
    .digest("hex")
    .slice(0, 12);
}

async function extractFacts(
  repoSlug: string,
  repoName: string,
  fullName: string,
  layer: Layer,
  classifiedItems: ClassifiedItem[],
  config: Config,
): Promise<ExtractedFact[]> {
  const layerDef = getLayer(layer);

  // Build context from classified items
  const contextParts: string[] = [];

  // Add classified items
  const itemsText = classifiedItems
    .sort((a, b) => b.score - a.score)
    .slice(0, 30)
    .map((item) => `[${item.type}] ${item.title} (score: ${item.score}) — ${item.reasoning}`)
    .join("\n");

  if (itemsText) {
    contextParts.push(`=== Classified Items (${classifiedItems.length} total, showing top 30) ===\n${itemsText}`);
  }

  // Add directory tree
  const tree = loadJSON<string>(
    path.join(config.cacheDir, repoSlug, "raw", "tree.txt"),
  );
  if (tree) {
    contextParts.push(`=== Directory Tree ===\n${tree}`);
  } else {
    const treePath = path.join(config.cacheDir, repoSlug, "raw", "tree.txt");
    if (fs.existsSync(treePath)) {
      const treeContent = fs.readFileSync(treePath, "utf-8");
      contextParts.push(`=== Directory Tree ===\n${treeContent}`);
    }
  }

  // Add key source files (README, main entry points)
  for (const file of ["README.md", "main.go", "package.json", "Cargo.toml", "src/index.ts", "src/main.ts", "cmd/root.go"]) {
    const content = readFileFromRepo(config.cacheDir, repoSlug, file);
    if (content) {
      contextParts.push(`=== File: ${file} ===\n${content}`);
    }
  }

  // Add PR review comments for decision/constraint layers
  if (layer === "decision" || layer === "constraint") {
    const reviews = loadJSON<any[]>(
      path.join(config.cacheDir, repoSlug, "raw", "pr-reviews.json"),
    );
    if (reviews && reviews.length > 0) {
      const reviewText = reviews
        .slice(0, 20)
        .map((r) => `PR #${r.prNumber} (${r.author}): ${r.body}`)
        .join("\n---\n");
      contextParts.push(`=== PR Review Comments ===\n${reviewText}`);
    }
  }

  const context = contextParts.join("\n\n");
  if (!context.trim()) {
    console.warn(`  [${layer}] No context available, skipping`);
    return [];
  }

  const prompt = layerDef.extractFactsPrompt(repoName, fullName);

  console.log(`  [${layer}] Extracting facts (~${Math.round(context.length / 4)} tokens)...`);

  const response = await client.messages.create({
    model: config.models.compile,
    max_tokens: 8192,
    messages: [
      {
        role: "user",
        content: `${prompt}\n\n--- SOURCE MATERIAL ---\n\n${context}`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return parsed.facts || [];
    }
  } catch (e) {
    console.error(`  [${layer}] Failed to parse facts: ${e}`);
  }
  return [];
}

async function composePage(
  repoName: string,
  layer: Layer,
  facts: ExtractedFact[],
  config: Config,
): Promise<string> {
  const layerDef = getLayer(layer);
  const prompt = layerDef.composePagePrompt(repoName);

  const factsText = facts
    .map(
      (f, i) =>
        `${i + 1}. [${f.confidence}] ${f.claim}\n   Source: ${f.source.type} — ${f.source.ref}\n   URL: ${f.source.url}`,
    )
    .join("\n\n");

  console.log(`  [${layer}] Composing page from ${facts.length} facts...`);

  const response = await client.messages.create({
    model: config.models.compile,
    max_tokens: 8192,
    messages: [
      {
        role: "user",
        content: `${prompt}\n\n--- EXTRACTED FACTS (${facts.length}) ---\n\n${factsText}`,
      },
    ],
  });

  return response.content[0].type === "text"
    ? response.content[0].text
    : "";
}

export async function compileRepo(
  repoSlug: string,
  config: Config,
  opts: { force?: boolean; layer?: string } = {},
): Promise<void> {
  const repo = config.repos.find((r) => {
    try {
      const { repoSlug: rs } = await_import_workaround(r.url);
      return rs === repoSlug;
    } catch {
      return false;
    }
  });

  const repoName = repo?.name || repoSlug;
  let fullName: string;
  try {
    fullName = repoFullName(repo?.url || `https://github.com/x/${repoSlug}`);
  } catch {
    fullName = repoSlug;
  }

  const outputDir = path.join(config.outputDir, repoSlug);
  fs.mkdirSync(outputDir, { recursive: true });

  const layersToCompile = opts.layer
    ? [opts.layer as Layer]
    : [...LAYERS];

  for (const layer of layersToCompile) {
    const outPath = path.join(outputDir, `${layer}.md`);

    // Load classified data
    const classifiedPath = path.join(
      config.cacheDir,
      repoSlug,
      "classified",
      `${layer}.json`,
    );
    const classifiedItems =
      loadJSON<ClassifiedItem[]>(classifiedPath) || [];

    // Check data hash for incremental compile
    const dataHash = computeDataHash(classifiedItems);
    if (!opts.force && fs.existsSync(outPath)) {
      const existing = fs.readFileSync(outPath, "utf-8");
      if (existing.includes(`data_hash: "${dataHash}"`)) {
        console.log(`  [${layer}] Up to date, skipping`);
        continue;
      }
    }

    console.log(`\n  [${layer}] Compiling...`);

    // Phase 1: Extract facts
    const facts = await extractFacts(
      repoSlug,
      repoName,
      fullName,
      layer,
      classifiedItems,
      config,
    );

    if (facts.length === 0) {
      console.warn(`  [${layer}] No facts extracted, skipping`);
      continue;
    }
    console.log(`  [${layer}] ${facts.length} facts extracted`);

    // Save intermediate facts
    const factsDir = path.join(config.cacheDir, repoSlug, "facts");
    fs.mkdirSync(factsDir, { recursive: true });
    fs.writeFileSync(
      path.join(factsDir, `${layer}.json`),
      JSON.stringify(facts, null, 2),
    );

    // Phase 2: Compose page
    const content = await composePage(repoName, layer, facts, config);
    if (!content.trim()) {
      console.warn(`  [${layer}] Empty content, skipping`);
      continue;
    }

    // Build frontmatter
    const highFacts = facts.filter((f) => f.confidence === "high");
    const confidence =
      highFacts.length > facts.length * 0.5
        ? "high"
        : highFacts.length > facts.length * 0.2
          ? "medium"
          : ("low" as const);

    const summaryMatch = content.match(
      /## Summary\s*\n\s*([\s\S]*?)(?=\n##|\n\n##)/,
    );
    const summary = summaryMatch
      ? summaryMatch[1].trim().split("\n")[0].slice(0, 200)
      : `${repoName} ${layer} analysis`;

    const relatedLayers = LAYERS.filter((l) => l !== layer).map(
      (l) => `${repoSlug}/${l}`,
    );

    const meta: PageMeta = {
      id: `${repoSlug}/${layer}`,
      title: `${repoName} — ${getLayer(layer).description}`,
      layer,
      project: repoSlug,
      repo: fullName,
      confidence,
      sources: facts
        .filter((f) => f.confidence !== "low")
        .slice(0, 10)
        .map((f) => f.source),
      related: relatedLayers,
      summary,
      compilerModel: config.models.compile,
      dataHash,
    };

    const fullPage = buildFrontmatter(meta) + content;
    fs.writeFileSync(outPath, fullPage);
    console.log(`  [${layer}] Wrote: ${outPath}`);
  }
}

// Workaround for sync repo lookup
function await_import_workaround(url: string) {
  const match = url.match(/github\.com\/([^/]+)\/([^/.]+)/);
  return { repoSlug: match?.[2] || "" };
}
