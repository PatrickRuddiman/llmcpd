import { Worker } from "worker_threads";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync } from "fs";
import type { CrawlTask, CrawlResult } from "./crawler-worker.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const DEFAULT_MAX_CRAWL_DOCUMENTS = 100;

export interface CrawlerOptions {
  maxDepth: number;
  maxWorkers: number;
  maxDocuments?: number;
  verbose?: boolean;
}

export interface CrawledDocument {
  url: string;
  content: string;
  depth: number;
  section: string;
  title: string;
}

export class DeepCrawler {
  private crawledUrls = new Set<string>();
  private pendingTasks: CrawlTask[] = [];
  private activeWorkers = 0;
  private results: CrawledDocument[] = [];
  private options: CrawlerOptions;

  constructor(options: CrawlerOptions) {
    this.options = options;
  }

  async crawl(
    initialUrls: Array<{ url: string; section: string; title: string }>
  ): Promise<CrawledDocument[]> {
    this.crawledUrls.clear();
    this.results = [];
    this.pendingTasks = [];

    // Add initial tasks
    for (const { url, section, title } of initialUrls) {
      if (url.endsWith(".md") || url.includes(".md#")) {
        this.pendingTasks.push({
          url,
          depth: 0,
          maxDepth: this.options.maxDepth,
          parentUrl: "",
          section,
          title,
        });
      }
    }

    // Process all tasks
    await this.processTasks();

    return this.results;
  }

  private async processTasks(): Promise<void> {
    const activePromises = new Set<Promise<void>>();
    const maxDocuments = this.options.maxDocuments ?? DEFAULT_MAX_CRAWL_DOCUMENTS;

    while (this.pendingTasks.length > 0 || this.activeWorkers > 0) {
      // Stop if we've reached the document limit
      if (this.results.length >= maxDocuments) {
        if (this.options.verbose) {
          console.error(`Reached max document limit (${maxDocuments}), stopping crawl`);
        }
        this.pendingTasks = [];
        break;
      }

      // Start workers up to the max limit
      while (
        this.pendingTasks.length > 0 &&
        this.activeWorkers < this.options.maxWorkers &&
        this.results.length < maxDocuments
      ) {
        const task = this.pendingTasks.shift()!;
        
        // Skip if already crawled
        if (this.crawledUrls.has(task.url)) {
          continue;
        }

        this.crawledUrls.add(task.url);
        this.activeWorkers++;

        const workerPromise = this.runWorker(task);
        activePromises.add(workerPromise);
        
        // Remove promise from set when it completes
        workerPromise.finally(() => {
          activePromises.delete(workerPromise);
        });
      }

      // Wait for at least one worker to complete if we're at max capacity
      if (this.activeWorkers >= this.options.maxWorkers && activePromises.size > 0) {
        await Promise.race(activePromises);
      }

      // Small delay to prevent tight loop
      if (this.pendingTasks.length === 0 && this.activeWorkers > 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Wait for all remaining workers
    if (activePromises.size > 0) {
      await Promise.all(activePromises);
    }
  }

  private async runWorker(task: CrawlTask): Promise<void> {
    return new Promise((resolve, reject) => {
      // Resolve worker path relative to the current module
      // When bundled, this will be in dist/chunk-*.js, but the worker is in dist/indexing/
      let workerPath = join(__dirname, "crawler-worker.js");
      
      // Try alternative path for bundled version
      if (!existsSync(workerPath)) {
        workerPath = join(__dirname, "indexing", "crawler-worker.js");
      }
      
      const worker = new Worker(workerPath, {
        workerData: { task },
      });

      let settled = false;

      worker.on("message", (result: CrawlResult) => {
        if (!settled) {
          settled = true;
          this.activeWorkers--;

          if (result.error) {
            if (this.options.verbose) {
              console.error(`Crawl error for ${result.url}: ${result.error}`);
            }
          } else {
            // Add to results
            this.results.push({
              url: result.url,
              content: result.content,
              depth: result.depth,
              section: task.section,
              title: task.title,
            });

            // Add newly discovered links to pending tasks
            for (const link of result.links) {
              if (!this.crawledUrls.has(link)) {
                this.pendingTasks.push({
                  url: link,
                  depth: result.depth + 1,
                  maxDepth: task.maxDepth,
                  parentUrl: result.url,
                  section: task.section,
                  title: `${task.title} (linked)`,
                });
              }
            }
          }

          resolve();
        }
      });

      worker.on("error", (error) => {
        if (!settled) {
          settled = true;
          this.activeWorkers--;
          if (this.options.verbose) {
            console.error(`Worker error for ${task.url}:`, error);
          }
          resolve(); // Resolve instead of reject to allow other workers to continue
        }
      });

      worker.on("exit", (code) => {
        if (!settled) {
          settled = true;
          this.activeWorkers--;
          if (code !== 0 && this.options.verbose) {
            console.error(`Worker stopped with exit code ${code}`);
          }
          resolve();
        }
      });
    });
  }
}
