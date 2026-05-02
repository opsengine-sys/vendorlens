# VendorLens — Enterprise Vendor Intelligence

## Overview
Single-page app for enterprise vendor due diligence. Assesses vendors across legal, compliance, security, privacy, financial, and operational dimensions. Scores, sources, and verifies all findings.

## Architecture
- **Frontend**: Pure HTML/CSS/JS — single file `vendor-intel.html`
- **Server**: `static-server.js` — Node.js HTTP server on port 5000
- **LangExtract**: `extract-service.py` — Flask service on port 5001 (spawned by server)

## Key Features
- 8 AI providers: Groq, Gemini, OpenAI, Anthropic, Azure OpenAI, Mistral, Together AI, Ollama
- Provider health dashboard — chips in topbar ping all configured providers on load
- Multi-agent crawl pipeline: parallel URL validation → parallel page fetch (server+Jina race) → discovered link expansion
- 5 parallel AI agents: Compliance, Security, Privacy, Legal/Financial, Synthesis
- LangExtract grounded citations on every field
- Token budget estimator + rate-limit auto-switch
- Data freshness re-verification
- Vendor comparison mode
- Authentication gate (set VL_PASSWORD env var to enable)
- crawl4ai integration (set VL_CRAWL4AI_URL env var)

## Crawl Pipeline
1. **URL pre-validation**: 25 priority pages HEAD-checked in parallel
2. **Parallel fetch**: server-side scraper vs Jina AI Reader race — fastest with content wins
3. **Link discovery**: up to 25 discovered links from scraped pages, also fetched in parallel
4. **Vector indexing**: keyword chunking, 12k char per page limit

## AI Modal — Provider Groups
- **Standard**: Groq (free, fast), Gemini (free tier), OpenAI, Anthropic/Claude, Mistral, Together AI, Ollama (local)
- **Enterprise**: Azure OpenAI (resource URL + deployment)

## Server Endpoints
- `GET /api/scrape?url=…` — server-side page fetcher (rotating UA, cache-busting)
- `POST /api/proxy-ai` — relay AI calls server-side (CORS bypass for Azure/Mistral/Together)
- `POST /api/crawl4ai` — proxy to configured crawl4ai instance (needs VL_CRAWL4AI_URL)
- `POST /api/extract` → Python LangExtract service
- `GET /api/extract/health`
- `GET /api/config` — returns `{authRequired, crawl4aiConfigured}`
- `POST /api/auth` — password check, returns signed session token
- `GET /api/health`

## Environment Variables
- `VL_PASSWORD` — set to enable the authentication gate (leave unset for open access)
- `VL_CRAWL4AI_URL` — URL of a crawl4ai instance (e.g. `http://localhost:11235`)
- `PORT` — server port (default 5000)

## Files
- `vendor-intel.html` — entire frontend application (~3400 lines)
- `static-server.js` — Node.js HTTP server with auth, scraping, AI proxy, crawl4ai proxy
- `extract-service.py` — Flask LangExtract grounding service

## Running
Workflow: `Start application` → `node static-server.js` → port 5000

## Auth
Set `VL_PASSWORD=mysecret` in Replit Secrets to enable the login gate.
Without it, the app is open. The auth token is HMAC-signed and valid for 24 hours per session.

## crawl4ai Integration
Point `VL_CRAWL4AI_URL` at a running crawl4ai instance (Docker or local).
The frontend's "Advanced: connect crawl4ai" option in the AI modal also works directly from the browser.
