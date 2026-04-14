import fs from "node:fs";
import path from "node:path";
import { configSchema, type Config, type RepoConfig } from "./schema.js";

const CONFIG_FILENAME = "codewiki.json";

export function loadConfig(cwd: string = process.cwd()): Config {
  const configPath = path.join(cwd, CONFIG_FILENAME);
  let raw: Record<string, unknown> = {};

  if (fs.existsSync(configPath)) {
    raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  }

  const config = configSchema.parse(raw);

  // Resolve relative paths against cwd
  config.outputDir = path.resolve(cwd, config.outputDir);
  config.cacheDir = path.resolve(cwd, config.cacheDir);

  return config;
}

export function saveConfig(config: Config, cwd: string = process.cwd()): void {
  const configPath = path.join(cwd, CONFIG_FILENAME);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
}

export function repoSlug(url: string): string {
  // https://github.com/opencode-ai/opencode → opencode
  // https://github.com/openai/codex → codex
  const match = url.match(/github\.com\/([^/]+)\/([^/.]+)/);
  if (!match) {
    throw new Error(`Cannot parse repo URL: ${url}`);
  }
  return match[2];
}

export function repoFullName(url: string): string {
  // https://github.com/opencode-ai/opencode → opencode-ai/opencode
  const match = url.match(/github\.com\/([^/]+)\/([^/.]+)/);
  if (!match) {
    throw new Error(`Cannot parse repo URL: ${url}`);
  }
  return `${match[1]}/${match[2]}`;
}

export function addRepo(config: Config, url: string, name?: string): Config {
  const existing = config.repos.find((r) => r.url === url);
  if (existing) return config;

  const repo: RepoConfig = { url };
  if (name) repo.name = name;
  config.repos.push(repo);
  return config;
}
