#!/usr/bin/env node
/**
 * Sociology Optional — Topper Answer Copies Viewer
 * Node.js, zero npm dependencies. Infinite scroll + debounced search = smooth.
 *
 * Rows whose Drive PDF is not openable (deleted / not shared) are dropped from
 * the dataset entirely, so they never appear in the table or in search results.
 *
 * Usage:
 *   node build_socio_viewer.js               # download + check PDFs + build + serve
 *                                            # (check runs only if the cache is missing or >7 days old)
 *   node build_socio_viewer.js --build       # verify (if needed) + build viewer.html
 *   node build_socio_viewer.js --check       # re-verify every Drive PDF (slow, resumable), then build
 *   node build_socio_viewer.js --check-only  # only re-verify, write status file
 *   node build_socio_viewer.js --strict      # drop unopenable rows from the data entirely
 *   node build_socio_viewer.js --refresh     # re-download the sheet CSVs, then build
 *   node build_socio_viewer.js --no-check    # skip the Drive check entirely (fast)
 *   node build_socio_viewer.js --serve       # just serve existing viewer.html
 *   node build_socio_viewer.js --port 8080   # custom port
 */
const https = require('https');
const http = require('http');
const net = require('net');
const tls = require('tls');
const fs = require('fs');
const { URL } = require('url');

const SHEET_ID = '16QR2YCunO5tem8yf2viqNl4R39YjDgLfPE7glouAkKo';
const QUESTION_GIDS = ['1332884905', '1871204627'];
const DRIVE_GID = '2085998453';
const VIEWER_FILE = 'viewer.html';
const CSV_QUESTIONS = 'socio_questions.csv';
const CSV_QUESTIONS2 = 'socio_questions2.csv';
const CSV_DRIVE = 'socio_drive_map.csv';
const STATUS_FILE = 'socio_drive_status.json';
const STATUS_MAX_AGE_DAYS = 7;   // re-verify PDFs automatically after this long

// ─── Text fetch with redirects (uses the proxy-aware client below) ──────────
async function fetchText(url) {
  for (let hop = 0; hop < 5; hop++) {
    const r = await httpGet(url, 60000);
    if (r.status >= 300 && r.status < 400 && r.location) {
      url = r.location.startsWith('http') ? r.location : new URL(r.location, url).toString();
      continue;
    }
    if (r.status !== 200) throw new Error('HTTP ' + r.status + ' for ' + url);
    return r.body;
  }
  throw new Error('Too many redirects for ' + url);
}

function parseCSV(text) {
  const rows = []; let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) { if (c === '"') { if (text[i+1] === '"') { field += '"'; i++; } else inQ = false; } else field += c; }
    else { if (c === '"') inQ = true; else if (c === ',') { row.push(field); field = ''; } else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; } else if (c !== '\r') field += c; }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// A healthy sheet CSV has a header row and plenty of data rows. A truncated
// download or an HTML error page parses to almost nothing, so reject it rather
// than caching a broken file that every later run would silently reuse.
// META_FILE remembers how many rows each file had when it was downloaded, so a
// file that later shrinks is detected and re-fetched instead of trusted.
const META_FILE = 'socio_csv_meta.json';

function readMeta() {
  try { return JSON.parse(fs.readFileSync(META_FILE, 'utf-8')); } catch (e) { return {}; }
}
function writeMeta(meta) {
  try { fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2)); } catch (e) {}
}
function csvRowCount(file) {
  try { return parseCSV(fs.readFileSync(file, 'utf-8')).length; } catch (e) { return 0; }
}

function csvIsValid(file, minRows) {
  try {
    if (!fs.existsSync(file)) return false;
    if (fs.statSync(file).size < 500) return false;
    const rows = parseCSV(fs.readFileSync(file, 'utf-8'));
    if (rows.length < (minRows || 50)) return false;
    const header = (rows[0] || []).map(h => h.trim().toLowerCase());
    if (!(header.includes('filename') || header.includes('file_name'))) return false;
    const known = readMeta()[file];
    if (known && rows.length < known * 0.98) return false;   // file shrank -> truncated
    return true;
  } catch (e) { return false; }
}

async function downloadCSV(gid, file, minRows) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${gid}`;
  console.log(`  Fetching: ${url}`);
  const text = await fetchText(url);
  const rows = parseCSV(text);
  const header = (rows[0] || []).map(h => h.trim().toLowerCase());
  const looksOk = rows.length >= (minRows || 50) &&
                  (header.includes('filename') || header.includes('file_name'));
  if (!looksOk) {
    try { fs.unlinkSync(file); } catch (e) {}
    throw new Error(`Download for gid=${gid} looks incomplete or wrong (${rows.length} rows, ${text.length} bytes). ` +
                    `Check that the sheet is still shared publicly, then run again with --refresh.`);
  }
  fs.writeFileSync(file, text);
  const meta = readMeta(); meta[file] = rows.length; writeMeta(meta);
  console.log(`  Saved: ${file} (${rows.length - 1} data rows)`);
}

async function fetchData(refresh) {
  const files = [
    [QUESTION_GIDS[0], CSV_QUESTIONS, 1000],
    [QUESTION_GIDS[1], CSV_QUESTIONS2, 1000],
    [DRIVE_GID, CSV_DRIVE, 50],
  ];
  for (let i = 0; i < files.length; i++) {
    const [gid, fname, minRows] = files[i];
    const valid = csvIsValid(fname, minRows);
    if (refresh || !valid) {
      if (fs.existsSync(fname) && !valid) console.log(`\n[${i+1}/3] ${fname} looks incomplete or stale — re-downloading`);
      else if (refresh) console.log(`\n[${i+1}/3] Refreshing ${fname}`);
      else console.log(`\n[${i+1}/3] Downloading...`);
      await downloadCSV(gid, fname, minRows);
    } else {
      console.log(`\n[${i+1}/3] Using existing ${fname} (${csvRowCount(fname) - 1} data rows)`);
    }
  }
}

// ─── Drive availability checker ─────────────────────────────────────────────
// A Drive file is "openable" when GET /file/d/<id>/view returns 200 and the
// page carries an og:title (i.e. Drive served the real file, not a stub).
// 404 means the file is gone / never existed. 429 or a redirect to
// google.com/sorry means we are being rate limited -> "unknown", retry later.
const CHECK_CONCURRENCY = 16;     // files probed in parallel
const CHECK_DELAY_MS = 25;        // tiny stagger so we don't burst
const MAX_RETRIES = 3;
const CONFIRM_BYTES = 60000;      // stop reading a page once og:title is found

const sleep = ms => new Promise(r => setTimeout(r, ms));

function proxyConfig() {
  const p = process.env.HTTPS_PROXY || process.env.https_proxy ||
            process.env.HTTP_PROXY || process.env.http_proxy;
  if (!p) return null;
  try {
    const u = new URL(p);
    return {
      host: u.hostname,
      port: parseInt(u.port || '8080', 10),
      auth: u.username ? decodeURIComponent(u.username) + ':' + decodeURIComponent(u.password) : null,
    };
  } catch (e) { return null; }
}

// One HTTPS request, optionally tunnelled through HTTPS_PROXY.
//   method  : 'GET' (default) or 'HEAD'
//   maxBody : stop collecting after this many characters
//   stopOn  : stop as soon as the body contains this substring (huge win —
//             og:title sits near the top of the page, so we skip ~90 KB)
function httpRequest(urlStr, o) {
  o = o || {};
  const timeoutMs = o.timeoutMs || 20000;
  const maxBody = o.maxBody === undefined ? Infinity : o.maxBody;
  const method = o.method || 'GET';
  const stopOn = o.stopOn || null;

  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlStr); } catch (e) { return reject(e); }

    const opts = {
      host: u.hostname, port: u.port || 443,
      path: u.pathname + u.search, method,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DriveCheck/1.0)',
        'Accept-Encoding': 'identity',
        Host: u.hostname,
      },
    };

    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    const fail = e => { if (!done) { done = true; reject(e); } };

    const onRes = (res) => {
      const status = res.statusCode, location = res.headers.location;
      if (method === 'HEAD') { res.resume(); return finish({ status, location, body: '' }); }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => {
        body += c;
        if (stopOn && body.indexOf(stopOn) !== -1) { res.destroy(); return finish({ status, location, body }); }
        if (body.length >= maxBody) { res.destroy(); return finish({ status, location, body }); }
      });
      res.on('end', () => finish({ status, location, body }));
      res.on('error', e => { if (!done) fail(e); });
    };

    const proxy = proxyConfig();
    if (!proxy) {
      const req = https.request(opts, onRes);
      req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
      req.on('error', fail);
      req.end();
      return;
    }

    const sock = net.connect(proxy.port, proxy.host);
    const bail = e => { try { sock.destroy(); } catch (_) {} fail(e); };
    sock.setTimeout(timeoutMs, () => bail(new Error('proxy timeout')));
    sock.on('error', bail);
    sock.on('connect', () => {
      let head = `CONNECT ${u.hostname}:443 HTTP/1.1\r\nHost: ${u.hostname}:443\r\n`;
      if (proxy.auth) head += `Proxy-Authorization: Basic ${Buffer.from(proxy.auth).toString('base64')}\r\n`;
      sock.write(head + '\r\n');
    });
    let buf = '';
    const onHandshake = (chunk) => {
      buf += chunk.toString('latin1');
      const idx = buf.indexOf('\r\n\r\n');
      if (idx === -1) return;
      sock.removeListener('data', onHandshake);
      const statusLine = buf.split('\r\n')[0] || '';
      if (!/^HTTP\/\d(\.\d)? 200/.test(statusLine)) return bail(new Error('proxy refused: ' + statusLine));
      const t = tls.connect({ socket: sock, servername: u.hostname }, () => {
        const req = https.request(Object.assign({}, opts, { createConnection: () => t }), onRes);
        req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
        req.on('error', fail);
        req.end();
      });
      t.on('error', fail);
    };
    sock.on('data', onHandshake);
  });
}

// Compatibility wrappers used elsewhere in the file.
function httpGet(urlStr, timeoutMs, maxBody) {
  return httpRequest(urlStr, { timeoutMs: timeoutMs || 20000, maxBody: maxBody });
}
function httpHead(urlStr, timeoutMs) {
  return httpRequest(urlStr, { method: 'HEAD', timeoutMs: timeoutMs || 15000 });
}

// Cheap existence probe: HEAD transfers no body at all.
async function headStatus(id) {
  let url = `https://drive.google.com/file/d/${id}/view`;
  for (let hop = 0; hop < 3; hop++) {
    const r = await httpHead(url, 15000);
    if (r.status >= 300 && r.status < 400) {
      const loc = r.location || '';
      if (/\/sorry\//.test(loc) || /google\.[a-z.]+\/sorry/.test(loc)) return 'ratelimited';
      if (!loc) return 'unknown';
      url = loc.startsWith('http') ? loc : new URL(loc, url).toString();
      continue;
    }
    return r;
  }
  return 'unknown';
}

// Confirm an existing file really serves a file page (og:title present),
// aborting the download as soon as that marker is seen.
async function confirmOpenable(id) {
  let url = `https://drive.google.com/file/d/${id}/view`;
  for (let hop = 0; hop < 3; hop++) {
    const r = await httpRequest(url, { timeoutMs: 15000, maxBody: CONFIRM_BYTES, stopOn: 'og:title' });
    if (r.status >= 300 && r.status < 400 && r.location) {
      if (/\/sorry\//.test(r.location)) return 'ratelimited';
      url = r.location.startsWith('http') ? r.location : new URL(r.location, url).toString();
      continue;
    }
    if (r.status === 200) return /og:title/i.test(r.body || '') ? 'ok' : 'unknown';
    if (r.status === 404 || r.status === 410) return 'dead';
    return 'unknown';
  }
  return 'unknown';
}

async function classify(id) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const h = await headStatus(id);
      if (h === 'ratelimited') { await sleep(1200 * attempt); continue; }
      if (h === 'unknown') { await sleep(400 * attempt); continue; }
      if (h.status === 404 || h.status === 410) return 'dead';   // gone: no body needed
      if (h.status === 429 || h.status === 403) { await sleep(1200 * attempt); continue; }
      if (h.status !== 200) return 'unknown';

      const verdict = await confirmOpenable(id);
      if (verdict === 'ratelimited') { await sleep(1200 * attempt); continue; }
      return verdict;
    } catch (e) {
      await sleep(500 * attempt);
    }
  }
  return 'unknown';
}

function readDriveMap() {
  const driveRows = parseCSV(fs.readFileSync(CSV_DRIVE, 'utf-8'));
  const driveMap = {};
  for (let i = 1; i < driveRows.length; i++) {
    if (driveRows[i].length >= 2 && driveRows[i][0].trim())
      driveMap[driveRows[i][0].trim()] = driveRows[i][1].trim();
  }
  return driveMap;
}

async function checkDrive(force) {
  const driveMap = readDriveMap();
  const ids = [...new Set(Object.values(driveMap).filter(Boolean))];

  let status = {};
  if (!force && fs.existsSync(STATUS_FILE)) {
    try { status = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8')); } catch (e) { status = {}; }
  }
  const todo = ids.filter(id => !status[id] || status[id] === 'unknown');
  console.log(`\n  Drive check: ${ids.length} unique PDFs, ${ids.length - todo.length} already known, ${todo.length} to check`);

  if (!todo.length) {
    saveStatus(status);
    return status;
  }

  let done = 0, ok = 0, dead = 0, unknown = 0;
  let cursor = 0;
  const worker = async () => {
    while (cursor < todo.length) {
      const id = todo[cursor++];
      const res = await classify(id);
      status[id] = res;
      done++;
      if (res === 'ok') ok++; else if (res === 'dead') dead++; else unknown++;
      if (done % 10 === 0 || done === todo.length) {
        process.stdout.write(`\r  checked ${done}/${todo.length}  (ok ${ok}, dead ${dead}, unknown ${unknown})   `);
        saveStatus(status);
      }
      await sleep(CHECK_DELAY_MS);
    }
  };
  const workers = [];
  for (let i = 0; i < Math.min(CHECK_CONCURRENCY, todo.length); i++) workers.push(worker());
  await Promise.all(workers);
  process.stdout.write('\n');

  // Second, gentler pass for anything the rate limiter left unverified.
  const stragglers = todo.filter(id => status[id] === 'unknown');
  if (stragglers.length) {
    console.log(`  Re-checking ${stragglers.length} unverified PDFs more slowly…`);
    for (const id of stragglers) {
      const r = await classify(id);
      if (r !== 'unknown') status[id] = r;
      await sleep(400);
    }
    saveStatus(status);
  }
  return status;
}

function saveStatus(status) {
  try { fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 0)); } catch (e) {}
}

// ─── Topper parsing ─────────────────────────────────────────────────────────
function parseTopper(filename) {
  let name = filename.replace('.pdf', '').trim();
  let air = '';
  let m = name.match(/AIR[\s_-]*(\d+)/i) || name.match(/rank[\s_-]*(\d+)/i);
  if (m) air = m[1];
  let clean = name.replace(/AIR[\s_-]*\d+/gi, '').replace(/rank[\s_-]*\d+/gi, '').replace(/\b(20\d{2})\b/g, '');
  const noise = ['LevelupIAS','Levelup','VisionIAS','VISION','EdenIAS','Sociology','socio','Socio','crash course','Crash course','Crash Course','Programme','Program','Foundation','Test series','Test-Series','Test','Full Lenght Test','copy','marks','Answer','Answers','Answer copy','Booklet','Toppers Answer','reliableANDvalid','DAMP','pdf'];
  for (const w of noise) clean = clean.replace(new RegExp(w, 'gi'), '');
  clean = clean.replace(/^[\s\-_]+|[\s\-_]+$/g, '').replace(/[\s\-_]+/g, ' ').trim();
  if (!clean) clean = name;
  let coaching = '';
  const l = filename.toLowerCase();
  if (l.includes('levelupias') || l.includes('levelup')) coaching = 'LevelupIAS';
  else if (l.includes('visionias') || l.includes('vision')) coaching = 'VisionIAS';
  else if (l.includes('edenias') || l.includes('eden')) coaching = 'EdenIAS';
  else if (l.includes('damp')) coaching = 'DAMP';
  return { air, topper: clean, coaching };
}

function extractDigits(s) { const m = s.match(/(\d+)/); return m ? m[1] : s; }

function escHtml(s) { return s ? s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : ''; }
function escAttr(s) { return s ? s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : ''; }

// ─── Build viewer ───────────────────────────────────────────────────────────
function buildViewer(strict) {
  const driveMap = readDriveMap();

  let status = null;
  if (fs.existsSync(STATUS_FILE)) {
    try { status = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8')); } catch (e) { status = null; }
  }
  if (!status) console.log('\n  WARNING: no ' + STATUS_FILE + ' — every row is kept. Run with --check to verify Drive files.');

  const rows = [];
  let nDead = 0, nNoId = 0, droppedStrict = 0;

  for (const csvFile of [CSV_QUESTIONS, CSV_QUESTIONS2]) {
    if (!fs.existsSync(csvFile)) continue;
    const csvRows = parseCSV(fs.readFileSync(csvFile, 'utf-8'));
    if (csvRows.length < 2) continue;
    const header = csvRows[0].map(h => h.trim().toLowerCase());
    const col = name => header.indexOf(name);
    for (let i = 1; i < csvRows.length; i++) {
      const r = csvRows[i];
      const get = name => { const idx = col(name); return idx >= 0 && idx < r.length ? r[idx].trim() : ''; };
      const filename = get('filename'); if (!filename) continue;

      // ── Tag each row: does its Drive PDF actually open? ──
      // Dead rows are still kept in the data so the viewer can reveal them
      // when the "Only openable PDFs" checkbox is unchecked.
      const driveId = driveMap[filename] || '';
      const st = driveId ? (status ? (status[driveId] || 'unknown') : 'ok') : 'dead';
      const isOk = st === 'ok' || st === 'unknown';
      if (!isOk) { if (driveId) nDead++; else nNoId++; }
      if (strict && !isOk) { droppedStrict++; continue; }

      let question = get('question'), intro = get('introduction'), page = extractDigits(get('page'));
      let thinkers = get('thinkers'), diagram = get('diagram'), syllabus = get('syllabus');
      const { air, topper, coaching } = parseTopper(filename);
      // Plain Drive link; the page number is shown on the button label.
      const driveLink = driveId ? `https://drive.google.com/file/d/${driveId}/view` : '';
      let paper = '';
      if (/paper\s*[–-]\s*i\b/i.test(syllabus) || /paper\s+i\b/i.test(syllabus)) paper = 'Paper I';
      else if (/paper\s*[–-]\s*ii\b/i.test(syllabus) || /paper\s+ii\b/i.test(syllabus)) paper = 'Paper II';
      if (question === 'NA') question = '';
      if (intro === 'Not mentioned') intro = '';
      if (thinkers === 'Not mentioned') thinkers = '';
      if (diagram === 'No diagram' || diagram === 'Not mentioned') diagram = '';
      if (syllabus === 'NA') syllabus = '';
      rows.push({ air, topper, coaching, question, intro, page, thinkers, diagram, syllabus, paper, drive_link: driveLink, ok: isOk });
    }
  }

  const total = rows.length, withQ = rows.filter(r => r.question).length;
  const openableRows = rows.filter(r => r.ok).length;
  const deadRows = total - openableRows;
  const uniquePDFs = new Set(rows.filter(r => r.ok).map(r => r.drive_link)).size;
  const papers = {};
  rows.forEach(r => { const p = r.paper || 'Unspecified'; papers[p] = (papers[p]||0)+1; });

  console.log(`\n  Parsed ${total} rows (${withQ} with question text)`);
  if (total < 5000) {
    console.log('\n  ' + '!'.repeat(58));
    console.log(`  WARNING: only ${total} rows parsed. The sheet normally yields ~22,000.`);
    console.log('  Your CSV files are probably truncated or stale.');
    console.log('  Fix:  node build_socio_viewer.js --refresh');
    console.log('  ' + '!'.repeat(58));
  }
  console.log(`  Openable PDFs: ${openableRows} rows / ${uniquePDFs} files`);
  console.log(`  Unopenable (hidden by default, reveal with the checkbox): ${deadRows} rows` +
              (droppedStrict ? ` — ${droppedStrict} dropped entirely by --strict` : ''));
  console.log(`  Paper distribution: ${JSON.stringify(papers)}`);

  const topperSet = [...new Set(rows.map(r => r.topper))].sort();
  let topperOptions = '';
  for (const t of topperSet) { const d = t.length > 40 ? t.slice(0,40)+'...' : t; topperOptions += `<option value="${escAttr(t)}">${escHtml(d)}</option>\n`; }

  const jsData = JSON.stringify(rows);
  const html = buildHTML({ title: 'Sociology Optional - Topper Answer Copies', total, withQ,
    p1: papers['Paper I']||0, p2: papers['Paper II']||0, p3: papers['Unspecified']||0,
    uniquePDFs, openableRows, deadRows, topperOptions, jsData });
  fs.writeFileSync(VIEWER_FILE, html);
  console.log(`\n  ${VIEWER_FILE} ready!`);
}

// Karl Marx portrait (public domain, Wikimedia Commons) inlined as a data URI
// so the page stays self-contained and works offline.
const MARX_ICON = 'data:image/png;base64,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';
const MARX_TOUCH = 'data:image/png;base64,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';

function buildHTML(o) {
  const { title, total, withQ, p1, p2, p3, uniquePDFs, openableRows, deadRows, topperOptions, jsData } = o;
  return `<!DOCTYPE html>
<html lang="en" data-theme="light"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<link rel="icon" type="image/png" sizes="64x64" href="${MARX_ICON}">
<link rel="apple-touch-icon" href="${MARX_TOUCH}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{
  --bg:#f7f8fa; --panel:#fff; --border:#e6e8ec; --border-strong:#d6dae1;
  --text:#111827; --muted:#6b7280; --faint:#9ca3af;
  --accent:#2563eb; --accent-dark:#1d4ed8; --accent-soft:#eff4ff;
  --danger:#b42318; --danger-soft:#fef3f2; --danger-border:#fecdca;
  --divider:#f1f2f4; --thead:#fcfcfd; --row-hover:#fafbfc;
  --chip-bg:#f3f4f6; --chip-text:#4b5563; --chip-border:#eceef1;
  --quote:#e5e7eb; --dash:#d1d5db;
  --amber-bg:#fffaeb; --amber-text:#b54708; --amber-border:#fedf89;
  --mark-bg:#fde68a; --mark-text:#713f12;
  --r:10px; --shadow:0 1px 2px rgba(16,24,40,.05);
  --sel-arrow:%236b7280;
}
html[data-theme="dark"]{
  --bg:#0b0f14; --panel:#121821; --border:#232b36; --border-strong:#313b49;
  --text:#e6eaf0; --muted:#9aa6b4; --faint:#6b7787;
  --accent:#5b93ff; --accent-dark:#7aa8ff; --accent-soft:#16233a;
  --danger:#ff9d92; --danger-soft:#2a1715; --danger-border:#4d2622;
  --divider:#1e2631; --thead:#0f151d; --row-hover:#161d27;
  --chip-bg:#1a222d; --chip-text:#b6c1cf; --chip-border:#26303c;
  --quote:#2a3543; --dash:#3a4553;
  --amber-bg:#2a2113; --amber-text:#f2c17b; --amber-border:#4a3a1d;
  --mark-bg:#4d3c07; --mark-text:#fbbf24;
  --shadow:0 1px 2px rgba(0,0,0,.4);
  --sel-arrow:%239aa6b4;
}
*{margin:0;padding:0;box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{font-family:'Inter',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--text);font-size:14px;line-height:1.55;-webkit-font-smoothing:antialiased;transition:background .18s ease,color .18s ease}
.wrap{max-width:1280px;margin:0 auto;padding:36px 24px 72px}

/* header */
.head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:20px}
.head h1{font-size:22px;font-weight:700;letter-spacing:-.015em;line-height:1.25}
.head h1 span{color:var(--accent)}
.lede{color:var(--muted);font-size:13.5px;margin-top:6px;max-width:70ch}
.title-row{display:flex;align-items:center;gap:11px}
.avatar{flex:none;width:38px;height:38px;border-radius:50%;object-fit:cover;border:1px solid var(--border-strong);box-shadow:var(--shadow);background:var(--panel)}
.theme-btn{flex:none;width:38px;height:38px;border-radius:9px;border:1px solid var(--border-strong);background:var(--panel);color:var(--muted);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;transition:color .15s,border-color .15s,background .15s}
.theme-btn:hover{color:var(--accent);border-color:var(--accent);background:var(--accent-soft)}
.theme-btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.theme-btn svg{width:17px;height:17px;display:none}
html[data-theme="light"] .ico-moon{display:block}
html[data-theme="dark"] .ico-sun{display:block}

/* stat pills */
.stats{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:20px}
.stat{background:var(--panel);border:1px solid var(--border);border-radius:999px;padding:5px 13px;font-size:12.5px;color:var(--muted);box-shadow:var(--shadow)}
.stat b{color:var(--text);font-weight:600}
.stat.warn{background:var(--danger-soft);border-color:var(--danger-border);color:var(--danger)}
.stat.warn b{color:var(--danger)}

/* controls */
.panel{background:var(--panel);border:1px solid var(--border);border-radius:var(--r);box-shadow:var(--shadow)}
.controls{padding:14px 16px;margin-bottom:14px}
.ctrl-row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.ctrl-row + .ctrl-row{margin-top:12px;padding-top:12px;border-top:1px solid var(--divider)}
.search{flex:1 1 280px;min-width:220px;padding:9px 12px;border:1px solid var(--border-strong);border-radius:8px;font:inherit;font-size:13.5px;color:var(--text);background:var(--panel);outline:none;transition:border-color .15s,box-shadow .15s}
.search::placeholder{color:var(--faint)}
.search:focus{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 16%,transparent)}
select{appearance:none;padding:9px 32px 9px 12px;border:1px solid var(--border-strong);border-radius:8px;font:inherit;font-size:13px;color:var(--text);background-color:var(--panel);background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>");background-repeat:no-repeat;background-position:right 11px center;cursor:pointer;outline:none;max-width:230px;transition:border-color .15s,box-shadow .15s}
html[data-theme="dark"] select{background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239aa6b4' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>")}
select:focus{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 16%,transparent)}
.chk{display:inline-flex;align-items:center;gap:7px;font-size:13px;color:var(--muted);cursor:pointer;user-select:none;padding:4px 2px}
.chk input{width:15px;height:15px;accent-color:var(--accent);cursor:pointer;margin:0}
.chk.primary{color:var(--text);font-weight:500}
.btn-clear{margin-left:auto;padding:8px 14px;border:1px solid var(--border-strong);background:var(--panel);border-radius:8px;font:inherit;font-size:13px;font-weight:500;color:var(--muted);cursor:pointer;transition:all .15s}
.btn-clear:hover{border-color:var(--accent);color:var(--accent);background:var(--accent-soft)}

/* count */
.count{color:var(--muted);font-size:12.5px;margin:0 2px 12px}

/* table */
.table-panel{overflow:hidden}
.table-scroll{overflow-x:auto}
table{width:100%;border-collapse:separate;border-spacing:0;min-width:860px}
thead th{position:sticky;top:0;z-index:2;background:var(--thead);text-align:left;padding:11px 16px;font-size:11.5px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--faint);border-bottom:1px solid var(--border);white-space:nowrap}
thead th.sortable{cursor:pointer;user-select:none;transition:color .15s}
thead th.sortable:hover{color:var(--accent)}
th .arrow{opacity:.45;font-size:10px;margin-left:3px}
th.c-topper{width:19%} th.c-question{width:38%} th.c-thinkers{width:17%} th.c-syllabus{width:15%} th.c-open{width:11%}
tbody td{padding:14px 16px;border-bottom:1px solid var(--divider);vertical-align:top;font-size:13px;color:var(--text)}
tbody tr:last-child td{border-bottom:none}
tbody tr{transition:background .12s}
tbody tr:hover{background:var(--row-hover)}
tbody tr.dead-row{background:color-mix(in srgb,var(--danger-soft) 55%,var(--panel))}
tbody tr.dead-row:hover{background:var(--danger-soft)}

/* cell content */
.topper-cell{display:flex;flex-direction:column;gap:3px}
.topper-name{font-weight:600;color:var(--text);font-size:13.5px;line-height:1.35}
.air-badge{display:inline-block;align-self:flex-start;background:var(--accent-soft);color:var(--accent-dark);padding:1px 7px;border-radius:5px;font-size:11px;font-weight:600;letter-spacing:.01em}
.coaching{font-size:11.5px;color:var(--faint)}
.question-text{color:var(--text);font-size:13px;line-height:1.5;opacity:.92}
.intro-text{color:var(--muted);font-size:12.5px;margin-top:5px;padding-left:9px;border-left:2px solid var(--quote)}
.thinker-tag{display:inline-block;background:var(--chip-bg);color:var(--chip-text);padding:2px 8px;border-radius:6px;font-size:11.5px;margin:0 4px 4px 0;border:1px solid var(--chip-border)}
.diagram-tag{display:inline-block;background:var(--amber-bg);color:var(--amber-text);padding:2px 8px;border-radius:6px;font-size:11.5px;margin-top:4px;border:1px solid var(--amber-border)}
.syllabus-text{color:var(--muted);font-size:12.5px;line-height:1.45}
.muted-dash{color:var(--dash)}
mark{background:var(--mark-bg);color:var(--mark-text);padding:0 2px;border-radius:3px;font-weight:600}
.pdf-btn{display:inline-block;background:var(--accent);color:#fff!important;padding:7px 13px;border-radius:8px;font-size:12.5px;font-weight:600;text-decoration:none;white-space:nowrap;transition:background .15s,box-shadow .15s}
.pdf-btn:hover{background:var(--accent-dark);box-shadow:0 1px 3px rgba(37,99,235,.35)}
.dead-tag{display:inline-block;background:var(--danger-soft);color:var(--danger);border:1px solid var(--danger-border);padding:6px 11px;border-radius:8px;font-size:11.5px;font-weight:600;white-space:nowrap}
.loading{text-align:center;padding:48px 16px;color:var(--faint);font-size:13px}


@media(max-width:720px){
  .wrap{padding:22px 14px 56px}
  .head h1{font-size:19px}
  .btn-clear{margin-left:0}
  select{max-width:none;flex:1 1 140px}
}
</style>
<script>
(function(){try{var t=localStorage.getItem('socio-theme');if(t!=='dark'&&t!=='light'){t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.setAttribute('data-theme',t);}catch(e){}})();
</script>
</head><body>
<div class="wrap">
  <div class="head">
    <div>
      <div class="title-row">
        <img class="avatar" src="${MARX_ICON}" alt="Karl Marx" width="38" height="38">
        <h1>Sociology Optional <span>Topper Answer Copies</span></h1>
      </div>
      <p class="lede">Search inside the question and introduction text of each answer — then open the exact page of the original copy. Filter by topper or paper from the menus.</p>
    </div>
    <button id="themeToggle" class="theme-btn" type="button" aria-label="Toggle dark mode" title="Toggle dark mode">
      <svg class="ico-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
      <svg class="ico-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
    </button>
  </div>

  <div class="stats">
    <span class="stat"><b>${total}</b> rows</span>
    <span class="stat"><b>${openableRows}</b> openable</span>
    <span class="stat warn"><b>${deadRows}</b> unavailable</span>
    <span class="stat"><b>${uniquePDFs}</b> PDFs</span>
    <span class="stat">Paper I <b>${p1}</b></span>
    <span class="stat">Paper II <b>${p2}</b></span>
    <span class="stat">Unspecified <b>${p3}</b></span>
  </div>

  <section class="panel controls">
    <div class="ctrl-row">
      <input type="text" id="search" class="search" placeholder="Search questions and introductions…" autofocus>
      <select id="paperFilter" onchange="applyFilters()"><option value="">All papers</option><option value="Paper I">Paper I</option><option value="Paper II">Paper II</option><option value="Unspecified">Unspecified</option></select>
      <select id="topperFilter" onchange="applyFilters()"><option value="">All toppers</option>${topperOptions}</select>
    </div>
    <div class="ctrl-row">
      <label class="chk primary"><input type="checkbox" id="onlyOpenable" checked onchange="applyFilters()"> Only openable PDFs</label>
      <label class="chk"><input type="checkbox" id="onlyQuestions" onchange="applyFilters()"> Questions only</label>
      <label class="chk"><input type="checkbox" id="onlyDiagrams" onchange="applyFilters()"> With diagrams</label>
      <button class="btn-clear" onclick="clearFilters()">Clear filters</button>
    </div>
  </section>

  <div class="count" id="count"></div>

  <div class="panel table-panel">
    <div class="table-scroll">
      <table><thead><tr>
        <th class="sortable c-topper" onclick="sortBy('topper')">Topper <span class="arrow">&#x21C5;</span></th>
        <th class="c-question">Question &amp; Introduction</th>
        <th class="c-thinkers">Thinkers</th>
        <th class="c-syllabus">Syllabus Topic</th>
        <th class="c-open">Open Answer Copy</th>
      </tr></thead><tbody id="tbody"><tr><td colspan="5" class="loading">Loading ${total} rows…</td></tr></tbody></table>
    </div>
  </div>
</div>

<script>
const DATA=${jsData};
for(var i=0;i<DATA.length;i++){var r=DATA[i];r._s=((r.question||'')+' '+(r.intro||'')).toLowerCase();r._q=Boolean(r.question);r._d=Boolean(r.diagram);}
var PAGE=80,shown=0,cur=[],sKey='',sAsc=true,debounceT=null,terms=[];
function esc(s){return s?s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'):'';}
function hl(s){
  if(!s)return '';
  if(!terms.length)return esc(s);
  var low=s.toLowerCase(),out='',i=0;
  while(i<s.length){
    var best=-1,bl=0;
    for(var k=0;k<terms.length;k++){
      var p=low.indexOf(terms[k],i);
      if(p!==-1&&(best===-1||p<best||(p===best&&terms[k].length>bl))){best=p;bl=terms[k].length;}
    }
    if(best===-1){out+=esc(s.slice(i));break;}
    out+=esc(s.slice(i,best))+'<mark>'+esc(s.slice(best,best+bl))+'</mark>';
    i=best+bl;
  }
  return out;
}
function row(r){
var a=r.air?'<span class="air-badge">AIR '+esc(r.air)+'</span>':'';
var c=r.coaching?'<span class="coaching">'+esc(r.coaching)+'</span>':'';
var q='';if(r.question)q='<div class="question-text">'+hl(r.question)+'</div>';
if(r.intro){var raw=r.intro.length>200?r.intro.substring(0,200)+'…':r.intro;q+='<div class="intro-text">'+hl(raw)+'</div>';}
if(!q)q='<span class="muted-dash">&mdash;</span>';
var th='';if(r.thinkers&&r.thinkers!=='Not mentioned'){var parts=r.thinkers.split(/[{}]+/);for(var k=0;k<parts.length;k++){var seg=parts[k].split(',');for(var m2=0;m2<seg.length;m2++){var tag=seg[m2].replace(/[{}]/g,'').replace(/^[\\s,;]+|[\\s,;]+$/g,'').trim();if(tag)th+='<span class="thinker-tag">'+esc(tag)+'</span>';}}}
var d='';if(r.diagram){var dt=r.diagram.length>60?r.diagram.substring(0,60)+'…':r.diagram;d+='<div><span class="diagram-tag">'+esc(dt)+'</span></div>';}
if(!th&&!d)th='<span class="muted-dash">&mdash;</span>';
var sy=r.syllabus?'<div class="syllabus-text">'+esc(r.syllabus)+'</div>':'<span class="muted-dash">&mdash;</span>';
var p='';if(!r.ok){p='<span class="dead-tag" title="This Drive file is deleted or not shared">PDF unavailable</span>';}else if(r.drive_link){var lb=r.page&&/^\\d+$/.test(r.page)?'Open Pg '+esc(r.page):'Open PDF';p='<a href="'+r.drive_link+'" target="_blank" rel="noopener" class="pdf-btn">'+lb+'</a>';}else p='<span class="muted-dash">&mdash;</span>';
return '<tr'+(r.ok?'':' class="dead-row"')+'><td><div class="topper-cell">'+a+'<span class="topper-name">'+esc(r.topper)+'</span>'+c+'</div></td><td>'+q+'</td><td>'+th+d+'</td><td>'+sy+'</td><td>'+p+'</td></tr>';}
function nf(n){return n.toLocaleString('en-IN');}
function updateCount(){var el=document.getElementById('count');var vis=cur.length;
if(vis===0){el.textContent='No rows match these filters · '+nf(DATA.length)+' rows in total';return;}
el.textContent=(shown<vis?'Showing '+nf(shown)+' of '+nf(vis):'Showing all '+nf(vis))+' matching rows · '+nf(DATA.length)+' total';}
function nextBatch(){if(shown>=cur.length)return;var end=Math.min(shown+PAGE,cur.length),h=[];for(var i=shown;i<end;i++)h.push(row(cur[i]));document.getElementById('tbody').insertAdjacentHTML('beforeend',h.join(''));shown=end;updateCount();}
function fill(){nextBatch();while(shown<cur.length&&(innerHeight+scrollY)>=document.documentElement.scrollHeight-500)nextBatch();}
function applyFilters(){var q=document.getElementById('search').value.toLowerCase().trim(),ws=q?q.split(/\\s+/).filter(Boolean):[],p=document.getElementById('paperFilter').value,tp=document.getElementById('topperFilter').value,oO=document.getElementById('onlyOpenable').checked,oQ=document.getElementById('onlyQuestions').checked,oD=document.getElementById('onlyDiagrams').checked,res=[];
for(var i=0;i<DATA.length;i++){var r=DATA[i];if(oO&&!r.ok)continue;if(oQ&&!r._q)continue;if(oD&&!r._d)continue;if(p&&r.paper!==p)continue;if(tp&&r.topper!==tp)continue;
if(ws.length){var m=true;for(var j=0;j<ws.length;j++)if(r._s.indexOf(ws[j])===-1){m=false;break;}if(!m)continue;}res.push(r);}
terms=ws;cur=res;shown=0;var tb=document.getElementById('tbody');
if(cur.length===0){tb.innerHTML='<tr><td colspan="5" class="loading">No matching records found.</td></tr>';updateCount();return;}
tb.innerHTML='';fill();}
function clearFilters(){document.getElementById('search').value='';document.getElementById('paperFilter').value='';document.getElementById('topperFilter').value='';document.getElementById('onlyOpenable').checked=true;document.getElementById('onlyQuestions').checked=false;document.getElementById('onlyDiagrams').checked=false;terms=[];applyFilters();}
function sortBy(k){if(sKey===k)sAsc=!sAsc;else{sKey=k;sAsc=true;}DATA.sort(function(a,b){var va=a[k]||'',vb=b[k]||'';if(k==='page'){va=parseInt(va)||0;vb=parseInt(vb)||0;}if(va<vb)return sAsc?-1:1;if(va>vb)return sAsc?1:-1;return 0;});applyFilters();}
document.getElementById('themeToggle').addEventListener('click',function(){
var cur=document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark';
document.documentElement.setAttribute('data-theme',cur);
try{localStorage.setItem('socio-theme',cur);}catch(e){}
});
addEventListener('scroll',function(){if((innerHeight+scrollY)>=document.documentElement.scrollHeight-700)nextBatch();});
document.getElementById('search').addEventListener('input',function(){if(debounceT)clearTimeout(debounceT);debounceT=setTimeout(applyFilters,120);});
applyFilters();
</script></body></html>`;
}

function startServer(port) {
  http.createServer((req, res) => {
    const path = (req.url || '/').split('?')[0].split('#')[0];
    if (path === '/' || path === '/viewer.html') {
      if (!fs.existsSync(VIEWER_FILE)) { res.writeHead(404); res.end('Run without --serve first.'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(VIEWER_FILE, 'utf-8'));
    } else { res.writeHead(404); res.end('Open http://localhost:' + port); }
  }).listen(port, () => { console.log(`\n  Server: http://localhost:${port}\n  Ctrl+C to stop.`); });
}

async function main() {
  const args = process.argv.slice(2);
  const buildOnly = args.includes('--build'), serveOnly = args.includes('--serve');
  const forceCheck = args.includes('--check'), checkOnly = args.includes('--check-only');
  const refresh = args.includes('--refresh');
  const skipCheck = args.includes('--no-check');
  const strict = args.includes('--strict');
  const portIdx = args.indexOf('--port'), port = portIdx >= 0 && args[portIdx+1] ? parseInt(args[portIdx+1]) : 3000;

  console.log('='.repeat(60));
  console.log('  Sociology Optional - Topper Answer Copies Viewer');
  console.log('  (Node.js — zero deps, infinite scroll, instant filters)');
  console.log('='.repeat(60));

  if (!serveOnly) {
    await fetchData(refresh);
    // Drive availability is checked in Node at build time, never in the browser.
    // The verdicts are cached in STATUS_FILE, so only the first build (or one
    // after STATUS_MAX_AGE_DAYS) pays the cost of probing Google.
    const statusAge = fs.existsSync(STATUS_FILE)
      ? (Date.now() - fs.statSync(STATUS_FILE).mtimeMs) / 86400000 : Infinity;
    const statusStale = statusAge > STATUS_MAX_AGE_DAYS;
    let checked = false;

    if (skipCheck) {
      console.log(`\n  Skipping Drive check (--no-check).`);
    } else if (forceCheck || checkOnly || !fs.existsSync(STATUS_FILE) || statusStale) {
      if (!fs.existsSync(STATUS_FILE)) console.log('\n  No cached Drive status yet — checking every PDF (one time, cached afterwards).');
      else if (statusStale && !forceCheck && !checkOnly) console.log(`\n  Cached Drive status is ${statusAge.toFixed(0)} days old — re-checking.`);
      try {
        await checkDrive(true);
        checked = true;
        const st2 = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8'));
        const unk = Object.values(st2).filter(v => v === 'unknown').length;
        if (unk) console.log(`  Note: ${unk} PDFs could not be verified (Google rate limit or no network). ` +
                             `They are shown as openable. Re-run --check later to settle them.`);
      } catch (e) {
        console.log(`\n  WARNING: Drive check failed (${e.message}). Building with the status we have.`);
      }
    } else {
      const st = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8'));
      const okN = Object.values(st).filter(v => v === 'ok').length;
      const deadN = Object.values(st).filter(v => v === 'dead').length;
      console.log(`\n  Cached Drive status: ${STATUS_FILE} (${okN} openable, ${deadN} unavailable, ${statusAge.toFixed(1)} days old)`);
      console.log('  No Drive calls made. Use --check to re-verify now.');
    }
    void checked;
    if (checkOnly) { console.log('\n  Status file written. Done.'); return; }
    console.log('\n  Building...');
    buildViewer(strict);
  }
  if (!buildOnly) startServer(port);
  else { console.log('\n' + '='.repeat(60)); console.log(`  DONE! Open '${VIEWER_FILE}' in your browser.`); console.log('='.repeat(60)); }
}
module.exports = { httpGet, httpHead, classify, confirmOpenable, headStatus, fetchText };

if (require.main === module) {
  main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
}
