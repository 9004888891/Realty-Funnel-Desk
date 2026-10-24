"""Extract the Ten X District 9 working file (PPT Format 2026-27.xlsx) into dashboard data.

Usage: python3 extract_tenx.py <workbook.xlsx> <out.json>
Reads: monthly target vs achieved (overall + channel), Meta ad sets, Google campaigns,
lead status by ad set / campaign, creatives, keywords, SV source, QL status, lost reasons, budget ledger.
"""
import json, re, sys, datetime
import openpyxl

MONTHS = {'sep': '2026-09', 'aug': '2026-08', 'jul': '2026-07', 'jun': '2026-06', 'may': '2026-05', 'apr': '2026-04'}
ORDER = ['2026-09', '2026-08', '2026-07', '2026-04', '2026-05', '2026-06']  # order blocks appear in the sheets

def num(v):
    if v is None: return 0.0
    if isinstance(v, (int, float)): return float(v)
    s = re.sub(r'[₹,\s%]', '', str(v))
    try: return float(s)
    except ValueError: return 0.0

def s(v): return '' if v is None else str(v).strip()

CH_MAP = [
    (r'payu', 'Payu'), (r'pinelabs', 'Pinelabs'), (r'lookalike', 'Lookalike'), (r'lg otp|^otp$', 'OTP'),
    (r'leadgen', 'Leadgen'), (r'ctw', 'CTW'), (r'remarketing', 'Remarketing'), (r'taboola', 'Taboola'),
    (r'demand', 'Google Demand Gen'), (r'google.?search|^search$', 'Google Search'), (r'inbound', 'Inbound Call'),
    (r'microsite', 'Microsite'),
]
def channel(name):
    n = s(name).lower().replace('_', ' ')
    for pat, out in CH_MAP:
        if re.search(pat, n): return out
    return s(name)

PLATFORM = {'Payu': 'Meta', 'Pinelabs': 'Meta', 'Lookalike': 'Meta', 'OTP': 'Meta', 'Leadgen': 'Meta', 'CTW': 'Meta', 'Remarketing': 'Meta',
            'Google Search': 'Google', 'Google Demand Gen': 'Google', 'Taboola': 'Taboola', 'Inbound Call': 'Offline', 'Microsite': 'Offline'}

def month_range(m):
    y, mm = map(int, m.split('-'))
    last = (datetime.date(y + (mm == 12), mm % 12 + 1, 1) - datetime.timedelta(days=1)).day
    return f'{m}-01', f'{m}-{last:02d}'

def rows(ws):
    return [[c for c in r] for r in ws.iter_rows(values_only=True)]

def col(letter): return ord(letter) - 65

wb = openpyxl.load_workbook(sys.argv[1], data_only=True)
out = {'plans': [], 'reports': [], 'raws': [], 'crm': [], 'money': [], 'blocks': [], 'checks': []}

# ---------- monthly target vs achieved ----------
T = rows(wb['Finacial Year April 2026 Target'])
overall, chan_blocks = [], []
for i, r in enumerate(T):
    if s(r[col('B')]) == 'Metrics' and s(r[col('C')]) == 'Monthly Target':
        m = {}
        for rr in T[i + 1:i + 14]:
            k = s(rr[col('B')])
            if not k: break
            m[k] = (num(rr[col('C')]), num(rr[col('D')]))
        overall.append(m)
    if s(r[col('B')]) == 'Source' and s(r[col('C')]) == 'Spends' and s(r[col('M')]) == 'QL':
        data = []
        for rr in T[i + 2:i + 20]:
            name = s(rr[col('B')])
            if not name or name == 'Total': break
            data.append(rr)
        chan_blocks.append(data)
overall = overall[:6]; chan_blocks = chan_blocks[:6]
Q = {}  # quarter tables (bookings)
for i, r in enumerate(T):
    for c0 in ('J', 'P'):
        if s(r[col(c0)]) == 'Metrics':
            title = s(T[i - 1][col(c0)])
            m = {s(rr[col(c0)]): (num(rr[col(chr(ord(c0) + 1))]), num(rr[col(chr(ord(c0) + 2))])) for rr in T[i + 1:i + 13] if s(rr[col(c0)])}
            Q[title] = m
booking = {'2026-06': None, '2026-09': None}
for title, m in Q.items():
    if 'Booking' in m:
        if title.startswith('Q2'): booking['2026-09'] = m['Booking']
        elif title.startswith('Q1') and 'with' not in title: booking['2026-06'] = m['Booking']

for idx, month in enumerate(ORDER):
    ov, data = overall[idx], chan_blocks[idx]
    f, t = month_range(month)
    plan_rows, rep_rows = [], []
    for rr in data:
        ch = channel(rr[col('B')])
        plan_rows.append({'channel': ch, 'spend': num(rr[col('C')]), 'impr': num(rr[col('E')]), 'clicks': num(rr[col('G')]), 'leads': num(rr[col('I')]), 'ql': 0, 'sv': 0, 'bookings': 0})
        rep_rows.append({'channel': ch, 'spend': round(num(rr[col('D')]), 2), 'impr': num(rr[col('F')]), 'clicks': num(rr[col('H')]), 'leads': num(rr[col('J')]),
                         'ql': num(rr[col('M')]), 'sv': num(rr[col('P')]), 'bookings': 0})
    plan_rows = [p for p in plan_rows if p['spend'] or p['leads']]
    sv_channel = sum(r['sv'] for r in rep_rows)
    sv_total = ov.get('Site Visits', (0, 0))[1]
    bk = booking.get(month)
    extra = {'channel': 'CRM adjustments', 'spend': 0, 'impr': 0, 'clicks': 0, 'leads': 0, 'ql': 0, 'sv': max(0, sv_total - sv_channel), 'bookings': bk[1] if bk else 0}
    if extra['sv'] or extra['bookings']: rep_rows.append(extra)
    totals = {'ql': ov['Qualified Leads'][0], 'sv': ov['Site Visits'][0], 'bookings': bk[0] if bk else 0}
    out['plans'].append({'month': month, 'rows': plan_rows, 'totals': totals})
    out['reports'].append({'month': month, 'from': f, 'to': t, 'rows': rep_rows})
    # reconciliation against the sheet's own overall table
    sp = sum(r['spend'] for r in rep_rows); ld = sum(r['leads'] for r in rep_rows); ql = sum(r['ql'] for r in rep_rows); sv = sum(r['sv'] for r in rep_rows)
    out['checks'].append({'month': month, 'spend': [round(sp), round(ov['Spends'][1])], 'leads': [ld, ov['Total Leads'][1]], 'ql': [ql, ov['Qualified Leads'][1]], 'sv': [sv, sv_total],
                          'plan_spend': [sum(p['spend'] for p in plan_rows), ov['Spends'][0]], 'plan_leads': [sum(p['leads'] for p in plan_rows), ov['Total Leads'][0]]})

# ---------- ad sets / campaigns with status, QL, SV; lead status matrices ----------
def perf_blocks(R, name_col='C'):
    blocks = []
    for i, r in enumerate(R):
        if s(r[col('D')]) == 'Status' and s(r[col('E')]) == 'Spends' and s(r[col(name_col)]) in ('Ad Set', 'Campaign'):
            items, group, totals = [], 'WP', 0
            for rr in R[i + 1:i + 40]:
                n = s(rr[col(name_col)])
                if n == 'WOP': group = 'WOP'; continue
                if n == 'Total':
                    totals += 1
                    if group == 'WP' and totals == 1 and any(s(x[col(name_col)]) == 'WOP' for x in R[i + 1:i + 40]): continue
                    break
                if not n: continue
                items.append({'name': n, 'group': group, 'start': s(rr[col('B')]) if s(rr[col('B')]) not in ('-', '') else '', 'status': s(rr[col('D')]),
                              'spend': round(num(rr[col('E')]), 2), 'leads': num(rr[col('F')]), 'ql': num(rr[col('H')]), 'sv': num(rr[col('J')])})
            blocks.append(items)
    return blocks
STATUSES = {'Call Back', 'Follow Up', 'Lost', 'Open', 'System Generated Lost', 'Visit Done', 'Visit Proposed', 'TMD'}
def status_blocks(R):
    blocks = []
    for i, r in enumerate(R):
        cells = [s(x) for x in r]
        if 'Grand Total' in cells and cells[col('C')] in ('Call Status', 'Call Back') and cells[col('D')] and cells[col('D')] not in STATUSES and not re.match(r'^[\d.]+$', cells[col('D')]):
            gt = cells.index('Grand Total'); names = cells[col('D'):gt]
            mat = {}
            for rr in R[i + 1:i + 14]:
                st = s(rr[col('C')])
                if st == 'Grand Total': break
                if st in STATUSES:
                    for j, n in enumerate(names):
                        v = num(rr[col('D') + j])
                        if v: mat.setdefault(n, {})[st] = v
            blocks.append(mat)
    return blocks

M = rows(wb['Meta Adset Wise']); G = rows(wb['Google'])
meta_blocks, meta_status = perf_blocks(M), status_blocks(M)
google_blocks, google_status = perf_blocks(G), status_blocks(G)

def assign(blocks, platform_channels):
    """Match each block to a month by its spend total against the channel table."""
    res = {}
    for b in blocks:
        tot = sum(x['spend'] for x in b)
        best = min(ORDER, key=lambda m: abs(tot - sum(r['spend'] for r in next(rp for rp in out['reports'] if rp['month'] == m)['rows'] if PLATFORM.get(r['channel']) in platform_channels)))
        res.setdefault(best, b)
    return res
meta_by_m = assign(meta_blocks, ('Meta',)); google_by_m = assign(google_blocks, ('Google',))
for m, b in meta_by_m.items():
    f, t = month_range(m)
    out['raws'].append({'platform': 'Meta', 'from': f, 'to': t, 'level': 'full', 'file': 'Meta Adset Wise (PPT Format 2026-27.xlsx)',
                        'rows': [{'date': '', 'campaign': 'With price' if x['group'] == 'WP' else 'Without price', 'adset': x['name'], 'ad': '—', 'spend': x['spend'], 'impr': 0, 'clicks': 0,
                                  'leads': x['leads'], 'ql': x['ql'], 'sv': x['sv'], 'status': x['status'], 'start': x['start']} for x in b]})
for m, b in google_by_m.items():
    f, t = month_range(m)
    out['raws'].append({'platform': 'Google', 'from': f, 'to': t, 'level': 'full', 'file': 'Google (PPT Format 2026-27.xlsx)',
                        'rows': [{'date': '', 'campaign': x['name'], 'adset': '—', 'ad': '—', 'spend': x['spend'], 'impr': 0, 'clicks': 0,
                                  'leads': x['leads'], 'ql': x['ql'], 'sv': x['sv'], 'status': x['status']} for x in b]})
for m in ORDER:
    rp = next(r for r in out['reports'] if r['month'] == m)
    for pl, by in (('Meta', meta_by_m), ('Google', google_by_m)):
        team = sum(r['spend'] for r in rp['rows'] if PLATFORM.get(r['channel']) == pl)
        raw = sum(x['spend'] for x in by.get(m, []))
        out['checks'].append({'month': m, 'verify_' + pl: [round(team), round(raw)]})

# lead status by source: pair each status block with the perf block before it (same order)
def status_month(blocks_perf, blocks_status, by_m):
    res = {}
    order = [next(m for m, b in by_m.items() if b is pb) for pb in blocks_perf if any(b is pb for b in by_m.values())]
    for m, st in zip(order, blocks_status): res[m] = st
    return res
meta_st = status_month(meta_blocks, meta_status, meta_by_m); google_st = status_month(google_blocks, google_status, google_by_m)

# ---------- creatives ----------
C = rows(wb['Creative Analysis'])
month_mark, group_mark, creatives = None, 'WP', {}
for i, r in enumerate(C):
    a, b = s(r[col('A')]), s(r[col('B')])
    mm = re.match(r'1st (\w+)', a)
    if mm and mm.group(1)[:3].lower() in MONTHS: month_mark = MONTHS[mm.group(1)[:3].lower()]
    for v in (a, b):
        if v.lower() == 'wp': group_mark = 'WP'
        if v.upper() == 'WOP': group_mark = 'WOP'
    if b == 'Name' and s(r[col('C')]).startswith('SUM of Amount spent') and month_mark:
        for rr in C[i + 1:i + 30]:
            n = s(rr[col('B')])
            if not n: break
            creatives.setdefault(month_mark, []).append({'campaign': 'With price' if group_mark == 'WP' else 'Without price', 'ad': n, 'spend': round(num(rr[col('C')]), 2), 'leads': num(rr[col('D')]),
                                                         'impr': num(rr[col('E')]), 'clicks': num(rr[col('F')]), 'ql': num(rr[col('G')]), 'sv': num(rr[col('H')])})
for m, items in creatives.items():
    f, t = month_range(m)
    out['raws'].append({'platform': 'Meta', 'from': f, 'to': t, 'level': 'creative', 'file': 'Creative Analysis (PPT Format 2026-27.xlsx)',
                        'rows': [dict(date='', adset='—', **x) for x in items]})

# ---------- keywords ----------
K = rows(wb['keywords'])
for i, r in enumerate(K):
    cells = [s(x) for x in r]
    if 'Keyword' in cells:
        k0 = cells.index('Keyword'); hdr = {h.lower(): j for j, h in enumerate(cells) if h}
        title = ' '.join(s(x) for x in K[i - 1] if s(x)) if i else ''
        grp = 'Brand' if 'Brand' in title else 'Generic' if 'Generic' in title else 'Search'
        items = []
        for rr in K[i + 1:i + 60]:
            n = s(rr[k0])
            if not n or n == 'Total': break
            g = lambda h: num(rr[hdr[h]]) if h in hdr else 0
            items.append({'campaign': grp, 'ad': n, 'spend': round(g('spends'), 2), 'impr': g('impression'), 'clicks': g('clicks'), 'leads': g('leads'), 'ql': g('ql'), 'sv': g('sv')})
        if not items: continue
        mm = re.search(r'1st (\w+)', title); month = MONTHS.get(mm.group(1)[:3].lower()) if mm else None
        if not month:  # match by Google Search spend
            tot = sum(x['spend'] for x in items)
            month = min(ORDER, key=lambda m: abs(tot - sum(r['spend'] for r in next(rp for rp in out['reports'] if rp['month'] == m)['rows'] if r['channel'] == 'Google Search')))
        f, t = month_range(month)
        existing = next((x for x in out['raws'] if x['level'] == 'keyword' and x['from'] == f), None)
        rws = [dict(date='', adset='—', **x) for x in items]
        if existing: existing['rows'] += rws
        else: out['raws'].append({'platform': 'Google', 'from': f, 'to': t, 'level': 'keyword', 'file': 'keywords (PPT Format 2026-27.xlsx)', 'rows': rws})

# ---------- SV source, QL status, lost reasons ----------
SVS = rows(wb['SV Source']); sv_source = {}
label = None
for i, r in enumerate(SVS):
    b = s(r[col('B')])
    if b in ('Q2', 'September', 'August', 'July'): label = b
    if b == 'Source' and s(r[col('C')]) == 'SV':
        d = {}
        for rr in SVS[i + 1:i + 30]:
            n = s(rr[col('B')])
            if not n or n == 'Total': break
            d[n] = num(rr[col('C')])
        if label: sv_source[label] = d
        label = None
PL = rows(wb['Past month lead status']); ql_status = {}
label = 'unlabelled'
for i, r in enumerate(PL):
    b = s(r[col('B')])
    if b in ('Q2', 'aug in sept'): label = b
    if b == 'Current status':
        st, lost = {}, {}
        for rr in PL[i + 1:i + 20]:
            if s(rr[col('B')]) and s(rr[col('B')]) != 'Grand Total': st[s(rr[col('B')])] = num(rr[col('C')])
            if s(rr[col('E')]) and s(rr[col('E')]) != 'Grand Total': lost[s(rr[col('E')])] = num(rr[col('F')])
            if not s(rr[col('B')]) and not s(rr[col('E')]): break
        ql_status[label] = {'status': st, 'lost': lost}
RL = rows(wb['Reason For Lost']); lost_blocks = []
for i, r in enumerate(RL):
    if s(r[col('C')]) == 'Reason For Lost':
        cells = [s(x) for x in r]; gt = cells.index('Grand Total'); chans = cells[col('D'):gt]
        mat = {}
        for rr in RL[i + 1:i + 30]:
            reason = s(rr[col('C')])
            if not reason or reason == 'Grand Total': break
            for j, ch in enumerate(chans):
                v = num(rr[col('D') + j])
                if v: mat.setdefault(reason, {})[channel(ch)] = mat.get(reason, {}).get(channel(ch), 0) + v
        lost_blocks.append(mat)
LOST_ORDER = ['2026-09', '2026-08', '2026-07', '2026-04', '2026-05', '2026-06']
lost_by_m = dict(zip(LOST_ORDER, lost_blocks))
label_m = {'September': '2026-09', 'August': '2026-08', 'July': '2026-07'}
for m in ORDER:
    f, t = month_range(m)
    status = {}
    for src, d in list(meta_st.get(m, {}).items()) + list(google_st.get(m, {}).items()):
        status[src] = d
    rec = {'from': f, 'to': t, 'label': datetime.date(int(m[:4]), int(m[5:]), 1).strftime('%B %Y'), 'status': status, 'lost': lost_by_m.get(m, {}),
           'svSource': next((d for k, d in sv_source.items() if label_m.get(k) == m), {}), 'file': 'PPT Format 2026-27.xlsx'}
    if m == '2026-09' and 'aug in sept' in ql_status: rec['prevQl'] = dict(ql_status['aug in sept'], label='August QLs, status as of September')
    out['crm'].append(rec)
if 'Q2' in sv_source or 'Q2' in ql_status:
    out['crm'].append({'from': '2026-07-01', 'to': '2026-09-30', 'label': 'Q2 (Jul–Sep 2026)', 'quarter': True, 'status': {}, 'lost': {}, 'svSource': sv_source.get('Q2', {}),
                       'qlStatus': ql_status.get('Q2', {}), 'file': 'PPT Format 2026-27.xlsx'})

# ---------- budget ledger ----------
L = rows(wb['3.0'])
def pdate(v):
    if isinstance(v, datetime.datetime): return v.date().isoformat()
    mm = re.match(r'(\d{1,2})\w*\s+(\w+)\s+(\d{4})', s(v))
    if not mm: return ''
    mon = datetime.datetime.strptime(mm.group(2)[:3].title(), '%b').month
    return f'{mm.group(3)}-{mon:02d}-{int(mm.group(1)):02d}'
for r in L[5:46]:
    desc, amt, date, remark = s(r[col('B')]), r[col('C')], r[col('D')], s(r[col('E')])
    if not desc or amt is None: continue
    amt = round(num(amt), 2); d = pdate(date) or '2026-04-01'
    note = desc + (f' · {remark}' if remark else '')
    if re.match(r'(amount )?block', desc, re.I):
        seg = 'Landing page / hosting' if 'LP' in desc else 'Influencer' if 'influencer' in desc.lower() else 'Microsite' if 'website' in desc.lower() else 'Other'
        out['blocks'].append({'date': d, 'segment': seg, 'note': note, 'amount': abs(amt)})
    else:
        out['money'].append({'date': d, 'amount': amt, 'note': note})
out['ledgerCheck'] = {'mediaBudgetSheet': num(L[46][col('C')]), 'mediaBudgetParsed': round(sum(m['amount'] for m in out['money']) - sum(b['amount'] for b in out['blocks']), 2)}
out['channelPlatform'] = PLATFORM
json.dump(out, open(sys.argv[2], 'w'), indent=1, default=str)
for c in out['checks']: print(c)
print('ledger', out['ledgerCheck'])
print('raw files:', [(r['platform'], r['level'], r['from'], len(r['rows']), round(sum(x['spend'] for x in r['rows']))) for r in out['raws']])
print('crm:', [(c['label'], len(c['status']), sum(sum(v.values()) for v in c['lost'].values()), sum(c['svSource'].values())) for c in out['crm']])
