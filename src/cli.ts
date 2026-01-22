#!/usr/bin/env node
import { Command } from "commander";
import { mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { startServer } from "./server.js";

const program = new Command();

program
  .name("llmcpd")
  .description("Start an MCP server backed by llms.txt and llms-full.txt")
  .requiredOption("--url <url>", "URL to llms.txt")
  .option("--cache-dir <path>", "Cache directory")
  .option("--refresh-mins <minutes>", "Background reindex interval", "60")
  .option("--max-pages <count>", "Maximum pages to index", "40")
  .option("--full", "Prefer llms-full.txt if available")
  .option("--crawl-depth <depth>", "Depth to crawl nested markdown files (0 = disabled)", "0")
  .option("--max-workers <count>", "Maximum concurrent workers for deep crawling", "4")
  .option("--max-crawl-docs <count>", "Maximum documents to crawl during deep crawling", "100")
  .option("--verbose", "Verbose logging", false)
  .parse(process.argv);

const options = program.opts();

const cacheDir = options.cacheDir
  ? options.cacheDir
  : join(tmpdir(), "llmcpd-cache");
mkdirSync(cacheDir, { recursive: true });

const refreshMinutes = Number(options.refreshMins ?? 60);
const maxPages = Number(options.maxPages ?? 40);
const crawlDepth = Number(options.crawlDepth ?? 0);
const maxWorkers = Number(options.maxWorkers ?? 4);
const maxCrawlDocs = Number(options.maxCrawlDocs ?? 100);

await startServer({
  llmsUrl: options.url,
  cacheDir,
  refreshMinutes,
  maxPages,
  preferFull: Boolean(options.full),
  crawlDepth,
  maxWorkers,
  maxCrawlDocs,
  verbose: Boolean(options.verbose),
});