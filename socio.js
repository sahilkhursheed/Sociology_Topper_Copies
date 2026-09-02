#!/usr/bin/env node
/**
 * Sociology Optional — Topper Answer Copies Viewer
 * Built with Node.js — zero npm dependencies, pure built-in modules.
 *
 * Usage:
 *   node build_viewer.js               # download data + build viewer + serve at localhost:3000
 *   node build_viewer.js --build       # just build viewer.html, no server
 *   node build_viewer.js --serve       # just serve existing viewer.html
 *   node build_viewer.js --port 8080   # custom port
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ─── Config ──────────────────────────────────────────────────────────────────
const SHEET_ID = '16QR2YCunO5tem8yf2viqNl4R39YjDgLfPE7glouAkKo';
const QUESTION_GIDS = ['1332884905', '1871204627'];
const DRIVE_GID = '2085998453';
const VIEWER_FILE = 'viewer.html';
const CSV_QUESTIONS = 'socio_questions.csv';
const CSV_QUESTIONS2 = 'socio_questions2.csv';
const CSV_DRIVE = 'socio_drive_map.csv';

// ─── HTTP fetch (built-in, no axios/node-fetch needed) ──────────────────────
function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ─── Simple CSV parser (no external lib) ────────────────────────────────────
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// ─── Step 1: Download CSVs ──────────────────────────────────────────────────
async function downloadCSV(gid, outputFile) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${gid}`;
  console.log(`  Fetching: ${url}`);
  const text = await fetch(url);
  fs.writeFileSync(outputFile, text);
  const lines = text.split('\n').length - 1;
  console.log(`  Saved: ${outputFile} (${lines} rows)`);
}

async function fetchData() {
  const files = [
    [QUESTION_GIDS[0], CSV_QUESTIONS],
    [QUESTION_GIDS[1], CSV_QUESTIONS2],
    [DRIVE_GID, CSV_DRIVE],
  ];
  for (let i = 0; i < files.length; i++) {
    const [gid, fname] = files[i];
    if (!fs.existsSync(fname)) {
      console.log(`\n[${i + 1}/3] Downloading...`);
      await downloadCSV(gid, fname);
    } else {
      console.log(`\n[${i + 1}/3] Using existing ${fname}`);
    }
  }
}

// ─── Step 2: Parse topper from filename ─────────────────────────────────────
function parseTopper(filename) {
  let name = filename.replace('.pdf', '').trim();
  let air = '';
  let m = name.match(/AIR[\s_-]*(\d+)/i) || name.match(/rank[\s_-]*(\d+)/i);
  if (m) air = m[1];

  let clean = name
    .replace(/AIR[\s_-]*\d+/gi, '')
    .replace(/rank[\s_-]*\d+/gi, '')
    .replace(/\b(20\d{2})\b/g, '');

  const noise = [
    'LevelupIAS', 'Levelup', 'VisionIAS', 'VISION', 'EdenIAS',
    'Sociology', 'socio', 'Socio', 'crash course', 'Crash course', 'Crash Course',
    'Programme', 'Program', 'Foundation', 'Test series', 'Test-Series',
    'Test', 'Full Lenght Test', 'copy', 'marks', 'Answer', 'Answers',
    'Answer copy', 'Booklet', 'Toppers Answer', 'reliableANDvalid', 'DAMP', 'pdf',
  ];
  for (const w of noise) {
    clean = clean.replace(new RegExp(w, 'gi'), '');
  }
  clean = clean.replace(/^[\s\-_]+|[\s\-_]+$/g, '').replace(/[\s\-_]+/g, ' ').trim();
  if (!clean) clean = name;

  let coaching = '';
  const lower = filename.toLowerCase();
  if (lower.includes('levelupias') || lower.includes('levelup')) coaching = 'LevelupIAS';
  else if (lower.includes('visionias') || lower.includes('vision')) coaching = 'VisionIAS';
  else if (lower.includes('edenias') || lower.includes('eden')) coaching = 'EdenIAS';
  else if (lower.includes('damp')) coaching = 'DAMP';

  return { air, topper: clean, coaching };
}

function extractDigits(s) {
  const m = s.match(/(\d+)/);
  return m ? m[1] : s;
}

// ─── Step 3: Build viewer.html ──────────────────────────────────────────────
function buildViewer() {
  const driveText = fs.readFileSync(CSV_DRIVE, 'utf-8');
  const driveRows = parseCSV(driveText);
  const driveMap = {};
  for (let i = 1; i < driveRows.length; i++) {
    if (driveRows[i].length >= 2 && driveRows[i][0].trim()) {
      driveMap[driveRows[i][0].trim()] = driveRows[i][1].trim();
    }
  }

  const rows = [];
  for (const csvFile of [CSV_QUESTIONS, CSV_QUESTIONS2]) {
    if (!fs.existsSync(csvFile)) continue;
    const text = fs.readFileSync(csvFile, 'utf-8');
    const csvRows = parseCSV(text);
    if (csvRows.length < 2) continue;

    const header = csvRows[0].map((h) => h.trim().toLowerCase());
    const col = (name) => header.indexOf(name);

    for (let i = 1; i < csvRows.length; i++) {
      const r = csvRows[i];
      const get = (name) => {
        const idx = col(name);
        return idx >= 0 && idx < r.length ? r[idx].trim() : '';
      };

      const filename = get('filename');
      if (!filename) continue;

      let question = get('question');
      let intro = get('introduction');
      let page = extractDigits(get('page'));
      let thinkers = get('thinkers');
      let diagram = get('diagram');
      let syllabus = get('syllabus');

      const { air, topper, coaching } = parseTopper(filename);
      const driveId = driveMap[filename] || '';
      const driveLink = driveId ? `https://drive.google.com/file/d/${driveId}/view` : '';

      let paper = '';
      if (/paper\s*[–-]\s*i\b/i.test(syllabus) || /paper\s+i\b/i.test(syllabus)) paper = 'Paper I';
      else if (/paper\s*[–-]\s*ii\b/i.test(syllabus) || /paper\s+ii\b/i.test(syllabus)) paper = 'Paper II';

      if (question === 'NA') question = '';
      if (intro === 'Not mentioned') intro = '';
      if (thinkers === 'Not mentioned') thinkers = '';
      if (diagram === 'No diagram' || diagram === 'Not mentioned') diagram = '';
      if (syllabus === 'NA') syllabus = '';

      rows.push({
        air, topper, coaching, question, intro, page,
        thinkers, diagram, syllabus, paper, drive_link: driveLink,
      });
    }
  }

  const total = rows.length;
  const withQ = rows.filter((r) => r.question).length;
  const hasDrive = rows.filter((r) => r.drive_link).length;
  const uniquePDFs = Object.keys(driveMap).length;
  const papers = {};
  rows.forEach((r) => {
    const p = r.paper || 'Unspecified';
    papers[p] = (papers[p] || 0) + 1;
  });

  console.log(`\n  Parsed ${total} rows (${withQ} with question text)`);
  console.log(`  PDFs mapped to Drive: ${hasDrive}/${total}`);
  console.log(`  Paper distribution: ${JSON.stringify(papers)}`);

  const topperSet = [...new Set(rows.map((r) => r.topper))].sort();
  let topperOptions = '';
  for (const t of topperSet) {
    const display = t.length > 40 ? t.slice(0, 40) + '...' : t;
    topperOptions += `<option value="${escAttr(t)}">${escHtml(display)}</option>\n`;
  }

  const jsData = JSON.stringify(rows);
  const html = buildHTML({
    title: 'Sociology Optional - Topper Answer Copies',
    total, withQ, hasDrive,
    p1: papers['Paper I'] || 0,
    p2: papers['Paper II'] || 0,
    p3: papers['Unspecified'] || 0,
    uniquePDFs,
    topperOptions,
    jsData,
  });

  fs.writeFileSync(VIEWER_FILE, html);
  console.log(`\n  ${VIEWER_FILE} ready!`);
}

// ─── HTML escaping ──────────────────────────────────────────────────────────
function escHtml(s) {
  if (!s) return '';
  return s.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>');
}
function escAttr(s) {
  if (!s) return '';
  return s.replace(/&/g, '&').replace(/"/g, '&quot;').replace(/</g, '<').replace(/>/g, '>');
}

// ─── HTML template ──────────────────────────────────────────────────────────
function buildHTML(opts) {
  const { title, total, withQ, hasDrive, p1, p2, p3, uniquePDFs, topperOptions, jsData } = opts;

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<link href="https://fonts.googleapis.com/css2?family=Inconsolata:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Inconsolata',monospace; background:#fff; color:#374151; padding:1.5rem; max-width:1400px; margin:0 auto; }
  h1 { font-size:1.6rem; color:#1f2937; margin-bottom:0.25rem; }
  .subtitle { color:#6b7280; margin-bottom:1rem; font-size:0.85rem; }
  .stats { display:flex; gap:1rem; margin-bottom:1rem; font-size:0.8rem; color:#6b7280; flex-wrap:wrap; }
  .stats span { background:#f3f4f6; padding:3px 10px; border-radius:4px; }
  .controls { display:flex; gap:0.75rem; align-items:center; margin-bottom:0.75rem; flex-wrap:wrap; }
  .search { padding:0.5rem 0.75rem; border:1px solid #d1d5db; border-radius:6px; font-family:inherit; font-size:0.85rem; width:320px; outline:none; }
  .search:focus { border-color:#3b82f6; box-shadow:0 0 0 2px rgba(59,130,246,0.15); }
  .select { padding:0.5rem 0.5rem; border:1px solid #d1d5db; border-radius:6px; font-family:inherit; font-size:0.8rem; outline:none; background:#fff; cursor:pointer; }
  .clear-btn { padding:0.5rem 1rem; border:1px solid #d1d5db; border-radius:6px; font-family:inherit; font-size:0.8rem; cursor:pointer; font-weight:600; color:#6b7280; background:#fff; transition:all 0.15s; }
  .clear-btn:hover { border-color:#3b82f6; color:#3b82f6; }
  .count { color:#6b7280; font-size:0.85rem; margin-bottom:0.75rem; font-weight:600; }
  table { width:100%; border-collapse:collapse; }
  thead { position:sticky; top:0; background:#fff; z-index:1; }
  th { text-align:left; padding:0.6rem 0.5rem; border-bottom:2px solid #e5e7eb; font-size:0.78rem; color:#6b7280; font-weight:600; white-space:nowrap; }
  th.sortable { cursor:pointer; user-select:none; }
  th.sortable:hover { color:#3b82f6; }
  th .arrow { font-size:0.7rem; opacity:0.5; }
  td { padding:0.5rem 0.5rem; border-bottom:1px solid #f3f4f6; font-size:0.82rem; line-height:1.5; vertical-align:top; }
  tr:hover { background:#eff6ff; }
  a { color:#3b82f6; text-decoration:none; font-weight:600; }
  a:hover { text-decoration:underline; }
  .air-badge { display:inline-block; background:#3b82f6; color:#fff; padding:1px 7px; border-radius:4px; font-size:0.7rem; font-weight:700; margin-right:4px; }
  .topper-name { font-weight:600; color:#1f2937; }
  .coaching { font-size:0.7rem; color:#9ca3af; }
  .question-text { color:#374151; }
  .intro-text { color:#6b7280; font-size:0.78rem; margin-top:2px; }
  .thinker-tag { display:inline-block; background:#dbeafe; color:#1e40af; padding:1px 6px; border-radius:3px; font-size:0.72rem; margin:1px; }
  .diagram-tag { display:inline-block; background:#fef3c7; color:#92400e; padding:1px 6px; border-radius:3px; font-size:0.72rem; margin:1px; }
  .syllabus-text { color:#6b7280; font-size:0.78rem; }
  .loading { text-align:center; padding:2rem; color:#6b7280; }
  mark { background:#fde68a; padding:0 2px; border-radius:2px; }
  .pdf-btn { display:inline-block; background:#3b82f6; color:#fff !important; padding:5px 14px; border-radius:6px; font-size:0.78rem; font-weight:700; text-decoration:none; white-space:nowrap; }
  .pdf-btn:hover { background:#2563eb; text-decoration:none; }
</style></head><body>
<h1>${title}</h1>
<p class="subtitle">Online viewer | ${total} rows | ${withQ} questions | ${hasDrive} PDFs on Drive</p>

<div class="stats">
  <span>Paper I: ${p1}</span>
  <span>Paper II: ${p2}</span>
  <span>Unspecified: ${p3}</span>
  <span>Unique PDFs: ${uniquePDFs}</span>
</div>

<div class="controls">
  <input type="text" id="search" class="search" placeholder="Search questions, toppers, syllabus..." autofocus>
  <select id="paperFilter" class="select" onchange="applyFilters()">
    <option value="">All Papers</option>
    <option value="Paper I">Paper I</option>
    <option value="Paper II">Paper II</option>
    <option value="Unspecified">Unspecified</option>
  </select>
  <select id="topperFilter" class="select" onchange="applyFilters()">
    <option value="">All Toppers</option>
    ${topperOptions}
  </select>
  <label style="font-size:0.78rem;color:#6b7280;cursor:pointer;">
    <input type="checkbox" id="onlyQuestions" onchange="applyFilters()"> Questions only
  </label>
  <label style="font-size:0.78rem;color:#6b7280;cursor:pointer;">
    <input type="checkbox" id="onlyDiagrams" onchange="applyFilters()"> With diagrams
  </label>
  <button class="clear-btn" onclick="clearFilters()">Clear Filters</button>
</div>

<div class="count" id="count"></div>

<table><thead>
<tr>
  <th class="sortable" onclick="sortBy('topper')">Topper <span class="arrow">&#x21C5;</span></th>
  <th>Question & Introduction</th>
  <th>Thinkers</th>
  <th>Syllabus Topic</th>
  <th>Open Answer Copy</th>
</tr>
</thead><tbody id="tbody">
<tr class="loading"><td colspan="5">Loading rows...</td></tr>
</tbody></table>

<script>
const DATA = ${jsData};

// Precompute indexable text and boolean flags for ultra-fast filtering
for (var i = 0; i < DATA.length; i++) {
  var r = DATA[i];
  r._search = (
    (r.question || '') + ' ' +
    (r.topper || '') + ' ' +
    (r.air || '') + ' ' +
    (r.thinkers || '') + ' ' +
    (r.syllabus || '') + ' ' +
    (r.intro || '') + ' ' +
    (r.coaching || '')
  ).toLowerCase();
  r._hasQ = Boolean(r.question);
  r._hasD = Boolean(r.diagram);
}

var PAGE_SIZE = 80;
var displayedCount = 0;
var currentFiltered = [];
var sortKey = '';
var sortAsc = true;
var debounceTimer = null;

function escapeHtml(s) {
  if (!s) return '';
  return s.replace(/&/g,'&').replace(/</g,'<').replace(/>/g,'>');
}

function buildRowHtml(r) {
  var airBadge = r.air ? '<span class="air-badge">AIR ' + escapeHtml(r.air) + '</span>' : '';
  var coachingHtml = r.coaching ? '<br><span class="coaching">' + escapeHtml(r.coaching) + '</span>' : '';
  var questionHtml = '';
  if (r.question) {
    questionHtml = '<div class="question-text">' + escapeHtml(r.question) + '</div>';
  }
  if (r.intro) {
    var iText = escapeHtml(r.intro);
    if (iText.length > 200) iText = iText.substring(0, 200) + '...';
    questionHtml += '<div class="intro-text">' + iText + '</div>';
  }
  if (!questionHtml) questionHtml = '<span class="coaching">&mdash;</span>';

  var thinkersHtml = '';
  if (r.thinkers && r.thinkers !== 'Not mentioned') {
    var tags = r.thinkers.split('}').join('{').split('{');
    for (var t = 0; t < tags.length; t++) {
      var tag = tags[t].replace(/[{}]/g, '').trim();
      if (tag) thinkersHtml += '<span class="thinker-tag">' + escapeHtml(tag) + '</span>';
    }
  }

  var diagramHtml = '';
  if (r.diagram) {
    var dText = r.diagram.length > 60 ? r.diagram.substring(0, 60) + '...' : r.diagram;
    diagramHtml = '<br><span class="diagram-tag">' + escapeHtml(dText) + '</span>';
  }

  var syllabusHtml = r.syllabus ? '<div class="syllabus-text">' + escapeHtml(r.syllabus) + '</div>' : '';

  var pdfHtml = '';
  if (r.drive_link) {
    var label = r.page && /^\\d+$/.test(r.page) ? 'Open Pg ' + escapeHtml(r.page) : 'Open PDF';
    pdfHtml = '<a href="' + r.drive_link + '" target="_blank" class="pdf-btn">' + label + '</a>';
  } else {
    pdfHtml = '<span class="coaching">&mdash;</span>';
  }

  return '<tr>' +
    '<td>' + airBadge + '<span class="topper-name">' + escapeHtml(r.topper) + '</span>' + coachingHtml + '</td>' +
    '<td>' + questionHtml + '</td>' +
    '<td>' + thinkersHtml + diagramHtml + '</td>' +
    '<td>' + syllabusHtml + '</td>' +
    '<td>' + pdfHtml + '</td>' +
  '</tr>';
}

function updateCount() {
  var countEl = document.getElementById('count');
  if (currentFiltered.length === 0) {
    countEl.textContent = '0 matching rows (of ' + DATA.length + ' total)';
  } else if (displayedCount < currentFiltered.length) {
    countEl.textContent = 'Showing ' + displayedCount + ' of ' + currentFiltered.length + ' matching rows (' + DATA.length + ' total)';
  } else {
    countEl.textContent = currentFiltered.length + ' of ' + DATA.length + ' rows';
  }
}

function renderNextBatch() {
  if (displayedCount >= currentFiltered.length) return;
  var end = Math.min(displayedCount + PAGE_SIZE, currentFiltered.length);
  var html = [];
  for (var i = displayedCount; i < end; i++) {
    html.push(buildRowHtml(currentFiltered[i]));
  }
  document.getElementById('tbody').insertAdjacentHTML('beforeend', html.join(''));
  displayedCount = end;
  updateCount();
}

function renderInitialBatches() {
  renderNextBatch();
  while (
    displayedCount < currentFiltered.length &&
    (window.innerHeight + window.scrollY) >= (document.documentElement.scrollHeight - 500)
  ) {
    renderNextBatch();
  }
}

function applyFilters() {
  var q = document.getElementById('search').value.toLowerCase().trim();
  var queryWords = q ? q.split(/\\s+/).filter(Boolean) : [];
  var paper = document.getElementById('paperFilter').value;
  var topper = document.getElementById('topperFilter').value;
  var onlyQ = document.getElementById('onlyQuestions').checked;
  var onlyD = document.getElementById('onlyDiagrams').checked;

  var result = [];
  for (var i = 0; i < DATA.length; i++) {
    var r = DATA[i];
    if (onlyQ && !r._hasQ) continue;
    if (onlyD && !r._hasD) continue;
    if (paper && r.paper !== paper) continue;
    if (topper && r.topper !== topper) continue;
    if (queryWords.length > 0) {
      var match = true;
      for (var j = 0; j < queryWords.length; j++) {
        if (r._search.indexOf(queryWords[j]) === -1) {
          match = false;
          break;
        }
      }
      if (!match) continue;
    }
    result.push(r);
  }

  currentFiltered = result;
  displayedCount = 0;
  var tbody = document.getElementById('tbody');
  tbody.innerHTML = '';

  if (currentFiltered.length === 0) {
    tbody.innerHTML = '<tr class="loading"><td colspan="5">No matching records found.</td></tr>';
    updateCount();
    return;
  }

  renderInitialBatches();
}

function clearFilters() {
  document.getElementById('search').value = '';
  document.getElementById('paperFilter').value = '';
  document.getElementById('topperFilter').value = '';
  document.getElementById('onlyQuestions').checked = false;
  document.getElementById('onlyDiagrams').checked = false;
  applyFilters();
}

function sortBy(key) {
  if (sortKey === key) { sortAsc = !sortAsc; }
  else { sortKey = key; sortAsc = true; }
  DATA.sort(function(a, b) {
    var va = a[key] || ''; var vb = b[key] || '';
    if (key === 'page') { va = parseInt(va) || 0; vb = parseInt(vb) || 0; }
    if (va < vb) return sortAsc ? -1 : 1;
    if (va > vb) return sortAsc ? 1 : -1;
    return 0;
  });
  applyFilters();
}

window.addEventListener('scroll', function() {
  if ((window.innerHeight + window.scrollY) >= (document.documentElement.scrollHeight - 700)) {
    renderNextBatch();
  }
});

document.getElementById('search').addEventListener('input', function() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(applyFilters, 120);
});

// Run initial filter and render
applyFilters();
</script></body></html>`;
}

// ─── Simple HTTP server (built-in, no Express needed) ───────────────────────
function startServer(port) {
  const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/viewer.html') {
      if (!fs.existsSync(VIEWER_FILE)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('viewer.html not found. Run without --serve first to build it.');
        return;
      }
      const html = fs.readFileSync(VIEWER_FILE, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found. Open http://localhost:' + port);
    }
  });

  server.listen(port, () => {
    console.log(`\n  Server running at http://localhost:${port}`);
    console.log(`  Open this URL in your browser.`);
    console.log(`  Press Ctrl+C to stop.`);
  });
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const buildOnly = args.includes('--build');
  const serveOnly = args.includes('--serve');
  const portIdx = args.indexOf('--port');
  const port = portIdx >= 0 && args[portIdx + 1] ? parseInt(args[portIdx + 1]) : 3000;

  console.log('='.repeat(60));
  console.log('  Sociology Optional - Topper Answer Copies Viewer');
  console.log('  (Node.js — zero dependencies, fast in-memory filter)');
  console.log('='.repeat(60));

  if (!serveOnly) {
    await fetchData();
    console.log('\n  Building viewer...');
    buildViewer();
  }

  if (!buildOnly) {
    startServer(port);
  } else {
    console.log('\n' + '='.repeat(60));
    console.log(`  DONE! Open '${VIEWER_FILE}' in your browser.`);
    console.log('='.repeat(60));
  }
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});