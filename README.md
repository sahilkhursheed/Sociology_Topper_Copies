# Sociology Optional — Topper Answer Copies Viewer

A zero-dependency Node.js utility and interactive browser-based viewer for UPSC Sociology Optional topper answer copies. The script fetches curated question datasets from Google Sheets, parses and normalizes topper metadata, links each question to its original Google Drive PDF page, and compiles everything into a standalone HTML viewer.


## Disclaimer

All content linked here has been originally created and published by their respective institutions and is publicly available on their official websites. No ownership is claimed over any of the materials. The files have only been compiled and organized to assist students in easy access and navigation. If any content owner has concerns or wishes their material to be removed, please contact me, and I will take prompt action.

## Features

* **Zero Dependencies:** Built entirely with Node.js built-in modules (`http`, `https`, `fs`, `path`). No `npm install` or third-party packages required.
* **Automatic Data Synchronization:** Fetches raw CSV tables directly from published Google Sheets endpoints and caches them locally.
* **Smart Filename & Metadata Parsing:** Extracts topper names, AIR ranks, coaching institutes (VisionIAS, LevelupIAS, EdenIAS, etc.), and paper categorization (Paper I / Paper II) automatically.
* **Interactive Client-Side Viewer (`viewer.html`):**
  * Instant multi-field search across questions, toppers, syllabus topics, and thinkers.
  * Filters for Paper I/II, specific toppers, questions only, and diagrams.
  * Infinite/batched scrolling for smooth rendering across thousands of rows.
  * Direct deep links to corresponding answer copy PDFs on Google Drive.
* **Embedded Web Server:** Includes a lightweight built-in HTTP server to serve the compiled viewer locally.

---

## Prerequisites

* **Node.js** (v14.0.0 or higher recommended)

---

## Quick Start

1. Save the script as `socio.js`.
2. Run the script:

```bash
 node socio.js
