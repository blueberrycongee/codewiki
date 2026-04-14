import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import "dotenv/config";
import {
  CACHE_DIR,
  models,
  limits,
  projects,
  type ProjectId,
  PROJECT_IDS,
} from "../config.js";
import type { CommitInfo, PRInfo, ScoredCommit, ScoredPR } from "../types.js";
import { FILTER_COMMITS_PROMPT, FILTER_PRS_PROMPT } from "./prompts.js";

const client = new Anthropic();

function loadJSON<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

async function filterCommits(
  projectId: ProjectId,
): Promise<ScoredCommit[]> {
  const logPath = path.join(CACHE_DIR, "git-logs", `${projectId}.json`);
  if (!fs.existsSync(logPath)) {
    console.error(`[${projectId}] No git log found at ${logPath}`);
    return [];
  }

  const commits = loadJSON<CommitInfo[]>(logPath);
  console.log(
    `[${projectId}] Filtering ${commits.length} commits in batches of ${limits.filterBatchSize}...`,
  );

  const allScored: ScoredCommit[] = [];

  for (let i = 0; i < commits.length; i += limits.filterBatchSize) {
    const batch = commits.slice(i, i + limits.filterBatchSize);
    const batchInput = batch.map((c) => ({
      sha: c.sha.slice(0, 8),
      message: c.message.slice(0, 200),
    }));

    const batchNum = Math.floor(i / limits.filterBatchSize) + 1;
    const totalBatches = Math.ceil(commits.length / limits.filterBatchSize);
    console.log(`  Batch ${batchNum}/${totalBatches}...`);

    try {
      const response = await client.messages.create({
        model: models.filter,
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: `${FILTER_COMMITS_PROMPT}\n\nCommits:\n${JSON.stringify(batchInput)}`,
          },
        ],
      });

      const text =
        response.content[0].type === "text" ? response.content[0].text : "";
      // Try to extract JSON from potential markdown code blocks
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const scored: ScoredCommit[] = JSON.parse(jsonMatch[0]);
        allScored.push(...scored);
      }

    } catch (e) {
      console.error(`  Batch ${batchNum} failed: ${e}`);
    }
  }

  return allScored;
}

async function filterPRs(projectId: ProjectId): Promise<ScoredPR[]> {
  const prPath = path.join(CACHE_DIR, "pr-data", `${projectId}.json`);
  if (!fs.existsSync(prPath)) {
    console.warn(`[${projectId}] No PR data found`);
    return [];
  }

  const prs = loadJSON<PRInfo[]>(prPath);
  console.log(
    `[${projectId}] Filtering ${prs.length} PRs in batches of ${limits.filterBatchSize}...`,
  );

  const allScored: ScoredPR[] = [];

  for (let i = 0; i < prs.length; i += limits.filterBatchSize) {
    const batch = prs.slice(i, i + limits.filterBatchSize);
    const batchInput = batch.map((pr) => ({
      number: pr.number,
      title: pr.title,
      body: (pr.body || "").slice(0, 500),
    }));

    const batchNum = Math.floor(i / limits.filterBatchSize) + 1;
    const totalBatches = Math.ceil(prs.length / limits.filterBatchSize);
    console.log(`  Batch ${batchNum}/${totalBatches}...`);

    try {
      const response = await client.messages.create({
        model: models.filter,
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: `${FILTER_PRS_PROMPT}\n\nPRs:\n${JSON.stringify(batchInput)}`,
          },
        ],
      });

      const text =
        response.content[0].type === "text" ? response.content[0].text : "";
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const scored: ScoredPR[] = JSON.parse(jsonMatch[0]);
        allScored.push(...scored);
      }

    } catch (e) {
      console.error(`  Batch ${batchNum} failed: ${e}`);
    }
  }

  return allScored;
}

async function filterProject(projectId: ProjectId) {
  console.log(`\n=== Filtering ${projects[projectId].name} ===\n`);

  const outDir = path.join(CACHE_DIR, "intermediate", projectId);
  ensureDir(outDir);

  // Filter commits
  const scoredCommits = await filterCommits(projectId);
  const highCommits = scoredCommits.filter(
    (c) => c.score >= limits.filterScoreThreshold,
  );
  fs.writeFileSync(
    path.join(outDir, "scored-commits.json"),
    JSON.stringify(scoredCommits, null, 2),
  );
  console.log(
    `[${projectId}] Commits: ${scoredCommits.length} scored, ${highCommits.length} high-value (>=${limits.filterScoreThreshold})`,
  );

  // Filter PRs
  const scoredPRs = await filterPRs(projectId);
  const highPRs = scoredPRs.filter(
    (p) => p.score >= limits.filterScoreThreshold,
  );
  fs.writeFileSync(
    path.join(outDir, "scored-prs.json"),
    JSON.stringify(scoredPRs, null, 2),
  );
  console.log(
    `[${projectId}] PRs: ${scoredPRs.length} scored, ${highPRs.length} high-value (>=${limits.filterScoreThreshold})`,
  );

  console.log(`\n=== Done: ${projects[projectId].name} ===\n`);
}

// CLI entry
const targetProject = process.argv[2] as ProjectId | undefined;

if (targetProject && projects[targetProject]) {
  await filterProject(targetProject);
} else if (!targetProject) {
  for (const id of PROJECT_IDS) {
    await filterProject(id);
  }
} else {
  console.error(
    `Unknown project: ${targetProject}. Available: ${PROJECT_IDS.join(", ")}`,
  );
  process.exit(1);
}
