import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { allTools } from "./tools.js";

const server = new McpServer({
  name: "codewiki",
  version: "0.1.0",
});

// Register all tools
for (const tool of allTools) {
  server.tool(
    tool.name,
    tool.description,
    tool.shape,
    async (args: Record<string, unknown>) => {
      return tool.handler(args);
    },
  );
}

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);
