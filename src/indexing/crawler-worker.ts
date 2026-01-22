import { parentPort, workerData } from "worker_threads";
import TurndownService from "turndown";
import { createHash } from "crypto";
import { promises as fs } from "fs";
import { join } from "path";

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
  cacheDir: string;
}

interface CacheEntry {
  url: string;
  fetchedAt: string;
  status: number;
  ok: boolean;
  contentType?: string;
  etag?: string | null;
  lastModified?: string | null;
  content: string;
}

const turndown = new TurndownService();

// Cache helper functions
function hashUrl(url: string): string {
  return createHash("sha256").update(url).digest("hex");
}

function getCachePath(cacheDir: string, url: string): string {
  return join(cacheDir, `${hashUrl(url)}.json`);
}

async function getCached(cacheDir: string, url: string): Promise<CacheEntry | null> {
  try {
    const data = await fs.readFile(getCachePath(cacheDir, url), "utf-8");
    return JSON.parse(data) as CacheEntry;
  } catch {
    return null;
  }
}

async function setCached(cacheDir: string, entry: CacheEntry): Promise<void> {
  try {
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(getCachePath(cacheDir, entry.url), JSON.stringify(entry, null, 2));
  } catch {
    // Ignore cache write errors
  }
}

// Extract markdown links from content
function extractMarkdownLinks(content: string, baseUrl: string): string[] {
  const links: string[] = [];
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match;

  while ((match = linkRegex.exec(content)) !== null) {
    const url = match[2];
    
    // Skip anchor-only links that start with #
    if (url.startsWith("#")) {
      continue;
    }
    
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

// Fetch content with caching support
async function fetchContent(cacheDir: string, url: string): Promise<{ content: string; contentType?: string; ok: boolean; status?: number }> {
  try {
    const cached = await getCached(cacheDir, url);
    const headers: Record<string, string> = {};
    
    if (cached?.etag) headers["If-None-Match"] = cached.etag;
    if (cached?.lastModified) headers["If-Modified-Since"] = cached.lastModified;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(url, { headers, signal: controller.signal });
      
      // Return cached content if not modified
      if (response.status === 304 && cached) {
        return { content: cached.content, contentType: cached.contentType, ok: true };
      }

      if (!response.ok) {
        return { content: "", ok: false, status: response.status };
      }

      const content = await response.text();
      const contentType = response.headers.get("content-type") || undefined;
      
      // Cache the result
      const entry: CacheEntry = {
        url,
        fetchedAt: new Date().toISOString(),
        status: response.status,
        ok: response.ok,
        contentType,
        etag: response.headers.get("etag"),
        lastModified: response.headers.get("last-modified"),
        content,
      };
      await setCached(cacheDir, entry);
      
      return { content, contentType, ok: true };
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    return { content: "", ok: false };
  }
}

// Main worker logic
async function crawl(task: CrawlTask, cacheDir: string): Promise<CrawlResult> {
  try {
    const result = await fetchContent(cacheDir, task.url);
    
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
  crawl(data.task, data.cacheDir)
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
