import fs from "node:fs";
import path from "node:path";
import type { Config } from "../config/schema.js";
import { LAYERS } from "../config/schema.js";

export async function generateIndex(config: Config): Promise<void> {
  const outputDir = config.outputDir;
  if (!fs.existsSync(outputDir)) return;

  const repos = fs
    .readdirSync(outputDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
    .map((d) => d.name);

  let index = `# CodeWiki Index\n\n`;
  index += `> LLM-compiled code knowledge base — five layers of knowledge per project.\n\n`;

  for (const repo of repos) {
    const repoDir = path.join(outputDir, repo);
    const pages = fs
      .readdirSync(repoDir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(".md", ""));

    index += `## ${repo}\n\n`;
    for (const layer of LAYERS) {
      if (pages.includes(layer)) {
        index += `- [[${repo}/${layer}]]\n`;
      }
    }
    index += "\n";
  }

  fs.writeFileSync(path.join(outputDir, "_index.md"), index);
  console.log(`  Wrote: ${outputDir}/_index.md (${repos.length} repos)`);
}
