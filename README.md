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

## CLI Options

```
--url <url>           URL to llms.txt (required)
--cache-dir <path>    Cache directory (default: OS temp)
--refresh-mins <n>    Background reindex interval in minutes (default: 60)
--max-pages <n>       Maximum pages to index (default: 40)
--full                Prefer llms-full.txt if available
--verbose             Verbose logging
```

## MCP Tools

- `search` — Search indexed content
- `fetch` — Fetch cached content for a URL
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

- This project is optimized for fast local lookups, not deep crawling.
- For large docs, prefer using `llms-full.txt`.
- Indexing respects `--max-pages` to avoid overload.

## License

MIT