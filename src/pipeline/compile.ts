import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import "dotenv/config";
import {
  CACHE_DIR,
  CONTENT_DIR,
  models,
  projects,
  type ProjectId,
  PROJECT_IDS,
} from "../config.js";
import type {
  ScoredCommit,
  ScoredPR,
  PRInfo,
  ExtractedFact,
} from "../types.js";
import type { PageKind, Source } from "../wiki/schema.js";
import {
  makeExtractFactsPrompt,
  makeComposePagePrompt,
  makeComparisonPagePrompt,
} from "./prompts.js";

const client = new Anthropic();

// --- Page definitions ---

interface PageDef {
  topic: string;
  kind: PageKind;
  description: string;
  topicTags: string[]; // match against scored commits/PRs
  keyFiles: string[]; // files to read from repo
}

const PROJECT_PAGES: PageDef[] = [
  {
    topic: "architecture",
    kind: "architecture",
    description:
      "System architecture overview: components, entry points, data flow, dependency graph",
    topicTags: ["architecture"],
    keyFiles: [
      "README.md",
      "main.go",
      "cmd/root.go",
      "internal/app/app.go",
      // TS projects
      "package.json",
      "src/index.ts",
      "src/main.ts",
      "codex-cli/src/cli.ts",
      "codex-cli/src/utils/agent/agent-loop.ts",
    ],
  },
  {
    topic: "conversation-loop",
    kind: "mechanism",
    description:
      "How the agent manages multi-turn LLM interaction: the core loop, message history, streaming, retries",
    topicTags: ["agent-loop", "architecture"],
    keyFiles: [
      "internal/llm/agent/agent.go",
      "codex-cli/src/utils/agent/agent-loop.ts",
    ],
  },
  {
    topic: "tool-system",
    kind: "mechanism",
    description:
      "How tools are defined, registered, dispatched, and results handled",
    topicTags: ["tool-system"],
    keyFiles: [
      "internal/llm/tools/tools.go",
      "internal/llm/agent/tools.go",
      "internal/llm/tools/bash.go",
      "internal/llm/tools/edit.go",
      "codex-cli/src/tools.ts",
    ],
  },
  {
    topic: "sandbox-execution",
    kind: "mechanism",
    description:
      "How code execution is sandboxed and secured: permissions, approval flows, isolation",
    topicTags: ["sandbox-security"],
    keyFiles: [
      "internal/permission/permission.go",
      "internal/llm/tools/bash.go",
      "codex-cli/src/utils/agent/sandbox.ts",
    ],
  },
  {
    topic: "context-management",
    kind: "mechanism",
    description:
      "How context window is managed: auto-compact, summarization, token counting, message pruning",
    topicTags: ["context-management", "session-management"],
    keyFiles: [
      "internal/llm/prompt/summarizer.go",
      "internal/session/session.go",
      "internal/llm/prompt/coder.go",
    ],
  },
];

const COMPARISON_PAGES = [
  {
    topic: "architecture-overview",
    description: "High-level architecture comparison",
    sourcePages: ["architecture"],
  },
  {
    topic: "tool-execution-models",
    description: "Tool definition, dispatch, and execution comparison",
    sourcePages: ["tool-system"],
  },
  {
    topic: "safety-models",
    description: "Sandboxing, permissions, and security comparison",
    sourcePages: ["sandbox-execution"],
  },
  {
    topic: "conversation-management",
    description: "Agent loop and context management comparison",
    sourcePages: ["conversation-loop", "context-management"],
  },
  {
    topic: "language-tradeoffs",
    description: "Go vs TypeScript for coding agents",
    sourcePages: ["architecture"],
  },
];

// --- Helpers ---

function loadJSON<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function readFileFromRepo(
  projectId: ProjectId,
  relativePath: string,
): string | null {
  const fullPath = path.join(
    CACHE_DIR,
    "repos",
    projectId,
    relativePath,
  );
  if (!fs.existsSync(fullPath)) return null;
  const content = fs.readFileSync(fullPath, "utf-8");
  // Limit to 300 lines for context window management
  const lines = content.split("\n");
  if (lines.length > 300) {
    return lines.slice(0, 300).join("\n") + "\n\n... (truncated)";
  }
  return content;
}

function getHighValueCommits(
  projectId: ProjectId,
  topicTags: string[],
): ScoredCommit[] {
  const scored = loadJSON<ScoredCommit[]>(
    path.join(CACHE_DIR, "intermediate", projectId, "scored-commits.json"),
  );
  if (!scored) return [];
  return scored
    .filter(
      (c) =>
        c.score >= 7 &&
        c.topicTags?.some((t) => topicTags.includes(t)),
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
}

function getHighValuePRs(
  projectId: ProjectId,
  topicTags: string[],
): ScoredPR[] {
  const scored = loadJSON<ScoredPR[]>(
    path.join(CACHE_DIR, "intermediate", projectId, "scored-prs.json"),
  );
  if (!scored) return [];
  return scored
    .filter(
      (p) =>
        p.score >= 7 &&
        p.topicTags?.some((t) => topicTags.includes(t)),
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, 15);
}

function getPRBodies(
  projectId: ProjectId,
  prNumbers: number[],
): Map<number, string> {
  const prs = loadJSON<PRInfo[]>(
    path.join(CACHE_DIR, "pr-data", `${projectId}.json`),
  );
  if (!prs) return new Map();
  const map = new Map<number, string>();
  for (const pr of prs) {
    if (prNumbers.includes(pr.number)) {
      map.set(pr.number, (pr.body || "").slice(0, 1000));
    }
  }
  return map;
}

// --- Core compilation ---

async function extractFacts(
  projectId: ProjectId,
  pageDef: PageDef,
): Promise<ExtractedFact[]> {
  const project = projects[projectId];

  // Gather context
  const contextParts: string[] = [];

  // 1. Key files
  for (const file of pageDef.keyFiles) {
    const content = readFileFromRepo(projectId, file);
    if (content) {
      contextParts.push(`=== File: ${file} ===\n${content}`);
    }
  }

  // 2. Directory tree
  const treePath = path.join(CACHE_DIR, "repos", projectId, ".tree.txt");
  if (fs.existsSync(treePath)) {
    const tree = fs.readFileSync(treePath, "utf-8");
    contextParts.push(`=== Directory Tree ===\n${tree}`);
  }

  // 3. High-value commits
  const commits = getHighValueCommits(projectId, pageDef.topicTags);
  if (commits.length > 0) {
    const commitText = commits
      .map((c) => `[${c.sha}] (score:${c.score}) ${c.message}`)
      .join("\n");
    contextParts.push(
      `=== High-Value Commits (${commits.length}) ===\n${commitText}`,
    );
  }

  // 4. High-value PR descriptions
  const prs = getHighValuePRs(projectId, pageDef.topicTags);
  if (prs.length > 0) {
    const prBodies = getPRBodies(
      projectId,
      prs.map((p) => p.number),
    );
    const prText = prs
      .map((p) => {
        const body = prBodies.get(p.number) || "";
        return `PR #${p.number}: ${p.title} (score:${p.score})\n${body}`;
      })
      .join("\n---\n");
    contextParts.push(
      `=== High-Value PRs (${prs.length}) ===\n${prText}`,
    );
  }

  const context = contextParts.join("\n\n");
  if (!context.trim()) {
    console.warn(
      `  [${projectId}/${pageDef.topic}] No context available, skipping fact extraction`,
    );
    return [];
  }

  const systemPrompt = makeExtractFactsPrompt(
    project.name,
    pageDef.topic,
    pageDef.description,
  );

  console.log(
    `  Extracting facts (context: ~${Math.round(context.length / 4)} tokens)...`,
  );

  const response = await client.messages.create({
    model: models.compile,
    max_tokens: 8192,
    messages: [
      {
        role: "user",
        content: `${systemPrompt}\n\n--- SOURCE MATERIAL ---\n\n${context}`,
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
    console.error(`  Failed to parse facts: ${e}`);
  }
  return [];
}

async function composePage(
  projectId: ProjectId,
  pageDef: PageDef,
  facts: ExtractedFact[],
): Promise<string> {
  const project = projects[projectId];

  const systemPrompt = makeComposePagePrompt(
    project.name,
    pageDef.topic,
    pageDef.kind,
  );

  const factsText = facts
    .map(
      (f, i) =>
        `${i + 1}. [${f.confidence}] ${f.claim}\n   Source: ${f.source.type} — ${f.source.ref}\n   URL: ${f.source.url}`,
    )
    .join("\n\n");

  console.log(`  Composing page from ${facts.length} facts...`);

  const response = await client.messages.create({
    model: models.compile,
    max_tokens: 8192,
    messages: [
      {
        role: "user",
        content: `${systemPrompt}\n\n--- EXTRACTED FACTS (${facts.length}) ---\n\n${factsText}`,
      },
    ],
  });

  return response.content[0].type === "text"
    ? response.content[0].text
    : "";
}

function buildFrontmatter(
  projectId: ProjectId,
  pageDef: PageDef,
  facts: ExtractedFact[],
  content: string,
): string {
  const project = projects[projectId];
  const sources: Source[] = facts
    .filter((f) => f.confidence !== "low")
    .slice(0, 10)
    .map((f) => ({
      type: f.source.type as Source["type"],
      url: f.source.url || `https://github.com/${project.repo}`,
      ref: f.source.ref,
      relevance: f.relevance || f.claim.slice(0, 80),
    }));

  // Extract first sentence as summary
  const summaryMatch = content.match(
    /## Summary\s*\n\s*([\s\S]*?)(?=\n##|\n\n##)/,
  );
  const summary = summaryMatch
    ? summaryMatch[1].trim().split("\n")[0].slice(0, 200)
    : `${project.name} 的 ${pageDef.topic} 分析`;

  const related = PROJECT_PAGES.filter((p) => p.topic !== pageDef.topic)
    .map((p) => `${projectId}/${p.topic}`)
    .slice(0, 4);

  // Determine overall confidence
  const highCount = facts.filter((f) => f.confidence === "high").length;
  const confidence =
    highCount > facts.length * 0.5
      ? "high"
      : highCount > facts.length * 0.2
        ? "medium"
        : "low";

  const fm = `---
id: ${projectId}/${pageDef.topic}
title: "${project.name} ${pageDef.description.split(":")[0]}"
kind: ${pageDef.kind}
project: ${projectId}
topic: ${pageDef.topic}
confidence: ${confidence}
sources:
${sources.map((s) => `  - type: ${s.type}\n    url: ${s.url}\n    ref: "${s.ref}"\n    relevance: "${s.relevance.replace(/"/g, "''")}"`).join("\n")}
related: [${related.join(", ")}]
compiled_at: "${new Date().toISOString().split("T")[0]}"
compiler_model: ${models.compile}
summary: "${summary.replace(/"/g, "''")}"
---

`;

  return fm;
}

async function compileProjectPage(
  projectId: ProjectId,
  pageDef: PageDef,
) {
  const outPath = path.join(
    CONTENT_DIR,
    projectId,
    `${pageDef.topic}.md`,
  );

  // Skip if already exists (use --force to recompile)
  if (fs.existsSync(outPath) && !process.argv.includes("--force")) {
    console.log(`  [${projectId}/${pageDef.topic}] Already exists, skipping (use --force to recompile)`);
    return;
  }

  console.log(`\n  [${projectId}/${pageDef.topic}] Compiling...`);

  // Phase 1: Extract facts
  const facts = await extractFacts(projectId, pageDef);
  if (facts.length === 0) {
    console.warn(`  No facts extracted, skipping page`);
    return;
  }
  console.log(`  Extracted ${facts.length} facts`);

  // Save intermediate facts
  const factsDir = path.join(
    CACHE_DIR,
    "intermediate",
    projectId,
    "facts",
  );
  fs.mkdirSync(factsDir, { recursive: true });
  fs.writeFileSync(
    path.join(factsDir, `${pageDef.topic}.json`),
    JSON.stringify(facts, null, 2),
  );

  // Phase 2: Compose page
  const content = await composePage(projectId, pageDef, facts);
  if (!content.trim()) {
    console.warn(`  Empty content, skipping page`);
    return;
  }

  // Build final page with frontmatter
  const frontmatter = buildFrontmatter(projectId, pageDef, facts, content);
  const fullPage = frontmatter + content;

  // Write
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, fullPage);
  console.log(`  Wrote: ${outPath}`);
}

async function compileComparisonPage(
  compDef: (typeof COMPARISON_PAGES)[0],
) {
  const outPath = path.join(
    CONTENT_DIR,
    "comparisons",
    `${compDef.topic}.md`,
  );

  if (fs.existsSync(outPath) && !process.argv.includes("--force")) {
    console.log(`  [comparisons/${compDef.topic}] Already exists, skipping`);
    return;
  }

  console.log(`\n  [comparisons/${compDef.topic}] Compiling comparison...`);

  // Gather per-project pages
  const projectContents: string[] = [];
  for (const pid of PROJECT_IDS) {
    for (const sourceTopic of compDef.sourcePages) {
      const pagePath = path.join(CONTENT_DIR, pid, `${sourceTopic}.md`);
      if (fs.existsSync(pagePath)) {
        const content = fs.readFileSync(pagePath, "utf-8");
        // Strip frontmatter
        const bodyMatch = content.match(/---\n[\s\S]*?\n---\n([\s\S]*)/);
        const body = bodyMatch ? bodyMatch[1] : content;
        projectContents.push(
          `=== ${projects[pid].name} (${pid}) — ${sourceTopic} ===\n${body}`,
        );
      }
    }
  }

  if (projectContents.length < 2) {
    console.warn(`  Not enough project pages for comparison, skipping`);
    return;
  }

  const systemPrompt = makeComparisonPagePrompt(compDef.topic);
  const context = projectContents.join("\n\n---\n\n");

  const response = await client.messages.create({
    model: models.compile,
    max_tokens: 8192,
    messages: [
      {
        role: "user",
        content: `${systemPrompt}\n\n--- PER-PROJECT ANALYSES ---\n\n${context}`,
      },
    ],
  });

  const content =
    response.content[0].type === "text" ? response.content[0].text : "";

  // Build comparison frontmatter
  const summary = content
    .match(/## Summary\s*\n\s*([\s\S]*?)(?=\n##)/)?.[1]
    ?.trim()
    .split("\n")[0]
    .slice(0, 200) || compDef.description;

  const fm = `---
id: comparisons/${compDef.topic}
title: "跨项目对比: ${compDef.description}"
kind: comparison
project: [${PROJECT_IDS.join(", ")}]
topic: ${compDef.topic}
confidence: medium
sources: []
related: [${PROJECT_IDS.map((pid) => compDef.sourcePages.map((t) => `${pid}/${t}`)).flat().join(", ")}]
compiled_at: "${new Date().toISOString().split("T")[0]}"
compiler_model: ${models.compile}
summary: "${summary.replace(/"/g, "''")}"
---

`;

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, fm + content);
  console.log(`  Wrote: ${outPath}`);
}

async function generateIndex() {
  console.log("\nGenerating index...");
  const { listPages } = await import("../wiki/index.js");
  const pages = listPages();

  const byProject: Record<string, typeof pages> = {};
  const comparisons: typeof pages = [];

  for (const page of pages) {
    if (page.kind === "comparison") {
      comparisons.push(page);
    } else {
      const pid = Array.isArray(page.project)
        ? page.project[0]
        : page.project;
      if (!byProject[pid]) byProject[pid] = [];
      byProject[pid].push(page);
    }
  }

  let index = `# CodeWiki Index\n\n`;
  index += `> LLM-compiled knowledge base for coding agent patterns.\n`;
  index += `> ${pages.length} pages across ${Object.keys(byProject).length} projects.\n\n`;

  for (const [pid, projectPages] of Object.entries(byProject)) {
    const project = projects[pid as ProjectId];
    index += `## ${project?.name || pid}\n\n`;
    for (const page of projectPages) {
      index += `- **[${page.title}](${page.id}.md)** (${page.kind}, ${page.confidence}) — ${page.summary}\n`;
    }
    index += "\n";
  }

  if (comparisons.length > 0) {
    index += `## Cross-Project Comparisons\n\n`;
    for (const page of comparisons) {
      index += `- **[${page.title}](${page.id}.md)** — ${page.summary}\n`;
    }
  }

  fs.writeFileSync(path.join(CONTENT_DIR, "_index.md"), index);
  console.log(`Wrote: content/_index.md (${pages.length} pages indexed)`);
}

// --- CLI ---

async function main() {
  const targetProject = process.argv[2] as ProjectId | "comparisons" | "index" | "all" | undefined;

  if (targetProject === "index") {
    await generateIndex();
    return;
  }

  if (targetProject === "comparisons") {
    for (const compDef of COMPARISON_PAGES) {
      await compileComparisonPage(compDef);
    }
    await generateIndex();
    return;
  }

  if (targetProject && targetProject !== "all" && projects[targetProject as ProjectId]) {
    console.log(`\n=== Compiling ${projects[targetProject as ProjectId].name} ===`);
    for (const pageDef of PROJECT_PAGES) {
      await compileProjectPage(targetProject as ProjectId, pageDef);
    }
    await generateIndex();
    return;
  }

  // Default: compile all
  for (const pid of PROJECT_IDS) {
    console.log(`\n=== Compiling ${projects[pid].name} ===`);
    for (const pageDef of PROJECT_PAGES) {
      await compileProjectPage(pid, pageDef);
    }
  }

  console.log("\n=== Compiling Comparisons ===");
  for (const compDef of COMPARISON_PAGES) {
    await compileComparisonPage(compDef);
  }

  await generateIndex();
}

main().catch(console.error);
