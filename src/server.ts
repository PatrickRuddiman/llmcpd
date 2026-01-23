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
    "Search indexed documentation for relevant content. Use focused keywords rather than full sentences. " +
    "For complex queries, break them into key terms (e.g., 'confirmSetup payment method' instead of full API names). " +
    "Returns relevance-ranked results with extended snippets showing context around matches. " +
    "Increase 'limit' for broader coverage (max 20). Use 'section' to filter by llms.txt section if known.",
    {
      query: z.string().min(2).describe("Keywords or terms to search for (e.g., 'stripe payment setup')"),
      limit: z.number().int().min(1).max(20).optional().describe("Maximum results to return (default: 5)"),
      section: z.string().optional().describe("Filter results to specific llms.txt section"),
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
    "Fetch full content for a specific URL. Uses the cache when available and fetches on cache miss " +
    "(including trying a .md suffix for HTML pages). If the upstream requires a .md extension, provide " +
    "the base URL and the server will attempt `<url>.md` automatically. Returns up to 12,000 characters.",
    {
      url: z
        .string()
        .url()
        .describe(
          "Full URL of the document to fetch. Use exact URLs from llms.txt; omit .md unless you know it is required."
        ),
    },
    async ({ url }) => {
      const result = await indexing.fetchDocument(url);
      if (!result.ok) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to fetch ${url} (status: ${result.status ?? "unknown"})`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: result.content.slice(0, 12000),
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
