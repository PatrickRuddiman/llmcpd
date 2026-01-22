import { createHash } from "crypto";
import { promises as fs } from "fs";
import { join } from "path";

export interface CacheEntry {
  url: string;
  fetchedAt: string;
  status: number;
  ok: boolean;
  contentType?: string;
  etag?: string | null;
  lastModified?: string | null;
  content: string;
}

export class CacheManager {
  constructor(private cacheDir: string) {}

  private hashUrl(url: string) {
    return createHash("sha256").update(url).digest("hex");
  }

  private filePath(url: string) {
    return join(this.cacheDir, `${this.hashUrl(url)}.json`);
  }

  async get(url: string): Promise<CacheEntry | null> {
    try {
      const data = await fs.readFile(this.filePath(url), "utf-8");
      return JSON.parse(data) as CacheEntry;
    } catch (error) {
      return null;
    }
  }

  async set(entry: CacheEntry): Promise<void> {
    await fs.mkdir(this.cacheDir, { recursive: true });
    const path = this.filePath(entry.url);
    await fs.writeFile(path, JSON.stringify(entry, null, 2));
  }

  async fetch(url: string, timeoutMs = 15000): Promise<CacheEntry> {
    const cached = await this.get(url);
    const headers: Record<string, string> = {};
    if (cached?.etag) headers["If-None-Match"] = cached.etag;
    if (cached?.lastModified) headers["If-Modified-Since"] = cached.lastModified;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { headers, signal: controller.signal });
      if (response.status === 304 && cached) {
        return cached;
      }

      const contentType = response.headers.get("content-type") ?? undefined;
      const text = await response.text();
      const entry: CacheEntry = {
        url,
        fetchedAt: new Date().toISOString(),
        status: response.status,
        ok: response.ok,
        contentType,
        etag: response.headers.get("etag"),
        lastModified: response.headers.get("last-modified"),
        content: text,
      };
      await this.set(entry);
      return entry;
    } finally {
      clearTimeout(timeout);
    }
  }
}