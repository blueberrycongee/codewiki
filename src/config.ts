import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, "..");

export const CACHE_DIR = path.join(ROOT_DIR, ".cache");
export const CONTENT_DIR = path.join(ROOT_DIR, "content");

export const projects = {
  opencode: {
    name: "OpenCode",
    repo: "opencode-ai/opencode",
    url: "https://github.com/opencode-ai/opencode",
    language: "Go",
    description: "Terminal AI coding agent with TUI interface",
  },
  openclaw: {
    name: "OpenClaw",
    repo: "openclaw/openclaw",
    url: "https://github.com/openclaw/openclaw",
    language: "TypeScript",
    description: "Autonomous AI agent via messaging platforms",
  },
  codex: {
    name: "Codex",
    repo: "openai/codex",
    url: "https://github.com/openai/codex",
    language: "TypeScript",
    description: "OpenAI lightweight coding agent for the terminal",
  },
} as const;

export type ProjectId = keyof typeof projects;
export const PROJECT_IDS = Object.keys(projects) as ProjectId[];

export const models = {
  filter: "claude-haiku-4-5-20251001",
  compile: "claude-sonnet-4-20250514",
} as const;

export const limits = {
  maxCommits: 500,
  maxPRs: 200,
  maxIssues: 100,
  filterScoreThreshold: 7,
  filterBatchSize: 50,
} as const;
