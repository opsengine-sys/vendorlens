# VendorLens — Enterprise Vendor Intelligence

## Overview
Single-page app for enterprise vendor due diligence. Assesses vendors across legal, compliance, security, privacy, financial, and operational dimensions. Scores, sources, and verifies all findings.

## Architecture
- **Frontend**: Pure HTML/CSS/JS — single file `vendor-intel.html`
- **Server**: `static-server.js` — simple Node.js HTTP server on port 5000
- **CORS Proxy**: `crawl4ai-cors-proxy.js` — optional proxy for Crawl4AI on port 8787

## Two-Layer System
1. **Layer 1 — Web Crawler**: Validates URLs via HEAD checks, scrapes reachable pages via browser CORS proxies or optional Crawl4AI. All 404s are logged and excluded. Content is vectorized (keyword chunking) for retrieval.
2. **Layer 2 — Multi-Agent AI**: 5 parallel focused AI agents, each with domain-specific vector context:
   - Agent: Compliance & Certifications (ISO 27701, SOC2, etc.)
   - Agent: Security posture
   - Agent: Privacy & Data
   - Agent: Legal & Financial + Operational
   - Agent: Synthesis (scores, flags, verdict, vendor log)

## Key Features
- URL pre-validation before scraping — prevents hallucinated document links
- Crawl Log tab — full visibility into every URL attempted and its status
- Source proof links on every flag and certification
- ISO 27701 explicit dedicated detection
- Verification log that actually updates `gData` after accepted changes (fixes toggling bug)
- JSON export of full assessment data

## Files
- `vendor-intel.html` — entire frontend application (~1900 lines)
- `static-server.js` — serves the HTML on port 5000
- `crawl4ai-cors-proxy.js` — optional CORS proxy for Crawl4AI
- `zipFile.zip` — unused archive

## Running
Workflow: `Start application` → `node static-server.js` → port 5000
