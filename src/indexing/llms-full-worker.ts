import { parentPort, workerData } from "worker_threads";
import TurndownService from "turndown";
import { CacheManager } from "./cache.js";

interface WorkerData {
  url: string;
  cacheDir: string;
}

export interface FullChunk {
  title: string;
  section: string;
  content: string;
  level: number;
}

interface WorkerResult {
  url: string;
  chunks: FullChunk[];
  error?: string;
}

const turndown = new TurndownService();
const headingRegex = /^(#{1,6})\s+(.*)$/;

function normalizeContent(content: string, contentType?: string): string {
  if (contentType?.includes("text/html")) {
    return turndown.turndown(content);
  }
  return content;
}

function chunkMarkdown(markdown: string): FullChunk[] {
  const lines = markdown.split(/\r?\n/);
  const chunks: FullChunk[] = [];
  const headingStack: Array<{ level: number; title: string }> = [];
  let current:
    | { title: string; section: string; level: number; lines: string[] }
    | null = null;
  let preamble: string[] = [];
  let sawHeading = false;

  const pushChunk = (chunk: {
    title: string;
    section: string;
    level: number;
    lines: string[];
  }) => {
    const content = chunk.lines.join("\n").trim();
    if (!content) return;
    chunks.push({
      title: chunk.title,
      section: chunk.section,
      content,
      level: chunk.level,
    });
  };

  const pushPreamble = () => {
    const content = preamble.join("\n").trim();
    if (!content) return;
    chunks.push({
      title: "Preamble",
      section: "Preamble",
      content,
      level: 0,
    });
    preamble = [];
  };

  for (const line of lines) {
    const match = line.match(headingRegex);
    if (match) {
      if (!sawHeading && preamble.length > 0) {
        pushPreamble();
      }
      sawHeading = true;
      if (current) {
        pushChunk(current);
      }
      const level = match[1].length;
      const heading = match[2].trim() || "Untitled Section";
      while (headingStack.length && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop();
      }
      headingStack.push({ level, title: heading });
      const section = headingStack.map((entry) => entry.title).join(" > ");
      current = {
        title: heading,
        section,
        level,
        lines: [line],
      };
      continue;
    }

    if (!sawHeading) {
      if (line.trim()) {
        preamble.push(line);
      }
      continue;
    }

    current?.lines.push(line);
  }

  if (current) {
    pushChunk(current);
  }
  if (!sawHeading && preamble.length > 0) {
    pushPreamble();
  }

  return chunks;
}

async function processFullDocument(url: string, cacheDir: string): Promise<WorkerResult> {
  try {
    const cache = new CacheManager(cacheDir);
    let entry = await cache.get(url);
    if (!entry || !entry.ok) {
      entry = await cache.fetch(url);
    }
    if (!entry.ok) {
      return {
        url,
        chunks: [],
        error: `Failed to fetch llms-full.txt (${entry.status})`,
      };
    }

    const content = normalizeContent(entry.content, entry.contentType);
    const chunks = chunkMarkdown(content);
    return { url, chunks };
  } catch (error) {
    return {
      url,
      chunks: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

if (parentPort && workerData) {
  const data = workerData as WorkerData;
  processFullDocument(data.url, data.cacheDir)
    .then((result) => {
      parentPort!.postMessage(result);
    })
    .catch((error) => {
      parentPort!.postMessage({
        url: data.url,
        chunks: [],
        error: error instanceof Error ? error.message : String(error),
      });
    });
}
