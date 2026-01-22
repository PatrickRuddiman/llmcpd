import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CacheManager, type CacheEntry } from '../cache.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Mock fetch globally
global.fetch = vi.fn();

describe('CacheManager', () => {
  let cacheDir: string;
  let cacheManager: CacheManager;

  beforeEach(async () => {
    cacheDir = join(tmpdir(), `test-cache-${Date.now()}-${Math.random()}`);
    cacheManager = new CacheManager(cacheDir);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(cacheDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('hashUrl', () => {
    it('should generate consistent hashes for the same URL', () => {
      const url = 'https://example.com/test';
      const hash1 = (cacheManager as any).hashUrl(url);
      const hash2 = (cacheManager as any).hashUrl(url);
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/); // SHA256 hash
    });

    it('should generate different hashes for different URLs', () => {
      const url1 = 'https://example.com/test1';
      const url2 = 'https://example.com/test2';
      const hash1 = (cacheManager as any).hashUrl(url1);
      const hash2 = (cacheManager as any).hashUrl(url2);
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('filePath', () => {
    it('should generate correct file path for URL', () => {
      const url = 'https://example.com/test';
      const filePath = (cacheManager as any).filePath(url);
      expect(filePath).toContain(cacheDir);
      expect(filePath).toMatch(/\.json$/);
    });
  });

  describe('get', () => {
    it('should return null for non-existent cache entry', async () => {
      const result = await cacheManager.get('https://nonexistent.com');
      expect(result).toBeNull();
    });

    it('should return cached entry when it exists', async () => {
      const url = 'https://example.com/test';
      const entry: CacheEntry = {
        url,
        fetchedAt: new Date().toISOString(),
        status: 200,
        ok: true,
        contentType: 'text/plain',
        etag: null,
        lastModified: null,
        content: 'test content',
      };

      // Manually create cache file
      const filePath = (cacheManager as any).filePath(url);
      await fs.mkdir(cacheDir, { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(entry));

      const result = await cacheManager.get(url);
      expect(result).toEqual(entry);
    });

    it('should handle corrupted cache files gracefully', async () => {
      const url = 'https://example.com/test';
      const filePath = (cacheManager as any).filePath(url);
      await fs.mkdir(cacheDir, { recursive: true });
      await fs.writeFile(filePath, 'invalid json');

      const result = await cacheManager.get(url);
      expect(result).toBeNull();
    });
  });

  describe('set', () => {
    it('should save cache entry to file', async () => {
      const url = 'https://example.com/test';
      const entry: CacheEntry = {
        url,
        fetchedAt: new Date().toISOString(),
        status: 200,
        ok: true,
        contentType: 'text/plain',
        etag: null,
        lastModified: null,
        content: 'test content',
      };

      await cacheManager.set(entry);

      const filePath = (cacheManager as any).filePath(url);
      const fileContent = await fs.readFile(filePath, 'utf-8');
      const savedEntry = JSON.parse(fileContent);
      expect(savedEntry).toEqual(entry);
    });

    it('should create cache directory if it does not exist', async () => {
      // Remove cache dir to test creation
      try {
        await fs.rm(cacheDir, { recursive: true, force: true });
      } catch (error) {
        // Ignore
      }

      const url = 'https://example.com/test';
      const entry: CacheEntry = {
        url,
        fetchedAt: new Date().toISOString(),
        status: 200,
        ok: true,
        contentType: 'text/plain',
        etag: null,
        lastModified: null,
        content: 'test content',
      };

      await cacheManager.set(entry);

      const filePath = (cacheManager as any).filePath(url);
      const fileContent = await fs.readFile(filePath, 'utf-8');
      expect(JSON.parse(fileContent)).toEqual(entry);
    });
  });

  describe('fetch', () => {
    it('should return cached entry when not modified (304)', async () => {
      const url = 'https://example.com/test';
      const cachedEntry: CacheEntry = {
        url,
        fetchedAt: new Date().toISOString(),
        status: 200,
        ok: true,
        contentType: 'text/plain',
        etag: '"etag123"',
        lastModified: 'Wed, 21 Oct 2015 07:28:00 GMT',
        content: 'cached content',
      };

      // Mock fetch to return 304
      (global.fetch as any).mockResolvedValueOnce({
        status: 304,
        ok: false,
        headers: { get: () => null },
      });

      // Set up cache
      await cacheManager.set(cachedEntry);

      const result = await cacheManager.fetch(url);
      expect(result).toEqual(cachedEntry);
    });

    it('should fetch new content when cache is stale', async () => {
      const url = 'https://example.com/test';
      const newContent = 'new content';

      // Mock fetch to return new content
      (global.fetch as any).mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: {
          get: (header: string) => {
            if (header === 'content-type') return 'text/plain';
            if (header === 'etag') return '"new-etag"';
            if (header === 'last-modified') return 'Wed, 22 Oct 2015 07:28:00 GMT';
            return null;
          },
        },
        text: () => Promise.resolve(newContent),
      });

      const result = await cacheManager.fetch(url);

      expect(result.url).toBe(url);
      expect(result.status).toBe(200);
      expect(result.ok).toBe(true);
      expect(result.content).toBe(newContent);
      expect(result.contentType).toBe('text/plain');
      expect(result.etag).toBe('"new-etag"');
    });

    it('should handle fetch timeout', async () => {
      const url = 'https://example.com/test';

      // Mock fetch to reject with AbortError (simulating timeout)
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      (global.fetch as any).mockRejectedValueOnce(abortError);

      const result = await cacheManager.fetch(url, 100); // 100ms timeout

      expect(result.status).toBe(408); // Request timeout
      expect(result.ok).toBe(false);
      expect(result.content).toBe('');
    }, 1000); // Increase test timeout

    it('should handle network errors', async () => {
      const url = 'https://example.com/test';

      (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));

      await expect(cacheManager.fetch(url)).rejects.toThrow('Network error');
    });

    it('should include If-None-Match header when etag exists', async () => {
      const url = 'https://example.com/test';
      const cachedEntry: CacheEntry = {
        url,
        fetchedAt: new Date().toISOString(),
        status: 200,
        ok: true,
        contentType: 'text/plain',
        etag: '"etag123"',
        lastModified: null,
        content: 'cached content',
      };

      await cacheManager.set(cachedEntry);

      (global.fetch as any).mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: { get: () => null },
        text: () => Promise.resolve('new content'),
      });

      await cacheManager.fetch(url);

      expect(global.fetch).toHaveBeenCalledWith(url, {
        headers: { 'If-None-Match': '"etag123"' },
        signal: expect.any(AbortSignal),
      });
    });

    it('should include If-Modified-Since header when lastModified exists', async () => {
      const url = 'https://example.com/test';
      const cachedEntry: CacheEntry = {
        url,
        fetchedAt: new Date().toISOString(),
        status: 200,
        ok: true,
        contentType: 'text/plain',
        etag: null,
        lastModified: 'Wed, 21 Oct 2015 07:28:00 GMT',
        content: 'cached content',
      };

      await cacheManager.set(cachedEntry);

      (global.fetch as any).mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: { get: () => null },
        text: () => Promise.resolve('new content'),
      });

      await cacheManager.fetch(url);

      expect(global.fetch).toHaveBeenCalledWith(url, {
        headers: { 'If-Modified-Since': 'Wed, 21 Oct 2015 07:28:00 GMT' },
        signal: expect.any(AbortSignal),
      });
    });

    it('should save successful responses to cache', async () => {
      const url = 'https://example.com/test';
      const content = 'test content';

      (global.fetch as any).mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: { get: () => 'text/plain' },
        text: () => Promise.resolve(content),
      });

      await cacheManager.fetch(url);

      // Verify it was cached
      const cached = await cacheManager.get(url);
      expect(cached).not.toBeNull();
      expect(cached?.content).toBe(content);
    });

    it('should cache failed responses', async () => {
      const url = 'https://example.com/test';

      (global.fetch as any).mockResolvedValueOnce({
        status: 404,
        ok: false,
        headers: { get: () => null },
        text: () => Promise.resolve('Not found'),
      });

      const result = await cacheManager.fetch(url);
      expect(result.status).toBe(404);
      expect(result.ok).toBe(false);

      // Verify it was cached (current behavior caches all responses)
      const cached = await cacheManager.get(url);
      expect(cached).not.toBeNull();
      expect(cached?.status).toBe(404);
      expect(cached?.ok).toBe(false);
    });
  });
});