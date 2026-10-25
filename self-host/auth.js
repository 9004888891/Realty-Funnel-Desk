// Realty Funnel Desk — sign-in, sessions and role-based data scoping for server.js
// Passwords are stored as scrypt hashes in DATA_DIR/auth.json (never inside the shared data file).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

module.exports = function makeAuth(DATA_DIR) {
  const AUTH = path.join(DATA_DIR, 'auth.json');
  const SESSION_DAYS = +process.env.SESSION_DAYS || 7;
  let auth = { accounts: {} };           // userId -> {username, salt, hash, mustChange, lastLogin}
  if (fs.existsSync(AUTH)) auth = JSON.parse(fs.readFileSync(AUTH, 'utf8'));
  const sessions = new Map();            // token -> {uid, exp}
  const fails = new Map();               // ip|username -> {n, until}

  const save = () => { const t = AUTH + '.tmp'; fs.writeFileSync(t, JSON.stringify(auth, null, 1), { mode: 0o600 }); fs.renameSync(t, AUTH); };
  const hash = (pw, salt) => crypto.scryptSync(String(pw), salt, 64).toString('hex');
  const tempPassword = () => {
    const w = ['Thane', 'Mumbai', 'Pune', 'Tower', 'Garden', 'Metro', 'Harbour', 'Skyline', 'Lake', 'Crest'];
    return w[crypto.randomInt(w.length)] + '-' + crypto.randomInt(1000, 9999) + '-' + crypto.randomBytes(2).toString('hex');
  };
  const slug = n => String(n || 'user').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '') || 'user';

  function setPassword(uid, pw, mustChange) {
    const a = auth.accounts[uid]; const salt = crypto.randomBytes(16).toString('hex');
    Object.assign(a, { salt, hash: hash(pw, salt), mustChange: !!mustChange, setAt: new Date().toISOString() }); save();
  }
  // Make sure every team member has an account. New accounts get a temporary password that the
  // server owner can read once from DATA_DIR/initial-passwords.txt (or reset from Team & access).
  function syncAccounts(data, log) {
    if (!data || !Array.isArray(data.users)) return;
    const taken = new Set(Object.values(auth.accounts).map(a => a.username)); const fresh = [];
    for (const u of data.users) {
      if (auth.accounts[u.id]) continue;
      let name = slug(u.name), n = 2; while (taken.has(name)) name = slug(u.name) + n++;
      taken.add(name); auth.accounts[u.id] = { username: name };
      const pw = tempPassword(); setPassword(u.id, pw, true); fresh.push(`${u.name.padEnd(24)} ${String(u.role).padEnd(5)} ${name.padEnd(22)} ${pw}`);
    }
    if (fresh.length) {
      const f = path.join(DATA_DIR, 'initial-passwords.txt');
      fs.appendFileSync(f, `# ${new Date().toISOString()} — temporary passwords (each person sets their own at first sign-in). Delete this file after handing them out.\n${fresh.join('\n')}\n\n`, { mode: 0o600 });
      if (log) log(`Created ${fresh.length} sign-in account(s). Temporary passwords are in ${f}`);
    }
  }

  // ---------- sessions ----------
  const cookieOf = req => { const m = String(req.headers.cookie || '').match(/(?:^|;\s*)rfd_s=([a-f0-9]{64})/); return m ? m[1] : null; };
  function userOf(req) {
    const t = cookieOf(req), s = t && sessions.get(t);
    if (!s || s.exp < Date.now() || !auth.accounts[s.uid]) { if (t) sessions.delete(t); return null; }
    return s.uid;
  }
  function cookie(req, token, maxAge) {
    const secure = process.env.COOKIE_SECURE === '1' || String(req.headers['x-forwarded-proto'] || '').includes('https');
    return `rfd_s=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  }
  function login(req, username, password) {
    const ip = req.socket.remoteAddress || '', key = ip + '|' + String(username).toLowerCase(), f = fails.get(key);
    if (f && f.until > Date.now()) return { error: 'Too many attempts. Try again in 15 minutes.', code: 429 };
    const uid = Object.keys(auth.accounts).find(id => auth.accounts[id].username === String(username || '').trim().toLowerCase());
    const a = uid && auth.accounts[uid];
    const ok = a && a.hash && crypto.timingSafeEqual(Buffer.from(hash(password, a.salt), 'hex'), Buffer.from(a.hash, 'hex'));
    if (!ok) { const n = (f && f.until <= Date.now() ? 0 : (f ? f.n : 0)) + 1; fails.set(key, { n, until: n >= 5 ? Date.now() + 15 * 60e3 : 0 }); return { error: 'Wrong username or password.', code: 401 }; }
    fails.delete(key); a.lastLogin = new Date().toISOString(); save();
    const token = crypto.randomBytes(32).toString('hex'); sessions.set(token, { uid, exp: Date.now() + SESSION_DAYS * 864e5 });
    return { uid, cookie: cookie(req, token, SESSION_DAYS * 86400) };
  }
  function logout(req) { const t = cookieOf(req); if (t) sessions.delete(t); return cookie(req, '', 0); }
  function endSessionsFor(uid, keep) { for (const [t, s] of sessions) if (s.uid === uid && t !== keep) sessions.delete(t); }
  function changePassword(req, uid, current, next) {
    const a = auth.accounts[uid];
    if (!a || !crypto.timingSafeEqual(Buffer.from(hash(current, a.salt), 'hex'), Buffer.from(a.hash, 'hex'))) return { error: 'The current password is wrong.' };
    if (String(next || '').length < 8) return { error: 'Use at least 8 characters.' };
    if (next === current) return { error: 'Choose a password different from the current one.' };
    setPassword(uid, next, false); endSessionsFor(uid, cookieOf(req)); return { ok: true };
  }

  // ---------- roles and scope (same rules as the dashboard) ----------
  function subtree(users, id) { const out = new Set([id]); let grew = true; while (grew) { grew = false; for (const u of users) if (u.reportsTo && out.has(u.reportsTo) && !out.has(u.id)) { out.add(u.id); grew = true; } } return out; }
  function visible(data, uid) {
    const users = data.users || [], me = users.find(u => u.id === uid), V = new Set();
    if (!me) return V;
    if (me.role === 'L1' || me.role === 'LEAD') { (data.projects || []).forEach(p => V.add(p.id)); return V; }
    if (me.role === 'AM') { const t = subtree(users, uid); (data.projects || []).forEach(p => { if (t.has(p.ownerId)) V.add(p.id); }); return V; }
    (data.projects || []).forEach(p => { if (p.ownerId === uid) V.add(p.id); }); return V;
  }
  const roleOf = (data, uid) => ((data.users || []).find(u => u.id === uid) || {}).role;
  const LISTS = ['projects', 'money', 'blocks', 'plans', 'reports', 'docs', 'raws', 'crm', 'boardNotes', 'shares'];
  const pidOf = (k, r) => k === 'projects' ? r.id : r.projectId;
  const KEYED = { profiles: k => k, notes: k => k, reviews: k => String(k).split('|')[0] };

  function filterState(data, uid) {
    if (!data) return data;
    const V = visible(data, uid), me = (data.users || []).find(u => u.id === uid) || {}, out = { ...data };
    for (const k of LISTS) if (Array.isArray(data[k])) out[k] = data[k].filter(r => V.has(pidOf(k, r)));
    for (const [k, f] of Object.entries(KEYED)) if (data[k]) out[k] = Object.fromEntries(Object.entries(data[k]).filter(([key]) => V.has(f(key))));
    if (data.creativeAI) { const ok = new Set((out.docs || []).map(d => d.id)); out.creativeAI = Object.fromEntries(Object.entries(data.creativeAI).filter(([id]) => ok.has(id))); }
    if (Array.isArray(data.audit)) { const team = subtree(data.users || [], uid);
      out.audit = data.audit.filter(a => me.role === 'L1' || (a.projectId ? V.has(a.projectId) : (['LEAD', 'AM'].includes(me.role) && a.by && team.has(a.by)))); }
    return out;
  }
  // Merge a save from one person into the full data: they can only change what their role lets them see.
  function mergeState(full, incoming, uid) {
    const role = roleOf(full, uid), manager = ['L1', 'LEAD', 'AM'].includes(role), V = visible(full, uid), out = { ...full };
    const serverIds = new Set((full.projects || []).map(p => p.id));
    if (manager) (incoming.projects || []).forEach(p => { if (!serverIds.has(p.id)) V.add(p.id); });   // projects they add
    for (const k of LISTS) {
      if (k === 'projects' && !manager) continue;
      const mine = (incoming[k] || []).filter(r => V.has(pidOf(k, r)));
      out[k] = (full[k] || []).filter(r => !V.has(pidOf(k, r))).concat(mine);
    }
    for (const [k, f] of Object.entries(KEYED)) {
      const keep = Object.entries(full[k] || {}).filter(([key]) => !V.has(f(key))), mine = Object.entries(incoming[k] || {}).filter(([key]) => V.has(f(key)));
      out[k] = Object.fromEntries(keep.concat(mine));
    }
    { const docP = new Map((out.docs || []).map(d => [d.id, d.projectId]));
      const keep = Object.entries(full.creativeAI || {}).filter(([id]) => !V.has(docP.get(id))), mine = Object.entries(incoming.creativeAI || {}).filter(([id]) => V.has(docP.get(id)));
      out.creativeAI = Object.fromEntries(keep.concat(mine)); }
    if (role === 'L1') { out.users = incoming.users || full.users; out.example = incoming.example; }
    { const seen = new Set((full.audit || []).map(a => a.at + '|' + a.by + '|' + a.text));
      const add = (incoming.audit || []).filter(a => !seen.has(a.at + '|' + a.by + '|' + a.text) && a.by === uid);
      out.audit = add.concat(full.audit || []).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 1000); }
    return out;
  }
  function canSeeFile(data, uid, rel) {
    const V = visible(data, uid), want = 'files/' + rel;
    for (const k of ['docs', 'reports', 'plans', 'raws', 'crm']) for (const r of data[k] || []) {
      if (!r.url) continue; let u = r.url; try { u = decodeURIComponent(u); } catch (e) {}
      if ((u === want || r.url === want) && V.has(r.projectId)) return true;
    }
    return false;
  }
  // Accounts a manager can see and reset: L1 everyone; Leads and AMs their own team.
  function manageable(data, uid) {
    const role = roleOf(data, uid); if (!['L1', 'LEAD', 'AM'].includes(role)) return new Set([uid]);
    if (role === 'L1') return new Set((data.users || []).map(u => u.id));
    return subtree(data.users || [], uid);
  }
  function accounts(data, uid) {
    const can = manageable(data, uid);
    return (data.users || []).filter(u => can.has(u.id)).map(u => { const a = auth.accounts[u.id] || {};
      return { userId: u.id, username: a.username || null, mustChange: !!a.mustChange, lastLogin: a.lastLogin || null }; });
  }
  function reset(data, uid, target) {
    if (!manageable(data, uid).has(target) || !(data.users || []).some(u => u.id === target)) return { error: 'You cannot reset this person\'s password.', code: 403 };
    if (!auth.accounts[target]) syncAccounts(data);
    const pw = tempPassword(); setPassword(target, pw, true); endSessionsFor(target);
    return { username: auth.accounts[target].username, password: pw };
  }
  const me = uid => { const a = auth.accounts[uid] || {}; return { userId: uid, username: a.username, mustChange: !!a.mustChange }; };
  return { syncAccounts, userOf, login, logout, changePassword, filterState, mergeState, canSeeFile, accounts, reset, me, visible };
};
