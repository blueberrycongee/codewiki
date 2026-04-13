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
    "Browse the CodeWiki knowledge base to find relevant pages about coding agent patterns and architecture. " +
    "Use this when you want to find references, learn about design patterns, or explore how open source coding agents work. " +
    "Returns a list of matching wiki pages with summaries. " +
    "Available projects: opencode, codex, openclaw. " +
    "Available page kinds: architecture, mechanism, pattern, evolution, comparison, antipattern, decision.",
  shape: {
    query: z
      .string()
      .optional()
      .describe(
        'Search query — matches against page titles, summaries, and topics. Examples: "tool dispatch", "context management", "agent loop". Leave empty to browse all pages.',
      ),
    project: z
      .enum(["opencode", "codex", "openclaw"])
      .optional()
      .describe("Filter by project"),
    kind: z
      .enum([
        "architecture",
        "mechanism",
        "pattern",
        "evolution",
        "comparison",
        "antipattern",
        "decision",
      ])
      .optional()
      .describe("Filter by page type"),
  },
  handler: (args) => {
    const query = (args.query as string) || "";
    const project = args.project as string | undefined;
    const kind = args.kind as string | undefined;

    const results = searchPages(query, { project, kind });

    if (results.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `No pages found for query "${query}"${project ? ` in project ${project}` : ""}${kind ? ` of type ${kind}` : ""}. Try a broader query or remove filters.`,
          },
        ],
      };
    }

    const text = results
      .map(
        (page) =>
          `- **${page.title}** (\`${page.id}\`)\n  Kind: ${page.kind} | Confidence: ${page.confidence} | Topic: ${page.topic}\n  ${page.summary}`,
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
    "Read a specific CodeWiki page in full. Returns the complete page content including architecture details, " +
    "code references, source citations, and related pages. Use the page_id from codewiki_discover results.",
  shape: {
    page_id: z
      .string()
      .describe(
        'The page ID to read, e.g. "opencode/architecture" or "comparisons/tool-execution-models"',
      ),
  },
  handler: (args) => {
    const pageId = args.page_id as string;
    const page = loadPage(pageId);

    if (!page) {
      const allPages = listPages();
      const suggestions = allPages
        .filter(
          (p) =>
            p.id.includes(pageId.split("/").pop() || "") ||
            p.topic.includes(pageId.split("/").pop() || ""),
        )
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
      `**ID:** ${fm.id} | **Kind:** ${fm.kind} | **Confidence:** ${fm.confidence}`,
      `**Project:** ${Array.isArray(fm.project) ? fm.project.join(", ") : fm.project}`,
      `**Topic:** ${fm.topic}`,
      `**Compiled:** ${fm.compiled_at} | **Model:** ${fm.compiler_model}`,
      "",
    ].join("\n");

    return {
      content: [{ type: "text" as const, text: header + page.content }],
    };
  },
};

const compareTool: ToolDefinition = {
  name: "codewiki_compare",
  description:
    "Get cross-project comparison on a specific topic. Shows how different coding agent projects " +
    "(OpenCode, Codex, OpenClaw) approach the same problem differently. " +
    "Topics include: architecture, tool execution, safety/sandboxing, conversation management, language tradeoffs.",
  shape: {
    topic: z
      .string()
      .describe(
        'The topic to compare across projects, e.g. "tool execution", "architecture", "safety"',
      ),
  },
  handler: (args) => {
    const topic = (args.topic as string).toLowerCase();

    const comparisonPages = searchPages(topic, { kind: "comparison" });
    if (comparisonPages.length > 0) {
      const page = loadPage(comparisonPages[0].id);
      if (page) {
        return {
          content: [
            {
              type: "text" as const,
              text: `# Comparison: ${comparisonPages[0].title}\n\n${page.content}`,
            },
          ],
        };
      }
    }

    const projectPages = searchPages(topic);
    if (projectPages.length > 0) {
      const sections = projectPages.map((p) => {
        const full = loadPage(p.id);
        return `## ${p.title} (${p.id})\n${full?.content || p.summary}`;
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `# Cross-project comparison: ${topic}\n\nNo dedicated comparison page found. Here are the relevant per-project pages:\n\n${sections.join("\n\n---\n\n")}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `No pages found related to topic "${topic}". Available topics: architecture, tool execution, conversation management, safety/sandboxing, context management.`,
        },
      ],
    };
  },
};

const deepDiveTool: ToolDefinition = {
  name: "codewiki_deep_dive",
  description:
    "Get detailed implementation specifics from a wiki page, focused on a particular question. " +
    "Returns the most relevant section along with source links for verification.",
  shape: {
    page_id: z.string().describe("The page ID to dive into"),
    question: z
      .string()
      .describe(
        'The specific question to answer, e.g. "how does the permission system work?"',
      ),
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

    const sections = page.content.split(/^### /m).filter(Boolean);
    const keywords = question.split(/\s+/).filter((w) => w.length > 2);

    const scored = sections.map((section) => {
      const lower = section.toLowerCase();
      const score = keywords.reduce(
        (s, kw) => s + (lower.includes(kw) ? 1 : 0),
        0,
      );
      return {
        section: section.startsWith("## ") ? section : `### ${section}`,
        score,
      };
    });

    scored.sort((a, b) => b.score - a.score);
    const relevant = scored.filter((s) => s.score > 0).slice(0, 3);

    const fm = page.frontmatter;
    const sourcesText = fm.sources
      .map((s) => `- [${s.type}: ${s.ref}](${s.url}) — ${s.relevance}`)
      .join("\n");

    if (relevant.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `No sections in "${fm.title}" closely match your question. Here's the full page summary:\n\n${fm.summary}\n\n**Sources:**\n${sourcesText}`,
          },
        ],
      };
    }

    const text = relevant.map((r) => r.section).join("\n\n");
    return {
      content: [
        {
          type: "text" as const,
          text: `# Deep Dive: ${fm.title}\n**Question:** ${args.question}\n\n${text}\n\n---\n**Sources for verification:**\n${sourcesText}`,
        },
      ],
    };
  },
};

const traceEvolutionTool: ToolDefinition = {
  name: "codewiki_trace_evolution",
  description:
    "Show how a specific feature or pattern evolved over time in a project. " +
    "Returns chronological narrative with commit links showing key architectural changes.",
  shape: {
    project: z
      .enum(["opencode", "codex", "openclaw"])
      .describe("The project to trace"),
    topic: z
      .string()
      .describe(
        'The feature/topic to trace, e.g. "tool system", "agent loop", "context management"',
      ),
  },
  handler: (args) => {
    const project = args.project as string;
    const topic = (args.topic as string).toLowerCase();

    const evolutionPages = searchPages(topic, {
      project,
      kind: "evolution",
    });

    if (evolutionPages.length > 0) {
      const page = loadPage(evolutionPages[0].id);
      if (page) {
        return {
          content: [{ type: "text" as const, text: page.content }],
        };
      }
    }

    const archPage = loadPage(`${project}/architecture`);
    if (archPage) {
      const evolutionSection = archPage.content
        .split(/^### /m)
        .find(
          (s) =>
            s.toLowerCase().includes("演进") ||
            s.toLowerCase().includes("evolution"),
        );

      if (evolutionSection) {
        return {
          content: [
            {
              type: "text" as const,
              text: `# Evolution: ${topic} in ${project}\n\n### ${evolutionSection}\n\n*Extracted from architecture page. For full context, read \`${project}/architecture\`.*`,
            },
          ],
        };
      }
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `No evolution data found for "${topic}" in ${project}. Try codewiki_read with "${project}/architecture" for an overview that may include evolution notes.`,
        },
      ],
    };
  },
};

export const allTools: ToolDefinition[] = [
  discoverTool,
  readTool,
  compareTool,
  deepDiveTool,
  traceEvolutionTool,
];
