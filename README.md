# llmcpd

Turn `llms.txt` + `llms-full.txt` into a fast MCP server with caching and search.

## Quick Start

```bash
npx -y llmcpd --url https://example.com/llms.txt
```

## Features

- MCP tools for search, fetch, list sections/links, summaries, and status.
- Background indexing (refresh interval).
- Disk cache with ETag/Last-Modified support.
- Markdown fallback for HTML pages (`.md` URLs).
- Optional `llms-full.txt` ingestion.
- **Deep crawling of nested markdown files using worker threads** for expanded search corpus.

## CLI Options

```
--url <url>              URL to llms.txt (required)
--cache-dir <path>       Cache directory (default: OS temp)
--refresh-mins <n>       Background reindex interval in minutes (default: 60)
--max-pages <n>          Maximum pages to index (default: 40)
--full                   Prefer llms-full.txt if available
--crawl-depth <n>        Depth to crawl nested markdown files (default: 0, disabled)
--max-workers <n>        Maximum concurrent workers for deep crawling (default: 4)
--max-crawl-docs <n>     Maximum documents to crawl during deep crawling (default: 100)
--verbose                Verbose logging
```

## MCP Tools

- `search` — Search indexed content
- `fetch` — Fetch content for a URL (uses cache when available and fetches on cache miss, with `.md` fallback)
- `list_sections` — List sections from llms.txt
- `list_links` — List links (optionally by section)
- `summary` — Simple summary of cached content
- `status` — Indexing status
- `reindex` — Force reindex

## Development

```bash
npm install
npm run build
node dist/cli.js --url https://example.com/llms.txt
```

## Notes

- This project is optimized for fast local lookups with optional deep crawling.
- For large docs, prefer using `llms-full.txt`.
- Indexing respects `--max-pages` to avoid overload.
- Deep crawling (`--crawl-depth`) uses worker threads to parallelize fetching and indexing of nested markdown files.
- Set `--crawl-depth 1` to index markdown files linked from the main pages, `--crawl-depth 2` for two levels, etc.
- Deep crawling only follows markdown links (`.md` files) to keep the corpus focused.
- Use `--max-crawl-docs` to limit total documents crawled and prevent memory issues (default: 100).

## License

MIT
