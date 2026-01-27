import TurndownService from "turndown";
import { CacheManager } from "./cache.js";
import { parseLlmsTxt, ParsedLlms, LlmsLink } from "./parser.js";
import { SearchIndex, SearchResult, SearchDocument } from "./search.js";
import { DeepCrawler, DEFAULT_MAX_CRAWL_DOCUMENTS } from "./crawler.js";
import { Worker } from "worker_threads";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync } from "fs";
import type { FullChunk } from "./llms-full-worker.js";

export interface IndexingOptions {
  llmsUrl: string;
  cacheDir: string;
  maxPages: number;
  preferFull: boolean;
  verbose?: boolean;
  crawlDepth?: number;
  maxWorkers?: number;
  maxCrawlDocs?: number;
}

export interface IndexStatus {
  llmsTitle?: string;
  llmsSummary?: string;
  lastIndexedAt?: string;
  pagesIndexed: number;
  cacheDir: string;
  lastError?: string;
  inProgress: boolean;
  deepCrawledPages?: number;
}

export interface CachedDocument {
  id: string;
  url: string;
  title: string;
  section: string;
  optional: boolean;
  content: string;
  contentType?: string;
  parentUrl?: string;
  headingLevel?: number;
}

interface FetchDocumentSource {
  url: string;
  content: string;
  contentType?: string;
  ok: boolean;
  status: number;
}

export class IndexingService {
  private cache: CacheManager;
  private turndown = new TurndownService();
  private parsed: ParsedLlms | null = null;
  private documents = new Map<string, CachedDocument>();
  private searchIndex = new SearchIndex();
  private status: IndexStatus;

  constructor(private options: IndexingOptions) {
    this.cache = new CacheManager(options.cacheDir);
    this.status = {
      pagesIndexed: 0,
      cacheDir: options.cacheDir,
      inProgress: false,
    };
  }

  getStatus(): IndexStatus {
    return { ...this.status };
  }

  getParsed(): ParsedLlms | null {
    return this.parsed;
  }

  listLinks(section?: string): LlmsLink[] {
    if (!this.parsed) return [];
    if (!section) return this.parsed.links;
    return this.parsed.links.filter(
      (link) => link.section.toLowerCase() === section.toLowerCase()
    );
  }

  listSections(): { section: string; count: number }[] {
    if (!this.parsed) return [];
    return Array.from(this.parsed.sections.entries()).map(([section, links]) => ({
      section,
      count: links.length,
    }));
  }

  search(query: string, limit?: number, section?: string): SearchResult[] {
    return this.searchIndex.search(query, limit, section);
  }

  getDocument(url: string): CachedDocument | undefined {
    return Array.from(this.documents.values()).find((doc) => doc.url === url);
  }

  /**
   * Fetch a document by URL, using cached content when available and fetching
   * on cache miss. Automatically attempts a `.md` suffix when the URL is HTML.
   */
  async fetchDocument(url: string) {
    const toResult = (entry: FetchDocumentSource) => ({
      url,
      resolvedUrl: entry.url,
      content: entry.ok ? this.normalizeContent(entry.content, entry.contentType) : "",
      contentType: entry.contentType,
      ok: entry.ok,
      status: entry.status,
    });

    const cached = await this.cache.get(url);
    if (cached && cached.ok) {
      return toResult(cached);
    }

    if (!url.endsWith(".md")) {
      const mdUrl = `${url}.md`;
      const cachedMd = await this.cache.get(mdUrl);
      if (cachedMd && cachedMd.ok) {
        return toResult(cachedMd);
      }
    }

    const entry = await this.fetchWithMarkdownFallback(url);
    return toResult(entry);
  }

  async indexAll(): Promise<void> {
    this.status.inProgress = true;
    this.status.lastError = undefined;
    this.status.deepCrawledPages = 0;
    try {
      const llmsEntry = await this.cache.fetch(this.options.llmsUrl);
      if (!llmsEntry.ok) {
        throw new Error(`Failed to fetch llms.txt (${llmsEntry.status})`);
      }

      this.parsed = parseLlmsTxt(llmsEntry.content);
      this.status.llmsTitle = this.parsed.title;
      this.status.llmsSummary = this.parsed.summary;

      this.documents.clear();
      this.searchIndex.clear();

      const targets: LlmsLink[] = [];
      for (const link of this.parsed.links) {
        targets.push(link);
      }

      if (this.options.preferFull) {
        const fullUrl = this.inferFullUrl(this.options.llmsUrl);
        if (fullUrl) {
          await this.indexFullDocument(fullUrl);
        }
      }

      const maxPages = Math.max(1, this.options.maxPages);
      for (const link of targets.slice(0, maxPages)) {
        await this.indexLink(link);
      }

      // Perform deep crawling if enabled
      if (this.options.crawlDepth && this.options.crawlDepth > 0) {
        await this.deepCrawlMarkdownFiles(targets.slice(0, maxPages));
      }

      this.status.lastIndexedAt = new Date().toISOString();
      this.status.pagesIndexed = this.documents.size;
    } catch (error) {
      this.status.lastError = error instanceof Error ? error.message : String(error);
    } finally {
      this.status.inProgress = false;
    }
  }

  startBackgroundIndexing(refreshMinutes: number): () => void {
    if (refreshMinutes <= 0) {
      return () => undefined;
    }
    const interval = setInterval(() => {
      void this.indexAll();
    }, refreshMinutes * 60 * 1000);
    return () => clearInterval(interval);
  }

  private async indexLink(link: LlmsLink): Promise<void> {
    const entry = await this.fetchWithMarkdownFallback(link.url);
    if (!entry.ok) {
      return;
    }
    const content = this.normalizeContent(entry.content, entry.contentType);
    await this.addDocument({
      id: link.url,
      url: link.url,
      title: link.title,
      section: link.section,
      optional: link.optional,
      content,
      contentType: entry.contentType,
    });
  }

  private async addDocument(doc: CachedDocument): Promise<void> {
    this.documents.set(doc.id, doc);
    const searchDoc: SearchDocument = {
      id: doc.id,
      url: doc.url,
      title: doc.title,
      section: doc.section,
      optional: doc.optional,
      text: toPlainText(doc.content),
    };
    this.searchIndex.upsert(searchDoc);
  }

  private async indexFullDocument(fullUrl: string): Promise<void> {
    const result = await this.chunkFullDocument(fullUrl);
    if (!result.ok) {
      if (this.options.verbose) {
        console.error(result.error);
      }
      return;
    }
    for (const chunk of result.chunks) {
      const chunkId = `${fullUrl}#${chunk.section}`;
      await this.addDocument({
        id: chunkId,
        url: fullUrl,
        title: chunk.title,
        section: chunk.section,
        optional: false,
        content: chunk.content,
        parentUrl: fullUrl,
        headingLevel: chunk.level,
      });
    }
  }

  private inferFullUrl(llmsUrl: string): string | null {
    if (llmsUrl.endsWith("/llms.txt")) {
      return llmsUrl.replace(/\/llms\.txt$/, "/llms-full.txt");
    }
    if (llmsUrl.endsWith("llms.txt")) {
      return llmsUrl.replace(/llms\.txt$/, "llms-full.txt");
    }
    if (llmsUrl.endsWith("/llm.txt")) {
      return llmsUrl.replace(/\/llm\.txt$/, "/llm-full.txt");
    }
    if (llmsUrl.endsWith("llm.txt")) {
      return llmsUrl.replace(/llm\.txt$/, "llm-full.txt");
    }
    return null;
  }

  private async fetchWithMarkdownFallback(url: string) {
    const entry = await this.cache.fetch(url);
    if (!entry.ok) return entry;

    const isHtml = entry.contentType?.includes("text/html");
    const isMarkdown = entry.contentType?.includes("text/markdown") || url.endsWith(".md");

    if (isHtml && !url.endsWith(".md")) {
      const mdUrl = `${url}.md`;
      const mdEntry = await this.cache.fetch(mdUrl);
      if (mdEntry.ok) {
        return mdEntry;
      }
    }

    if (!isHtml || isMarkdown) {
      return entry;
    }

    return entry;
  }

  private async chunkFullDocument(fullUrl: string): Promise<{
    ok: boolean;
    chunks: FullChunk[];
    error?: string;
  }> {
    return this.runFullWorker(fullUrl);
  }

  private async runFullWorker(fullUrl: string): Promise<{
    ok: boolean;
    chunks: FullChunk[];
    error?: string;
  }> {
    const workerPath = this.resolveFullWorkerPath();
    if (!workerPath) {
      return { ok: false, chunks: [], error: "Unable to locate llms-full worker file." };
    }

    return new Promise((resolve) => {
      let settled = false;
      const worker = new Worker(workerPath, {
        workerData: { url: fullUrl, cacheDir: this.options.cacheDir },
      });

      const finalize = (payload: { ok: boolean; chunks: FullChunk[]; error?: string }) => {
        if (settled) return;
        settled = true;
        worker.terminate().catch((error) => {
          if (this.options.verbose) {
            console.error("Failed to terminate llms-full worker:", error);
          }
        });
        resolve(payload);
      };

      worker.on("message", (message: { url: string; chunks: FullChunk[]; error?: string }) => {
        if (message.error) {
          finalize({ ok: false, chunks: [], error: message.error });
        } else {
          finalize({ ok: true, chunks: message.chunks });
        }
      });

      worker.on("error", (error) => {
        finalize({
          ok: false,
          chunks: [],
          error: error instanceof Error ? error.message : String(error),
        });
      });

      worker.on("exit", (code) => {
        if (settled) {
          return;
        }
        if (code !== 0) {
          finalize({
            ok: false,
            chunks: [],
            error: `llms-full worker stopped with exit code ${code}`,
          });
          return;
        }
        finalize({
          ok: false,
          chunks: [],
          error: "llms-full worker exited before sending results",
        });
      });
    });
  }

  private resolveFullWorkerPath(): string | null {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const primaryPath = join(__dirname, "llms-full-worker.js");
    const alternativePath = join(__dirname, "indexing", "llms-full-worker.js");
    if (existsSync(primaryPath)) {
      return primaryPath;
    }
    if (existsSync(alternativePath)) {
      return alternativePath;
    }
    return null;
  }

  private normalizeContent(content: string, contentType?: string): string {
    if (contentType?.includes("text/html")) {
      return this.turndown.turndown(content);
    }
    return content;
  }

  private async deepCrawlMarkdownFiles(links: LlmsLink[]): Promise<void> {
    const crawlDepth = this.options.crawlDepth ?? 0;
    const maxWorkers = this.options.maxWorkers ?? 4;
    const maxCrawlDocs = this.options.maxCrawlDocs ?? DEFAULT_MAX_CRAWL_DOCUMENTS;

    if (crawlDepth <= 0) {
      return;
    }

    if (this.options.verbose) {
      console.error(`Starting deep crawl with depth ${crawlDepth}, ${maxWorkers} workers, max ${maxCrawlDocs} docs`);
    }

    const crawler = new DeepCrawler({
      maxDepth: crawlDepth,
      maxWorkers,
      maxDocuments: maxCrawlDocs,
      cacheDir: this.options.cacheDir,
      verbose: this.options.verbose,
    });

    // Prepare initial URLs for crawling (only markdown files)
    const initialUrls = links
      .filter(link => link.url.endsWith(".md") || link.url.includes(".md#"))
      .map(link => ({
        url: link.url,
        section: link.section,
        title: link.title,
      }));

    if (initialUrls.length === 0) {
      if (this.options.verbose) {
        console.error("No markdown files found to crawl");
      }
      return;
    }

    const crawledDocs = await crawler.crawl(initialUrls);

    // Add crawled documents to the index
    // Skip depth-0 documents as they were already indexed in indexLink
    for (const doc of crawledDocs) {
      if (doc.depth === 0) {
        continue;
      }
      
      const docId = `${doc.url}-depth-${doc.depth}`;
      await this.addDocument({
        id: docId,
        url: doc.url,
        title: doc.title,
        section: doc.section,
        optional: doc.depth > 0, // Mark deeper documents as optional
        content: doc.content,
      });
    }

    this.status.deepCrawledPages = crawledDocs.filter(doc => doc.depth > 0).length;

    if (this.options.verbose) {
      console.error(`Deep crawl completed: ${this.status.deepCrawledPages} documents indexed`);
    }
  }
}

function toPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/#+\s+/g, " ")
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1")
    .replace(/[*_>\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
