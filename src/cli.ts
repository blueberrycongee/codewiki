#!/usr/bin/env node
import "dotenv/config";
import { loadConfig, saveConfig, addRepo, repoSlug } from "./config/loader.js";
import { configSchema } from "./config/schema.js";

const args = process.argv.slice(2);
const command = args[0];

function printUsage() {
  console.log(`
codewiki — LLM-compiled code knowledge base

Usage:
  codewiki init                              Create codewiki.json
  codewiki compile <repo-url>                Compile wiki for a repo
  codewiki compile --all                     Compile all repos in config
  codewiki compile <repo-url> --layer <name> Compile single layer
  codewiki compile <repo-url> --force        Force recompile
  codewiki serve                             Start MCP server
  codewiki list                              List compiled wiki pages

Options:
  --layer <name>   Only compile: decision|evolution|constraint|pitfall|convention
  --force          Recompile even if pages exist
  --all            Compile all repos in codewiki.json

Environment:
  ANTHROPIC_API_KEY   Required for compile stage
`);
}

async function main() {
  if (!command || command === "--help" || command === "-h") {
    printUsage();
    process.exit(0);
  }

  switch (command) {
    case "init":
      await cmdInit();
      break;
    case "compile":
      await cmdCompile();
      break;
    case "serve":
      await cmdServe();
      break;
    case "list":
      await cmdList();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

async function cmdInit() {
  const config = configSchema.parse({});
  saveConfig(config);
  console.log("Created codewiki.json");
}

async function cmdCompile() {
  const config = loadConfig();
  const repoUrl = args[1];
  const isAll = args.includes("--all");
  const force = args.includes("--force");
  const layerIdx = args.indexOf("--layer");
  const layer = layerIdx !== -1 ? args[layerIdx + 1] : undefined;

  if (!repoUrl && !isAll) {
    console.error("Usage: codewiki compile <repo-url> or codewiki compile --all");
    process.exit(1);
  }

  // Determine which repos to compile
  let repos = config.repos;
  if (repoUrl && !isAll) {
    // Add repo to config if not already there
    addRepo(config, repoUrl);
    saveConfig(config);
    repos = [{ url: repoUrl }];
  }

  if (repos.length === 0) {
    console.error("No repos configured. Run: codewiki compile <repo-url>");
    process.exit(1);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY environment variable is required");
    process.exit(1);
  }

  // Import pipeline modules
  const { fetchRepo } = await import("./pipeline/fetch.js");
  const { classifyRepo } = await import("./pipeline/classify.js");
  const { compileRepo } = await import("./pipeline/compile.js");
  const { generateIndex } = await import("./output/index-generator.js");

  for (const repo of repos) {
    const slug = repoSlug(repo.url);
    console.log(`\n=== ${repo.name || slug} (${repo.url}) ===\n`);

    // Stage 1: Fetch
    console.log("Stage 1: Fetching data...");
    await fetchRepo(repo, config);

    // Stage 2: Classify
    console.log("\nStage 2: Classifying...");
    await classifyRepo(slug, config);

    // Stage 3: Compile
    console.log("\nStage 3: Compiling wiki pages...");
    await compileRepo(slug, config, { force, layer });
  }

  // Stage 4: Index
  console.log("\nStage 4: Generating index...");
  await generateIndex(config);

  console.log("\nDone.");
}

async function cmdServe() {
  // Server module handles its own startup
  await import("./server/index.js");
}

async function cmdList() {
  const config = loadConfig();
  const { listPages } = await import("./wiki/index.js");
  const pages = listPages(config.outputDir);

  if (pages.length === 0) {
    console.log("No wiki pages compiled yet. Run: codewiki compile <repo-url>");
    return;
  }

  console.log(`${pages.length} pages:\n`);
  for (const page of pages) {
    console.log(`  ${page.id} (${page.layer}) — ${page.summary}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
