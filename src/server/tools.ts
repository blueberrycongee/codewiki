import { z } from "zod";
import { loadPage, searchPages, listPages } from "../wiki/index.js";

export interface ToolDefinition {
  name: string;
  description: string;
  shape: Record<string, z.ZodTypeAny>;
  handler: (args: Record<string, unknown>) => {
    content: Array<{ type: "text"; text: string }>;
  };
}

const discoverTool: ToolDefinition = {
  name: "codewiki_discover",
  description:
    "Browse the CodeWiki knowledge base to find relevant pages. " +
    "Returns a list of matching wiki pages with summaries. " +
    "Pages are organized into five layers: decision, evolution, constraint, pitfall, convention.",
  shape: {
    query: z
      .string()
      .optional()
      .describe("Search query. Leave empty to browse all pages."),
    project: z.string().optional().describe("Filter by project/repo slug"),
    layer: z
      .string()
      .optional()
      .describe("Filter by layer: decision, evolution, constraint, pitfall, convention"),
  },
  handler: (args) => {
    const query = (args.query as string) || "";
    const project = args.project as string | undefined;
    const layer = args.layer as string | undefined;

    const results = searchPages(query, undefined, { project, layer });

    if (results.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `No pages found for query "${query}"${project ? ` in project ${project}` : ""}${layer ? ` layer ${layer}` : ""}. Try a broader query or remove filters.`,
          },
        ],
      };
    }

    const text = results
      .map(
        (page) =>
          `- **${page.title}** (\`${page.id}\`)\n  Layer: ${page.layer} | Confidence: ${page.confidence}\n  ${page.summary}`,
      )
      .join("\n\n");

    return {
      content: [
        {
          type: "text" as const,
          text: `Found ${results.length} page(s):\n\n${text}\n\nUse codewiki_read with the page ID to read the full content.`,
        },
      ],
    };
  },
};

const readTool: ToolDefinition = {
  name: "codewiki_read",
  description:
    "Read a specific CodeWiki page in full. Returns the complete page content including " +
    "code references, source citations, and related pages.",
  shape: {
    page_id: z
      .string()
      .describe('The page ID to read, e.g. "opencode/decision" or "opencode/pitfall"'),
  },
  handler: (args) => {
    const pageId = args.page_id as string;
    const page = loadPage(pageId);

    if (!page) {
      const allPages = listPages();
      const suggestions = allPages
        .filter((p) => p.id.includes(pageId.split("/").pop() || ""))
        .slice(0, 5);

      let text = `Page "${pageId}" not found.`;
      if (suggestions.length > 0) {
        text += `\n\nDid you mean one of these?\n${suggestions.map((s) => `- ${s.id}: ${s.title}`).join("\n")}`;
      }

      return { content: [{ type: "text" as const, text }] };
    }

    const fm = page.frontmatter;
    const header = [
      `# ${fm.title}`,
      `**ID:** ${fm.id} | **Layer:** ${fm.layer || fm.kind} | **Confidence:** ${fm.confidence}`,
      `**Project:** ${Array.isArray(fm.project) ? fm.project.join(", ") : fm.project}`,
      `**Compiled:** ${fm.compiled_at} | **Model:** ${fm.compiler_model}`,
      "",
    ].join("\n");

    return {
      content: [{ type: "text" as const, text: header + page.content }],
    };
  },
};

const layersTool: ToolDefinition = {
  name: "codewiki_layers",
  description:
    "Get an overview of all five knowledge layers for a project. " +
    "Returns a summary of each layer: decision, evolution, constraint, pitfall, convention.",
  shape: {
    project: z.string().describe("The project/repo slug, e.g. 'opencode'"),
  },
  handler: (args) => {
    const project = args.project as string;
    const layers = ["decision", "evolution", "constraint", "pitfall", "convention"];

    const sections: string[] = [];
    for (const layer of layers) {
      const page = loadPage(`${project}/${layer}`);
      if (page) {
        sections.push(`## ${layer.toUpperCase()}\n${page.frontmatter.summary}`);
      } else {
        sections.push(`## ${layer.toUpperCase()}\n*Not compiled yet*`);
      }
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `# ${project} — Five Knowledge Layers\n\n${sections.join("\n\n")}\n\nUse codewiki_read to read any layer in full, e.g. codewiki_read("${project}/decision")`,
        },
      ],
    };
  },
};

const deepDiveTool: ToolDefinition = {
  name: "codewiki_deep_dive",
  description:
    "Get detailed specifics from a wiki page, focused on a particular question.",
  shape: {
    page_id: z.string().describe("The page ID to dive into"),
    question: z.string().describe("The specific question to answer"),
  },
  handler: (args) => {
    const pageId = args.page_id as string;
    const question = (args.question as string).toLowerCase();
    const page = loadPage(pageId);

    if (!page) {
      return {
        content: [
          { type: "text" as const, text: `Page "${pageId}" not found.` },
        ],
      };
    }

    const sections = page.content.split(/^## /m).filter(Boolean);
    const keywords = question.split(/\s+/).filter((w) => w.length > 2);

    const scored = sections.map((section) => {
      const lower = section.toLowerCase();
      const score = keywords.reduce(
        (s, kw) => s + (lower.includes(kw) ? 1 : 0),
        0,
      );
      return { section: `## ${section}`, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const relevant = scored.filter((s) => s.score > 0).slice(0, 3);

    const fm = page.frontmatter;

    if (relevant.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `No sections in "${fm.title}" closely match your question.\n\nSummary: ${fm.summary}`,
          },
        ],
      };
    }

    const text = relevant.map((r) => r.section).join("\n\n");
    return {
      content: [
        {
          type: "text" as const,
          text: `# Deep Dive: ${fm.title}\n**Question:** ${args.question}\n\n${text}`,
        },
      ],
    };
  },
};

const searchTool: ToolDefinition = {
  name: "codewiki_search",
  description: "Full-text search across all wiki content.",
  shape: {
    query: z.string().describe("Search query"),
    project: z.string().optional().describe("Filter by project"),
    layer: z.string().optional().describe("Filter by layer"),
  },
  handler: (args) => {
    const query = args.query as string;
    const project = args.project as string | undefined;
    const layer = args.layer as string | undefined;

    const results = searchPages(query, undefined, { project, layer });
    if (results.length === 0) {
      return {
        content: [
          { type: "text" as const, text: `No results for "${query}".` },
        ],
      };
    }

    const text = results
      .map((p) => `- **${p.title}** (\`${p.id}\`) — ${p.summary}`)
      .join("\n");

    return {
      content: [
        {
          type: "text" as const,
          text: `Found ${results.length} result(s) for "${query}":\n\n${text}`,
        },
      ],
    };
  },
};

export const allTools: ToolDefinition[] = [
  discoverTool,
  readTool,
  layersTool,
  deepDiveTool,
  searchTool,
];
