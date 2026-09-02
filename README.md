# Sociology Optional — Topper Answer Copies Viewer

A zero-dependency Node.js utility and interactive browser-based viewer for UPSC Sociology Optional topper answer copies. The script fetches curated question datasets from Google Sheets, parses and normalizes topper metadata, links each question to its original Google Drive PDF page, and compiles everything into a standalone HTML viewer.

## Image
<img width="1350" height="602" alt="image" src="https://github.com/user-attachments/assets/495507b1-073c-4129-b241-02ad86fa6e0c" />

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

### Step 1: Install Node.js (One-Time Setup)
This project runs using a free tool called **Node.js**.

1. Visit [nodejs.org](https://nodejs.org/).
2. Download the version labeled **LTS** (Long Term Support).
3. Run the downloaded installer and keep clicking **Next** until it finishes.

---

### Step 2: Download This Project
1. Scroll to the top of this GitHub page.
2. Click the green **Code** button and select **Download ZIP**.
3. Locate the downloaded ZIP file on your computer, right-click it, and select **Extract All** (Windows) or double-click to unzip (Mac).

---

### Step 3: Open the Project Folder in Terminal

#### On Windows:
1. Open the unzipped folder.
2. Click on the folder's address bar at the top of File Explorer.
3. Type `cmd` and press **Enter**. A black command window will open directly in this folder.

#### On Mac:
1. Open the unzipped folder in **Finder**.
2. Right-click the folder (or hold `Control` and click).
3. Select **New Terminal at Folder** (or open the Terminal app and drag the folder into it).

---

### Step 4: Run the Viewer

Copy and paste this command into your terminal/command window, then press **Enter**:
```
node socio.js
