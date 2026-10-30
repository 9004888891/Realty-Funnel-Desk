// Realty Funnel Desk — prototype server (Node 18+, no dependencies)
// Serves the dashboard, keeps one shared data file, and stores uploaded originals.
//   node server.js            → http://localhost:8080
//   PORT=3000 node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const os = require('os');

const PORT = +process.env.PORT || 8080;
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const FILES_DIR = path.join(DATA_DIR, 'files');
const STATE = path.join(DATA_DIR, 'state.json');
const BACKUPS = path.join(DATA_DIR, 'backups');
const SHARES = path.join(DATA_DIR, 'shares'); // read-only client report snapshots
const MAX_UPLOAD = (+process.env.MAX_UPLOAD_MB || 500) * 1024 * 1024; // decks and videos can be large

for (const d of [DATA_DIR, FILES_DIR, BACKUPS, SHARES]) fs.mkdirSync(d, { recursive: true });

let state = { version: 0, data: null };
if (fs.existsSync(STATE)) state = JSON.parse(fs.readFileSync(STATE, 'utf8'));
// Sign-in: set AUTH=off only for a private demo on your own computer
const AUTH_ON = process.env.AUTH !== 'off';
const Auth = require('./auth')(DATA_DIR);
const Perf = require('./perf');
if (AUTH_ON && state.data) Auth.syncAccounts(state.data, console.log);

function persist() {
  const tmp = STATE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, STATE); // atomic replace
  // keep one backup per hour
  const stamp = new Date().toISOString().slice(0, 13).replace(/[:T]/g, '-');
  const b = path.join(BACKUPS, `state-${stamp}.json`);
  if (!fs.existsSync(b)) fs.copyFileSync(STATE, b);
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xls': 'application/vnd.ms-excel', '.csv': 'text/csv',
  '.pdf': 'application/pdf', '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.zip': 'application/zip' };
const INLINE = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp4', '.mov', '.webm']);

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;

    // ---------- sign-in ----------
    const uid = AUTH_ON ? Auth.userOf(req) : '*';
    if (p === '/api/login' && req.method === 'POST') {
      const b = JSON.parse((await readBody(req, 10 * 1024)).toString('utf8') || '{}');
      const r = Auth.login(req, b.username, b.password);
      if (r.error) return send(res, r.code, { error: r.error });
      res.setHeader('Set-Cookie', r.cookie); return send(res, 200, Auth.me(r.uid));
    }
    if (p === '/api/logout' && req.method === 'POST') { res.setHeader('Set-Cookie', Auth.logout(req)); return send(res, 200, { ok: true }); }
    if (p === '/api/me') {
      if (!AUTH_ON) return send(res, 200, { auth: false });
      if (!state.data) return send(res, 200, { setup: true, key: !!process.env.SETUP_KEY });
      return uid ? send(res, 200, { auth: true, ...Auth.me(uid) }) : send(res, 401, { error: 'Sign in' });
    }
    // Creative performance feed for other dashboards (and the creative-heatmap module).
    // Signed-in users see their own projects; other systems use PERF_API_TOKEN (Authorization: Bearer …), read-only.
    if (p === '/api/creative-performance') {
      const allow = process.env.PERF_ALLOW_ORIGIN, origin = req.headers.origin;
      if (allow && origin && allow.split(',').map(s => s.trim()).includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization'); res.setHeader('Access-Control-Allow-Methods', 'GET');
      }
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
      if (req.method !== 'GET') return send(res, 405, { error: 'Use GET.' });
      if (!state.data) return send(res, 404, { error: 'No data yet.' });
      const tok = process.env.PERF_API_TOKEN, bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const tokenOk = !!(tok && bearer && bearer.length === tok.length && crypto.timingSafeEqual(Buffer.from(bearer), Buffer.from(tok)));
      if (AUTH_ON && !uid && !tokenOk) return send(res, 401, { error: 'Sign in, or send the API token.' });
      const vis = tokenOk || !AUTH_ON ? null : Auth.visible(state.data, uid);
      const r = Perf.creativePerformance(state.data, url.searchParams, vis);
      return send(res, r.code, r.body);
    }
    const firstSetup = AUTH_ON && !state.data && p === '/api/state';
    if (AUTH_ON && !uid && !firstSetup && (p.startsWith('/api/') || p.startsWith('/files/'))) return send(res, 401, { error: 'Sign in' });
    if (p === '/api/password' && req.method === 'POST') {
      const b = JSON.parse((await readBody(req, 10 * 1024)).toString('utf8') || '{}');
      const r = Auth.changePassword(req, uid, b.current, b.next); return send(res, r.error ? 400 : 200, r);
    }
    if (p === '/api/accounts' && req.method === 'GET') return send(res, 200, { accounts: Auth.accounts(state.data || { users: [] }, uid) });
    if (p === '/api/reset' && req.method === 'POST') {
      const b = JSON.parse((await readBody(req, 10 * 1024)).toString('utf8') || '{}');
      const r = Auth.reset(state.data || { users: [] }, uid, b.userId); return send(res, r.error ? r.code : 200, r);
    }

    // Shared data: GET returns it, PUT replaces it if the client saw the latest version
    if (p === '/api/state') {
      if (req.method === 'GET') {
        const since = url.searchParams.get('since');
        if (since !== null && +since === state.version) { res.writeHead(204); return res.end(); }
        return send(res, 200, AUTH_ON && state.data ? { version: state.version, data: Auth.filterState(state.data, uid) } : state);
      }
      if (req.method === 'PUT') {
        const raw = await readBody(req, 50 * 1024 * 1024);   // always read the body, so the connection stays usable
        if (firstSetup && process.env.SETUP_KEY && req.headers['x-setup-key'] !== process.env.SETUP_KEY) return send(res, 403, { error: 'The setup key is wrong.' });
        const seen = +(req.headers['if-match'] || -1);
        if (seen !== state.version) return send(res, 409, AUTH_ON && state.data ? { version: state.version, data: Auth.filterState(state.data, uid) } : state);
        const data = JSON.parse(raw.toString('utf8'));
        if (!data || !Array.isArray(data.users) || !Array.isArray(data.projects)) return send(res, 400, { error: 'Invalid data' });
        const merged = AUTH_ON && state.data ? Auth.mergeState(state.data, data, uid) : data;
        state = { version: state.version + 1, data: merged };
        persist();
        const created = AUTH_ON ? Auth.syncAccounts(state.data, console.log) : [];
        if (firstSetup) return send(res, 200, { version: state.version, accounts: created });
        return send(res, 200, { version: state.version });
      }
    }

    // Client report links: the dashboard posts a finished, read-only HTML report; the server returns an unguessable link
    if (p === '/api/share' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req, 10 * 1024 * 1024)).toString('utf8'));
      if (!body || typeof body.html !== 'string' || !body.html.startsWith('<!doctype html>')) return send(res, 400, { error: 'Invalid report' });
      const token = crypto.randomBytes(16).toString('hex');
      fs.writeFileSync(path.join(SHARES, `${token}.html`), body.html);
      return send(res, 200, { url: `r/${token}` });
    }
    if (p.startsWith('/r/') && req.method === 'GET') {
      const token = p.slice(3).replace(/[^a-f0-9]/g, '');
      const f = path.join(SHARES, `${token}.html`);
      if (!token || !fs.existsSync(f)) return send(res, 404, 'This report link is not valid or has been removed.', 'text/plain; charset=utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex', 'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data:" });
      return fs.createReadStream(f).pipe(res);
    }

    // Editable PowerPoint client report: built by tools/report_pptx.py (needs: pip install python-pptx)
    if (p === '/api/pptx' && req.method === 'POST') {
      const body = await readBody(req, 5 * 1024 * 1024);
      JSON.parse(body.toString('utf8')); // validate
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rfd-')), inF = path.join(tmp, 'report.json'), outF = path.join(tmp, 'report.pptx');
      fs.writeFileSync(inF, body);
      return execFile(process.env.PYTHON || 'python3', [path.join(ROOT, 'tools', 'report_pptx.py'), inF, outF], { timeout: 60000 }, (err, _o, stderr) => {
        if (err || !fs.existsSync(outF)) { fs.rmSync(tmp, { recursive: true, force: true });
          return send(res, 501, { error: /No module named 'pptx'/.test(String(stderr)) ? 'PowerPoint export needs python-pptx on the server: pip install python-pptx' : 'The PowerPoint could not be built.' }); }
        res.writeHead(200, { 'Content-Type': TYPES['.pptx'], 'Content-Disposition': 'attachment; filename="report.pptx"' });
        fs.createReadStream(outF).on('close', () => fs.rmSync(tmp, { recursive: true, force: true })).pipe(res);
      });
    }

    // AI reading of a creative (creative studio). Needs ANTHROPIC_API_KEY; model via ANTHROPIC_MODEL.
    if (p === '/api/analyze' && req.method === 'POST') {
      const key = process.env.ANTHROPIC_API_KEY;
      if (!key) return send(res, 501, { error: 'The AI reading needs an Anthropic API key on the server: set ANTHROPIC_API_KEY and restart. The heatmap and scores work without it.' });
      let j; try { j = JSON.parse((await readBody(req, 12 * 1024 * 1024)).toString('utf8')); } catch (e) { return send(res, 400, { error: 'Bad request' }); }
      const m = String(j.image || '').match(/^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/);
      if (!m || !j.prompt) return send(res, 400, { error: 'An image and a prompt are needed.' });
      try {
        const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5', max_tokens: 2500,
            messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } }, { type: 'text', text: String(j.prompt).slice(0, 20000) }] }] }) });
        const out = await r.json();
        if (!r.ok) return send(res, 502, { error: 'The AI service returned an error: ' + ((out.error && out.error.message) || r.status) });
        const text = (out.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
        const a = text.indexOf('{'), b = text.lastIndexOf('}');
        let result = null; try { result = JSON.parse(text.slice(a, b + 1)); } catch (e) {}
        if (!result) return send(res, 502, { error: 'The AI reply could not be read. Try again.' });
        return send(res, 200, { result });
      } catch (e) { return send(res, 502, { error: 'The AI service could not be reached from the server.' }); }
    }

    // Original uploaded files
    if (p === '/api/files' && req.method === 'POST') {
      const name = (url.searchParams.get('name') || 'upload').replace(/[^\w.\- ()]/g, '_').slice(0, 120);
      const id = crypto.randomBytes(6).toString('hex');
      const dest = path.join(FILES_DIR, `${id}-${name}`);
      // stream straight to disk so large decks and videos don't sit in memory
      await new Promise((resolve, reject) => {
        let size = 0; const out = fs.createWriteStream(dest);
        req.on('data', c => { size += c.length; if (size > MAX_UPLOAD) { req.destroy(); out.destroy(); fs.rm(dest, () => {}); reject(new Error('too large')); } });
        req.pipe(out); out.on('finish', resolve); out.on('error', reject); req.on('error', reject);
      });
      return send(res, 200, { url: `files/${id}-${encodeURIComponent(name)}` });
    }
    if (p.startsWith('/files/') && req.method === 'GET') {
      const f = path.join(FILES_DIR, path.basename(decodeURIComponent(p.slice(7))));
      if (!fs.existsSync(f)) return send(res, 404, { error: 'Not found' });
      if (AUTH_ON && !Auth.canSeeFile(state.data || {}, uid, path.basename(f))) return send(res, 403, { error: 'Not allowed' });
      const ext = path.extname(f).toLowerCase();
      const how = INLINE.has(ext) && !url.searchParams.has('download') ? 'inline' : 'attachment';
      const total = fs.statSync(f).size;
      const head = { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Accept-Ranges': 'bytes',
        'Content-Disposition': `${how}; filename*=UTF-8''${encodeURIComponent(path.basename(f).slice(13))}` };
      const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || ''); // lets videos seek
      if (range) {
        const start = range[1] ? +range[1] : 0, end = range[2] ? Math.min(+range[2], total - 1) : total - 1;
        res.writeHead(206, { ...head, 'Content-Range': `bytes ${start}-${end}/${total}`, 'Content-Length': end - start + 1 });
        return fs.createReadStream(f, { start, end }).pipe(res);
      }
      res.writeHead(200, { ...head, 'Content-Length': total });
      return fs.createReadStream(f).pipe(res);
    }

    // Static files
    if (req.method === 'GET') {
      const rel = p === '/' ? 'index.html' : path.normalize(decodeURIComponent(p)).replace(/^([/\\])+/, '');
      const f = path.join(PUBLIC, rel);
      if (!f.startsWith(PUBLIC) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return send(res, 404, 'Not found', 'text/plain');
      let body = fs.readFileSync(f);
      if (rel === 'index.html' && AUTH_ON && state.data) {
        const t = body.toString('utf8'), a = t.indexOf('<script>window.TENX='), b = a < 0 ? -1 : t.indexOf('</script>', a);
        if (a >= 0 && b > a) body = Buffer.from(t.slice(0, a) + '<script>window.TENX=null;</script>' + t.slice(b + 9));
      }
      if (rel === 'index.html' && !body.slice(0, 200).toString().includes('<!doctype')) {
        body = Buffer.concat([Buffer.from('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>\n'), body, Buffer.from('\n</body></html>')]);
      }
      return send(res, 200, body, TYPES[path.extname(f)] || 'application/octet-stream');
    }
    send(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    send(res, e.message === 'too large' ? 413 : 500, { error: e.message === 'too large' ? 'File too large' : 'Server error' });
  }
}).listen(PORT, () => console.log(`Realty Funnel Desk running on http://localhost:${PORT}`));
