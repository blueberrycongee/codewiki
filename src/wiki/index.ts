import fs from "node:fs";
import path from "node:path";
import { CONTENT_DIR } from "../config.js";
import { frontmatterSchema, type Frontmatter } from "./schema.js";

export interface WikiPage {
  frontmatter: Frontmatter;
  content: string;
  rawMarkdown: string;
}

function parseFrontmatter(raw: string): {
  frontmatter: Record<string, unknown>;
  content: string;
} {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, content: raw };

  const yamlBlock = match[1];
  const content = match[2];

  // Simple YAML parser for our flat-ish frontmatter
  const frontmatter: Record<string, unknown> = {};
  let currentKey = "";
  let currentArray: unknown[] | null = null;

  for (const line of yamlBlock.split("\n")) {
    const keyMatch = line.match(/^(\w[\w_]*)\s*:\s*(.*)$/);
    if (keyMatch) {
      if (currentArray && currentKey) {
        frontmatter[currentKey] = currentArray;
        currentArray = null;
      }
      const [, key, value] = keyMatch;
      currentKey = key;

      // Array on same line: [a, b, c]
      if (value.startsWith("[") && value.endsWith("]")) {
        frontmatter[key] = value
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim().replace(/^["']|["']$/g, ""));
      }
      // String value
      else if (value.startsWith('"') && value.endsWith('"')) {
        frontmatter[key] = value.slice(1, -1);
      }
      // Bare value
      else if (value.trim()) {
        frontmatter[key] = value.trim();
      }
      // Empty = start of array or object
      else {
        currentArray = [];
      }
    } else if (currentArray !== null) {
      const arrayItemMatch = line.match(/^\s+-\s+(.*)/);
      if (arrayItemMatch) {
        const val = arrayItemMatch[1].trim();
        // Check if it's a source object (has type: prefix)
        if (val.startsWith("type:")) {
          // This is a new source object, parse inline
          // But sources use multi-line YAML, handle below
        }
        currentArray.push(val.replace(/^["']|["']$/g, ""));
      }
      // Nested object in array (like sources)
      const nestedMatch = line.match(/^\s{4,}(\w+)\s*:\s*(.*)/);
      if (nestedMatch) {
        const [, nKey, nVal] = nestedMatch;
        const lastItem = currentArray[currentArray.length - 1];
        if (typeof lastItem === "object" && lastItem !== null) {
          (lastItem as Record<string, string>)[nKey] = nVal
            .trim()
            .replace(/^["']|["']$/g, "");
        }
      }
      // Start of new object in array
      if (line.match(/^\s{2}-\s+\w+:/)) {
        const objMatch = line.match(/^\s{2}-\s+(\w+)\s*:\s*(.*)/);
        if (objMatch) {
          const obj: Record<string, string> = {};
          obj[objMatch[1]] = objMatch[2].trim().replace(/^["']|["']$/g, "");
          currentArray.push(obj);
        }
      }
    }
  }

  if (currentArray && currentKey) {
    frontmatter[currentKey] = currentArray;
  }

  return { frontmatter, content };
}

export function loadPage(pageId: string): WikiPage | null {
  // pageId like "opencode/architecture" → content/opencode/architecture.md
  const filePath = path.join(CONTENT_DIR, `${pageId}.md`);
  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, "utf-8");
  const { frontmatter: rawFm, content } = parseFrontmatter(raw);

  const parsed = frontmatterSchema.safeParse(rawFm);
  if (!parsed.success) {
    // Return with raw frontmatter even if validation fails, for robustness
    return {
      frontmatter: rawFm as unknown as Frontmatter,
      content,
      rawMarkdown: raw,
    };
  }

  return {
    frontmatter: parsed.data,
    content,
    rawMarkdown: raw,
  };
}

export function listPages(): Frontmatter[] {
  const pages: Frontmatter[] = [];

  function scanDir(dir: string, prefix: string) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        scanDir(path.join(dir, entry.name), `${prefix}${entry.name}/`);
      } else if (entry.name.endsWith(".md") && !entry.name.startsWith("_")) {
        const pageId = `${prefix}${entry.name.replace(/\.md$/, "")}`;
        const page = loadPage(pageId);
        if (page) pages.push(page.frontmatter);
      }
    }
  }

  scanDir(CONTENT_DIR, "");
  return pages;
}

export function searchPages(query: string, filters?: {
  project?: string;
  kind?: string;
}): Frontmatter[] {
  const allPages = listPages();
  const q = query.toLowerCase();

  return allPages.filter((page) => {
    // Apply filters
    if (filters?.project) {
      const projects = Array.isArray(page.project)
        ? page.project
        : [page.project];
      if (!projects.includes(filters.project)) return false;
    }
    if (filters?.kind && page.kind !== filters.kind) return false;

    // If no query, return all matching filters
    if (!q) return true;

    // Search by individual keywords for fuzzy matching
    // "tool execution" should match "tool-execution-models"
    const keywords = q.split(/[\s\-_/]+/).filter((w) => w.length > 1);
    const searchText = [
      page.title,
      page.summary,
      page.topic,
      page.id,
    ]
      .join(" ")
      .toLowerCase();

    return keywords.every((kw) => searchText.includes(kw));
  });
}
