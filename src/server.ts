import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { IndexingService, IndexingOptions } from "./indexing/manager.js";

export interface ServerOptions extends IndexingOptions {
  refreshMinutes: number;
}

export async function startServer(options: ServerOptions) {
  const indexing = new IndexingService(options);
  await indexing.indexAll();
  const stopBackground = indexing.startBackgroundIndexing(options.refreshMinutes);

  const server = new McpServer({
    name: "llmcpd",
    version: "0.1.0",
  });

  server.tool(
    "search",
    "Search indexed llms.txt/llms-full content",
    {
      query: z.string().min(2),
      limit: z.number().int().min(1).max(20).optional(),
      section: z.string().optional(),
    },
    async ({ query, limit, section }) => {
      const results = indexing.search(query, limit, section);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(results, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "fetch",
    "Fetch cached content for a URL referenced in llms.txt",
    {
      url: z.string().url(),
    },
    async ({ url }) => {
      const doc = indexing.getDocument(url);
      if (!doc) {
        return {
          content: [
            {
              type: "text",
              text: `No cached document found for ${url}`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: doc.content.slice(0, 12000),
          },
        ],
      };
    }
  );

  server.tool(
    "list_sections",
    "List all llms.txt sections with link counts",
    {},
    async () => {
      const sections = indexing.listSections();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(sections, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "list_links",
    "List links from llms.txt, optionally filtered by section",
    {
      section: z.string().optional(),
    },
    async ({ section }) => {
      const links = indexing.listLinks(section);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(links, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "summary",
    "Summarize cached content for a URL using a simple heuristic",
    {
      url: z.string().url(),
      maxChars: z.number().int().min(200).max(4000).optional(),
    },
    async ({ url, maxChars }) => {
      const doc = indexing.getDocument(url);
      if (!doc) {
        return {
          content: [
            {
              type: "text",
              text: `No cached document found for ${url}`,
            },
          ],
        };
      }
      const summary = doc.content
        .replace(/\s+/g, " ")
        .slice(0, maxChars ?? 1200);
      return {
        content: [
          {
            type: "text",
            text: summary,
          },
        ],
      };
    }
  );

  server.tool(
    "status",
    "Get indexing status and cache info",
    {},
    async () => {
      const status = indexing.getStatus();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(status, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "reindex",
    "Force reindex of llms.txt and related content",
    {},
    async () => {
      await indexing.indexAll();
      return {
        content: [
          {
            type: "text",
            text: "Reindex completed",
          },
        ],
      };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const cleanup = () => {
    stopBackground();
  };

  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });

  return server;
}