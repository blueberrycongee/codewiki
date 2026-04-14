import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import "dotenv/config";
import type { Config } from "../config/schema.js";
import type {
  CommitInfo,
  PRInfo,
  IssueInfo,
  ClosedPR,
  ClassifiedItem,
} from "../types.js";
import { LAYERS, type Layer } from "../config/schema.js";

const client = new Anthropic();

const CLASSIFY_PROMPT = `You are classifying items from a software project's history into knowledge layers.

The five layers are:
- decision: Design decisions — choosing between alternatives, trade-offs, "why X not Y"
- evolution: Significant changes — refactoring, migration, architecture shifts, major features
- constraint: Rules that must not be broken — invariants, safety checks, interface contracts
- pitfall: Failures and bugs — reverts, workarounds, hacks, surprising breakage
- convention: Coding patterns — repeated structures, naming rules, project idioms

For each item, return:
{
  "id": "<sha or number>",
  "layers": ["layer1", "layer2"],  // one or more layers, or empty if irrelevant
  "score": 0-10,                   // how valuable this item is (0=noise, 10=critical)
  "reasoning": "brief explanation"
}

Return a JSON array of these objects. Only include items with score >= 5.
Items can belong to multiple layers.`;

function loadJSON<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

export async function classifyRepo(
  repoSlug: string,
  config: Config,
): Promise<void> {
  const rawDir = path.join(config.cacheDir, repoSlug, "raw");
  const classifiedDir = path.join(config.cacheDir, repoSlug, "classified");
  fs.mkdirSync(classifiedDir, { recursive: true });

  // Load raw data
  const commits = loadJSON<CommitInfo[]>(path.join(rawDir, "git-log.json")) || [];
  const prs = loadJSON<PRInfo[]>(path.join(rawDir, "prs.json")) || [];
  const issues = loadJSON<IssueInfo[]>(path.join(rawDir, "issues.json")) || [];
  const closedPRs = loadJSON<ClosedPR[]>(path.join(rawDir, "closed-prs.json")) || [];

  // Build items to classify
  const items: { id: string; type: string; text: string }[] = [];

  for (const c of commits) {
    items.push({
      id: c.sha.slice(0, 8),
      type: "commit",
      text: `[${c.sha.slice(0, 8)}] ${c.message.slice(0, 200)} (${c.filesChanged} files, +${c.insertions}/-${c.deletions})`,
    });
  }

  for (const pr of prs) {
    items.push({
      id: String(pr.number),
      type: "pr",
      text: `PR #${pr.number}: ${pr.title} — ${(pr.body || "").slice(0, 300)} (${pr.files.length} files, +${pr.additions}/-${pr.deletions})`,
    });
  }

  for (const issue of issues) {
    items.push({
      id: String(issue.number),
      type: "issue",
      text: `Issue #${issue.number}: ${issue.title} — ${(issue.body || "").slice(0, 300)} [${issue.labels.join(", ")}]`,
    });
  }

  for (const pr of closedPRs) {
    items.push({
      id: `closed-${pr.number}`,
      type: "closed-pr",
      text: `Closed PR #${pr.number}: ${pr.title} — ${(pr.body || "").slice(0, 300)}`,
    });
  }

  console.log(`  ${items.length} items to classify (${commits.length} commits, ${prs.length} PRs, ${issues.length} issues, ${closedPRs.length} closed PRs)`);

  // Classify in batches
  const batchSize = config.limits.filterBatchSize;
  const allClassified: ClassifiedItem[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(items.length / batchSize);
    console.log(`  Batch ${batchNum}/${totalBatches}...`);

    try {
      const response = await client.messages.create({
        model: config.models.filter,
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: `${CLASSIFY_PROMPT}\n\nItems:\n${JSON.stringify(batch)}`,
          },
        ],
      });

      const text =
        response.content[0].type === "text" ? response.content[0].text : "";
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const results = JSON.parse(jsonMatch[0]) as ClassifiedItem[];
        for (const r of results) {
          // Find original item to get the type
          const original = batch.find((b) => b.id === r.id || b.id === `closed-${r.id}`);
          if (original) {
            r.type = original.type as ClassifiedItem["type"];
            r.title = original.text.slice(0, 100);
          }
          allClassified.push(r);
        }
      }
    } catch (e) {
      console.error(`  Batch ${batchNum} failed: ${e}`);
    }
  }

  // Split by layer and write
  for (const layer of LAYERS) {
    const layerItems = allClassified.filter(
      (item) => item.layers?.includes(layer) && item.score >= config.limits.filterScoreThreshold,
    );
    fs.writeFileSync(
      path.join(classifiedDir, `${layer}.json`),
      JSON.stringify(layerItems, null, 2),
    );
    console.log(`  ${layer}: ${layerItems.length} items`);
  }
}
