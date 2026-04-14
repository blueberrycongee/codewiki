import fs from "node:fs";
import path from "node:path";
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

      if (value.startsWith("[") && value.endsWith("]")) {
        frontmatter[key] = value
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim().replace(/^["']|["']$/g, ""));
      } else if (value.startsWith('"') && value.endsWith('"')) {
        frontmatter[key] = value.slice(1, -1);
      } else if (value.trim()) {
        frontmatter[key] = value.trim();
      } else {
        currentArray = [];
      }
    } else if (currentArray !== null) {
      const arrayItemMatch = line.match(/^\s+-\s+(.*)/);
      if (arrayItemMatch) {
        const val = arrayItemMatch[1].trim();
        currentArray.push(val.replace(/^["']|["']$/g, ""));
      }
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

// Default content dir for backward compat
let _defaultContentDir: string | null = null;

function resolveContentDir(contentDir?: string): string {
  if (contentDir) return contentDir;
  if (_defaultContentDir) return _defaultContentDir;
  // Fallback: resolve from this file's location
  const __dirname = path.dirname(new URL(import.meta.url).pathname);
  return path.resolve(__dirname, "../../content");
}

export function loadPage(pageId: string, contentDir?: string): WikiPage | null {
  const dir = resolveContentDir(contentDir);
  const filePath = path.join(dir, `${pageId}.md`);
  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, "utf-8");
  const { frontmatter: rawFm, content } = parseFrontmatter(raw);

  const parsed = frontmatterSchema.safeParse(rawFm);
  if (!parsed.success) {
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

export interface PageSummary {
  id: string;
  title: string;
  layer: string;
  project: string | string[];
  confidence: string;
  summary: string;
}

export function listPages(contentDir?: string): PageSummary[] {
  const dir = resolveContentDir(contentDir);
  const pages: PageSummary[] = [];

  function scanDir(scanPath: string, prefix: string) {
    if (!fs.existsSync(scanPath)) return;
    const entries = fs.readdirSync(scanPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        scanDir(path.join(scanPath, entry.name), `${prefix}${entry.name}/`);
      } else if (entry.name.endsWith(".md") && !entry.name.startsWith("_")) {
        const pageId = `${prefix}${entry.name.replace(/\.md$/, "")}`;
        const page = loadPage(pageId, dir);
        if (page) {
          const fm = page.frontmatter;
          pages.push({
            id: fm.id || pageId,
            title: fm.title || pageId,
            layer: fm.layer || fm.kind || "unknown",
            project: fm.project,
            confidence: fm.confidence || "medium",
            summary: fm.summary || "",
          });
        }
      }
    }
  }

  scanDir(dir, "");
  return pages;
}

export function searchPages(
  query: string,
  contentDir?: string,
  filters?: { project?: string; layer?: string },
): PageSummary[] {
  const allPages = listPages(contentDir);
  const q = query.toLowerCase();

  return allPages.filter((page) => {
    if (filters?.project) {
      const projects = Array.isArray(page.project)
        ? page.project
        : [page.project];
      if (!projects.includes(filters.project)) return false;
    }
    if (filters?.layer && page.layer !== filters.layer) return false;

    if (!q) return true;

    const keywords = q.split(/[\s\-_/]+/).filter((w) => w.length > 1);
    const searchText = [page.title, page.summary, page.id]
      .join(" ")
      .toLowerCase();

    return keywords.every((kw) => searchText.includes(kw));
  });
}
