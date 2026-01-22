import { parentPort, workerData } from "worker_threads";
import TurndownService from "turndown";

export interface CrawlTask {
  url: string;
  depth: number;
  maxDepth: number;
  parentUrl: string;
  section: string;
  title: string;
}

export interface CrawlResult {
  url: string;
  content: string;
  links: string[];
  depth: number;
  error?: string;
}

interface WorkerData {
  task: CrawlTask;
}

const turndown = new TurndownService();

// Extract markdown links from content
function extractMarkdownLinks(content: string, baseUrl: string): string[] {
  const links: string[] = [];
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match;

  while ((match = linkRegex.exec(content)) !== null) {
    const url = match[2];
    // Only include markdown files
    if (url.endsWith(".md") || url.includes(".md#")) {
      try {
        // Handle relative URLs
        const resolvedUrl = new URL(url, baseUrl).href;
        links.push(resolvedUrl);
      } catch {
        // Skip invalid URLs
      }
    }
  }

  return [...new Set(links)]; // Remove duplicates
}

// Fetch content with error handling
async function fetchContent(url: string): Promise<{ content: string; contentType?: string; ok: boolean; status?: number }> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return { content: "", ok: false, status: response.status };
    }
    const content = await response.text();
    const contentType = response.headers.get("content-type") || undefined;
    return { content, contentType, ok: true };
  } catch (error) {
    return { content: "", ok: false };
  }
}

// Main worker logic
async function crawl(task: CrawlTask): Promise<CrawlResult> {
  try {
    const result = await fetchContent(task.url);
    
    if (!result.ok) {
      return {
        url: task.url,
        content: "",
        links: [],
        depth: task.depth,
        error: `Failed to fetch (status: ${result.status})`,
      };
    }

    let content = result.content;
    
    // Convert HTML to markdown if needed
    if (result.contentType?.includes("text/html")) {
      content = turndown.turndown(content);
    }

    // Extract links only if we haven't reached max depth
    const links = task.depth < task.maxDepth 
      ? extractMarkdownLinks(content, task.url)
      : [];

    return {
      url: task.url,
      content,
      links,
      depth: task.depth,
    };
  } catch (error) {
    return {
      url: task.url,
      content: "",
      links: [],
      depth: task.depth,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Execute the worker
if (parentPort && workerData) {
  const data = workerData as WorkerData;
  crawl(data.task)
    .then((result) => {
      parentPort!.postMessage(result);
    })
    .catch((error) => {
      parentPort!.postMessage({
        url: data.task.url,
        content: "",
        links: [],
        depth: data.task.depth,
        error: error instanceof Error ? error.message : String(error),
      });
    });
}
