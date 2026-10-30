// Creative performance feed for other dashboards and the creative-heatmap module.
// GET /api/creative-performance                → projects you can see
// GET /api/creative-performance?project=<id or name>[&from=YYYY-MM-DD&to=YYYY-MM-DD]
//   → { project, from, to, rows: [{ name, platform, campaign, spend, impressions, clicks, leads, ql, sv, status }], average }
// The numbers come from the platform exports (creative level, or ad level when a platform has no creative export)
// with QL and SV where the exports or CRM data carry them. Same rules as the dashboard: newer files win where periods overlap.
const DAY = 864e5;
const iso = t => new Date(t).toISOString().slice(0, 10);
const addDays = (s, n) => iso(Date.parse(s + 'T00:00:00Z') + n * DAY);
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY);

function rawAgg(data, pid, level, from, to) {
  const res = [], byPl = {};
  (data.raws || []).filter(f => f.projectId === pid && (f.level || 'full') === level).forEach(f => (byPl[f.platform] = byPl[f.platform] || []).push(f));
  Object.entries(byPl).forEach(([P, files]) => {
    files.sort((a, b) => String(b.at).localeCompare(String(a.at))); const claimed = [];
    files.forEach(f => {
      (f.rows || []).forEach(r => {
        const s = r.date || f.from, e = r.dateEnd || r.date || f.to; if (!s || !e) return;
        const n = Math.max(1, daysBetween(s, e) + 1); let k = 0;
        for (let i = 0; i < n; i++) { const d = n === 1 ? s : addDays(s, i); if (from && d < from) continue; if (to && d > to) continue; if (claimed.some(c => d >= c[0] && d <= c[1])) continue; k++; }
        if (!k) return; const fr = k / n;
        res.push({ platform: P, campaign: r.campaign, ad: r.ad, spend: (r.spend || 0) * fr, impr: (r.impr || 0) * fr, clicks: (r.clicks || 0) * fr, leads: (r.leads || 0) * fr,
          ql: r.ql == null ? null : r.ql * fr, sv: r.sv == null ? null : r.sv * fr, status: r.status || '', to: f.to });
      });
      claimed.push([f.from, f.to]);
    });
  });
  return res;
}

function creativeRows(data, pid, from, to) {
  const cf = rawAgg(data, pid, 'creative', from, to), pls = new Set(cf.map(r => r.platform));
  const rows = cf.concat(rawAgg(data, pid, 'full', from, to).filter(r => !pls.has(r.platform) && r.ad && r.ad !== '—'));
  const g = {};
  rows.forEach(r => {
    const key = r.ad; if (!key || key === '—') return;
    const o = g[key] = g[key] || { name: key, platform: r.platform, campaign: r.campaign, spend: 0, impressions: 0, clicks: 0, leads: 0, ql: null, sv: null, status: '', last: '' };
    if (o.platform !== r.platform) o.platform = 'Mixed';
    o.spend += r.spend; o.impressions += r.impr; o.clicks += r.clicks; o.leads += r.leads;
    if (r.ql != null) o.ql = (o.ql || 0) + r.ql; if (r.sv != null) o.sv = (o.sv || 0) + r.sv;
    if (r.status && (r.to || '') >= o.last) { o.last = r.to || ''; o.status = r.status; }
  });
  const round = v => v == null ? null : Math.round(v * 100) / 100;
  return Object.values(g).filter(r => r.spend > 0 || r.leads > 0).sort((a, b) => b.spend - a.spend)
    .map(r => ({ name: r.name, platform: r.platform, campaign: r.campaign || '', status: r.status, spend: Math.round(r.spend), impressions: Math.round(r.impressions), clicks: Math.round(r.clicks), leads: round(r.leads), ql: round(r.ql), sv: round(r.sv) }));
}

function total(rows) {
  const o = { name: 'All creatives', spend: 0, impressions: 0, clicks: 0, leads: 0, ql: null, sv: null };
  rows.forEach(r => { o.spend += r.spend; o.impressions += r.impressions; o.clicks += r.clicks; o.leads += r.leads; if (r.ql != null) o.ql = (o.ql || 0) + r.ql; if (r.sv != null) o.sv = (o.sv || 0) + r.sv; });
  return o;
}

/** visibleIds: Set of project ids this caller may see, or null for all. */
function creativePerformance(data, query, visibleIds) {
  const projects = (data.projects || []).filter(p => !visibleIds || visibleIds.has(p.id));
  const q = String(query.get('project') || '').trim();
  if (!q) return { code: 200, body: { projects: projects.map(p => ({ id: p.id, name: p.name, brand: p.brand, location: p.location })) } };
  const low = q.toLowerCase(), p = projects.find(x => x.id === q) || projects.find(x => String(x.name).toLowerCase() === low) || projects.find(x => String(x.name).toLowerCase().startsWith(low));
  if (!p) return { code: 404, body: { error: 'No project with that id or name that you can see.' } };
  const okDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s : null, from = okDate(query.get('from')), to = okDate(query.get('to'));
  const rows = creativeRows(data, p.id, from, to);
  return { code: 200, body: { project: { id: p.id, name: p.name, brand: p.brand, location: p.location }, from, to, rows, average: total(rows),
    note: rows.some(r => r.sv != null) ? undefined : 'Site visits are not in the uploaded exports for this project yet. Upload CRM data or exports that carry SV by ad name.' } };
}

module.exports = { creativePerformance, creativeRows };
