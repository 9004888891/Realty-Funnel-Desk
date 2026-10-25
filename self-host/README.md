# Realty Funnel Desk — prototype

A performance dashboard and file repository for real estate campaigns. Teams upload media plans and performance reports (Excel or CSV), report presentations (PPT / PDF) and creatives (images, videos, PDF, ZIP); the dashboard reads the Excel data and shows money received, spend, balance, planned vs achieved, and the full funnel (Impressions → Clicks → Leads → QL → SV → Bookings), with drill-down by Location → Brand → Project and access by role.

## What's in this folder

| Path | What it is |
|---|---|
| `public/index.html` | The whole dashboard (one file). |
| `server.js` | A small Node.js server: serves the dashboard, keeps shared data, stores uploaded files. No dependencies. |
| `tools/report_pptx.py` | Builds the editable PowerPoint client report (`pip install python-pptx`). Used by `POST /api/pptx`. |
| `tools/extract_tenx.py` | Reads the Ten X District 9 working file (PPT Format 2026-27.xlsx) into dashboard data; a starting point for importing other brands' working files. |
| `templates/` | `Report_Template.xlsx` and `Plan_Template.xlsx` — the column layout the reader expects. |
| `data/` | Created on first run. `state.json` (all data), `files/` (original uploads), `backups/` (hourly copies), `shares/` (client report links). |

## Run it on your server

Requires Node.js 18 or newer.

```bash
node server.js                 # http://your-server:8080
PORT=3000 node server.js       # different port
DATA_DIR=/srv/rfd-data node server.js   # keep data outside the app folder
```

Keep it running with a process manager, for example `pm2 start server.js --name rfd`, or a systemd service. Put it behind Nginx or your existing web server with HTTPS.

## How syncing works

There is no live connection to Google Ads, Meta or any other platform yet. Uploaded files, including the platforms' own exports, are the only data source.

1. **Upload.** A team member uploads a plan or report. The browser reads the file, finds the table with a `Channel` column, and shows a preview.
2. **Save.** On "Save to project", the original file is sent to `POST /api/files` (stored in `data/files/`) and the extracted numbers are saved to `PUT /api/state`.
3. **Everyone sees it.** Every open dashboard checks the server every 30 seconds (`GET /api/state?since=<version>`) and refreshes when something changed.
4. **No overwrites.** Each save carries the version the user last saw. If a teammate saved first, the server refuses the save (HTTP 409), the dashboard reloads the latest data and asks the user to redo the change.
5. **Backups.** The server keeps an hourly copy of the data in `data/backups/`. Back up the whole `data/` folder with your normal server backups.

When the page is opened without the server (for example the review link), it saves to that browser only. The badge in the top bar says which mode is active: "Synced to server" or "Saved in this browser".

### Moving existing data
Team & access → Data → Export data (JSON) on one copy, then Import data (JSON) on the other.

## Checking the team's data automatically

No manual approval step. Two automatic layers:

1. **Checks on every team upload.** Before saving, each performance report is checked for: the file's Total row not matching the sum of its channels; impossible funnels (QL > leads, SV > QL, bookings > SV, clicks > impressions); a CPL in the file that differs from spend ÷ leads; negative values; dates before the project start, in the future, or a length that doesn't fit the report type; overlap with existing reports; channel names the project has never used (typos); and CPL or spend more than 50% away from the last four reports. Flags don't block the save; the report is marked and listed under **Data checks**.
2. **Platform exports.** Upload the raw export from Meta Ads Manager, Google Ads or any other platform (Upload → Platform export). For every team report, the dashboard adds up the platform's own spend for the same days and compares: within 2% = matches, 2–10% = small gap, over 10% = mismatch. Team channels are matched to platforms by name (FB/Meta/Instagram → Meta; Google Search/Demand Gen/PMax/YouTube/Display → Google; LinkedIn; Taboola). Results show on every dashboard row ("Spend verified" / "1 spend mismatch"), in each project's **Spend verification** table, and in **Data checks**.

Exports work best with a daily breakdown. Recognised columns — Meta: Campaign name, Ad set name, Ad name, Day / Reporting starts–ends, Amount spent, Impressions, Link clicks, Leads / Results. Google Ads: Day, Campaign, Ad group, Cost, Impr., Clicks, Conversions. Other platforms: any sheet with a Campaign (or Ad set / Ad) column and a Spend or Cost column. A newer export replaces an older one for the days it covers.

When the platforms' APIs are connected later (Meta Marketing API, Google Ads API), their data goes into the same `raws` records, so verification, campaign performance and insights keep working unchanged.

## Campaign, audience and creative performance

From the platform exports, each project shows performance by **campaign**, **ad set / audience** and **creative**: spend, impressions, clicks, CTR, CPC, platform leads, CPL and share of leads. Creatives whose names match uploaded creative files link to the file.

## Report structure

Project page and client report run in this order:
1. **Month on month** (primary view): Spend, Impressions, Clicks, Leads, CPL, QL, QL %, CPQL, SV, CPSV and QL→SV % for the last six months, with the change against the previous month (green better, red worse). The summary dashboard shows the same for all projects in view.
2. **Platform-wise budget and spend**: donut charts of the planned budget and actual spend by platform, with a table.
3. **Monthly target vs achieved**, then **platform-wise target vs achieved** and **platform-wise performance** (channels are grouped into platforms using Project details → Channel → ad platform).
4. **Channel-wise target vs achieved**.
5. **Campaigns**: Meta by Primary / Secondary / Other location, with WP and WOP inside each; Google and other campaigns listed separately. Ad set locations are guessed from names (Secondary_…, Primary_…, KDMC → Other) until the team sets them with "Set ad set locations".
6. **Ad sets** and **creatives** split into WP and WOP, ranked best to worst by the chosen metric (CPQL, QL %, CPL, site visits or spend). Creatives show thumbnails: upload creative images with the same names, or they come from the review deck (Ten X).
7. **Keywords** in Brand / Generic / Other buckets with totals per bucket. Brand terms are set per project in Project details.
8. Lead quality, observations, way forward, and budget.

All performance tables use the same metric order: Spend → Impressions → Clicks → Leads → CPL → QL → QL % → CPQL → SV → CPSV → QL→SV %.

## Client and internal views

The report has a **Client view** (default) and an **Internal view**. Project details → "Hide budget received, blocked amounts and remaining budget in client reports" removes the budget section from the client view, client links, PowerPoint and Excel for that client. The internal view always shows the budget and the data-check notes. Client links always use the client view.

## Observations and way forward (editable)

Each project has an **Observations & way forward** panel for the review period (the selected dates, or the latest month).
- The dashboard writes both lists automatically from the data: plan achievement, QR % and QL→SV % against target, best channel / ad set / creative / keyword by qualification rate, month-on-month change, lost reasons, open leads and untracked site visits; and for way forward, concrete steps such as scaling the best-qualifying channel, pausing spend with no qualified leads, creative variants, keyword bids, lead-form changes for invalid enquiries, working open leads and fixing UTM tracking.
- **Edit review** lets the project team (owner, AM, Lead) reword, reorder, remove and add points, and add any new suggestion with one click. The saved review is what the client report, PowerPoint, Excel and message use.

## Lead quality (CRM)

Upload → **CRM lead dump** (one row per lead with a status column; campaign/source and reason-for-lost columns are used when present). The project shows lead status by campaign, reasons for lost leads by channel, site-visit sources (untracked ones highlighted) and the current status of earlier qualified leads. These feed the observations and way forward.

## Insights and client reports

- **Insights** are written automatically per project for the selected period: spend and funnel summary, lead pacing against plan, best and worst channel, channels with spend but no leads, lead-quality and site-visit conversion problems, CPL trend against the previous report, targets from Project details, budget runway, best audience and creative, and ad sets spending without leads. Verification problems are marked *Internal* and never appear in client reports.
- **Analyst comments** can be added by the project team and are printed in the client report.
- **Client report** (button on each project): pick a period, choose sections (takeaways, campaign/audience/creative, budget), then
  - **Download PowerPoint** — an editable deck built on the server (target vs achieved, channel-wise, month on month, campaign / ad set / creative / keyword, lead status, lost reasons, SV source, observations, way forward, budget). Needs `pip install python-pptx` on the server.
  - **Download PDF** (browser's Save as PDF, A4 landscape print layout),
  - **Download Excel** (summary, channels, campaigns, ad sets, creatives),
  - **Create client link** — a read-only snapshot at `/r/<random id>`, no login needed, not indexed by search engines,
  - **Email** / **WhatsApp** — opens a prefilled message with the headline numbers, top takeaways and the client link, addressed to the client contact from Project details.

Sending email automatically with the PDF attached, or WhatsApp messages without opening WhatsApp, needs an email service (SMTP) or the WhatsApp Business API on the server; the message text and link format are ready for that.

## Project details

When a project is added, its details form opens straight away; anyone on the project team can update it later. Fields: project type, locality / micro-market, RERA number, price range, possession, launch date, website, site address, configurations (type, carpet area, price, units), USPs, amenities, target audience, client contact (name, email, WhatsApp), targets (monthly budget, CPL, CPQL, CPSV) and notes. Targets feed the insights; the client contact prefills email and WhatsApp.

## Ten X District 9 (Raymond Realty)

Loaded from the team's September review deck and the PPT Format 2026-27 working file, assigned to Manik Jayee (Sr Exec) under Aman Mishra (AM) and Thomas Joseph (Team Lead):
April–September 2026 monthly targets and achievement by channel (every month reconciles to the sheet's own totals), Meta ad sets and Google campaigns with status, QL and SV, creatives, keywords, CRM lead status by ad set / campaign, lost reasons by channel, SV source, the budget ledger (₹74,71,826.10 media budget, transfers and blocked amounts), and the team's September observations and way forward.
Notes: channel names are standardised across months (e.g. "Facbook Payu" → Payu, "Facebook LG OTP" → OTP); "CRM adjustments" holds site visits from earlier leads and each quarter's bookings, as in the deck; branding spend (May) and October month-to-date are not loaded, so the remaining budget shown is as of 30 September.

## Repository

Four sections:
- **Daily Reports** — daily Excel reports and daily presentations.
- **Weekly / Monthly Reports** — weekly and monthly Excel reports, media plans, and report presentations (PPT / PDF).
- **Creatives** — images, videos, PDFs and ZIPs, shown as a gallery. Images, PDFs and videos open in the browser; PowerPoint and ZIP files download.
- **Platform exports** — raw Meta / Google Ads / other exports used for verification and campaign performance.

Brand and project filters are available to everyone, limited to the projects they can access.

Uploads are limited to 500 MB per file by default (`MAX_UPLOAD_MB=1000 node server.js` to change). Upload is not shown to L1; L1 and Leads view everything their teams upload.

## Rules the dashboard applies

- **Budget split:** Budget received − blocked amounts (TDS, GST, microsite, domain and other segments, each with a reason) = total budget for media spends. Remaining budget = media budget − media spends from uploaded reports. A blocked amount can be entered in ₹ or as a % of budget received (e.g. `1%`). Plans show allocation; "Not yet planned" = media budget − planned.
- **Overlapping reports:** if two reports cover the same days, the newer upload wins. A monthly report replaces weekly and daily reports for the same days; a weekly replaces daily. Replaced files stay in the repository, marked "Superseded".
- **Plans:** one plan per project per month. Uploading again for the same month replaces it.
- **Report freshness:** each project has a cadence (daily, weekly, monthly). Up to date ≤ cadence + 1 day since the last report's end date; Update due ≤ 2× cadence + 1; Overdue after that.
- **Costs** (CPL, CPQL, CPSV, CPB, CPC) are recalculated from spend and counts, never read from the file.

## Sign-in (self-hosted version)

Each person signs in with a username and password; their role decides what the **server** sends them, so nobody can see another team's projects even by looking at the network traffic.

- **First start:** start the server (`node server.js`) and open the dashboard once in a browser straight away. It loads the data and creates an account for every team member. The usernames and **temporary passwords** are written to `data/initial-passwords.txt` (also mentioned in the server log). Hand them out, then delete the file.
- **Usernames** are the name in lower case with dots: `viresh`, `thomas.joseph`, `manik.jayee`.
- **First sign-in:** everyone must replace the temporary password with their own (at least 8 characters).
- **Forgotten passwords:** Team & access → Sign-in accounts. L1 can reset anyone; Team Leads and AMs can reset people in their own team. The new temporary password is shown once, and the person is signed out everywhere else.
- **New team members** added in Team & access get an account automatically; reset their password there to get their first temporary password.
- **What the server enforces:** sign-in for all data and files; each person only receives their projects (L1 and Team Leads: all; AMs: their team's; executives: their assigned projects); saves can only change records of projects the person can see; only L1 can change the team list; files of other projects are refused. Five wrong passwords lock that username for 15 minutes from that address. Sessions last 7 days (`SESSION_DAYS`).
- **Use HTTPS** in front of the server (for example nginx or Caddy with a certificate) and set `COOKIE_SECURE=1`.
- `AUTH=off node server.js` turns sign-in off for a private demo on your own computer.
- The Vercel / review-link version has no server, so it keeps the **demo picker** ("Viewing as · demo, no passwords"); use Vercel's Deployment Protection there.

## Team (prototype logins)

From the team sheet: **L1** Viresh. **Team Leads** Iliyas Shaikh, Neha Singh, Thomas Joseph. **Account Managers** Chaitanya Sharma and Ashutosh Chauhan (Iliyas); Allwyn Coutinho and Kamal Jagate (Neha Singh); Aman Mishra and Dimple Yadav (Thomas). **Sr Executives / Executives**: Shubham Chaurasia (Chaitanya); Dipen Patel (Ashutosh); Shruti Zaware (Allwyn); Sourav Singh, Anjali Parmar (Kamal); Manik Jayee, Wajahat Ali, Raj Roy (Aman); Aijaz Shaikh, Khushi Balmiki, Arya Mondel (Dimple). The roster is the `ROSTER` list in `public/index.html`; saved data from earlier versions is moved onto it automatically on first load (members added through Team & access are kept).

## Access by role

| Role | Sees | Can do |
|---|---|---|
| L1 · Board | All projects, read only: month on month, funds under management, utilisation, projects at risk, open board comments, drill-down, every file; reports open in the internal view | Add projects and team members, assign project owners, post and resolve board comments, download or share reports, manage data. Cannot upload, edit budgets, project details, reviews or ad set locations (blocked in the page; enforce on the server before go-live) |
| Team Leader | All projects and their reports (other teams' projects are view only) | Reallocate within their team, add projects, record money |
| Account Manager | Only the projects they manage: their own and their executives' | Reallocate within their team, add projects, record money |
| Sr / Jr Executive | Only projects assigned to them | Upload Excel data, plans, platform exports, presentations and creatives; edit project details and analyst comments; create client reports — for those projects |

## Board view (L1)

- **Read only.** The board sees everything but changes nothing on a project. Data checks, verification chips and upload times are hidden behind **Show data checks and upload details**.
- **Projects at risk** flags a project when the media budget is over or has under 10% left, CPQL in the latest month is more than 20% above target (target CPQL from Project details, else the month's plan), there are no QL against a QL target, or QL is down 20% or more on the previous month. A month that is only partly reported is compared at the same pace.
- **Board comments** (`boardNotes` in the data) are posted by the board on a project. The project team sees them on their dashboard and the project page and replies; only the board marks them resolved. They never appear in client reports, PowerPoint, Excel or client links.

## Upload in one step

Upload → choose or drop any files (several at once) → **Save**. Each file's type is detected (performance data, media plan, Meta / Google export, CRM lead dump, presentation, creative), the project is matched from the file name or title (falling back to the project you came from or your first project), and the period comes from the title row, the dates in an export or the file name (last month if none is found, flagged for a check). Every detected value can be changed on the file's card before saving; files that could not be read are shown and skipped.

## Clicks per task

| Task | Clicks |
|---|---|
| Upload weekly data and platform exports | 3 (Upload → choose files → Save) |
| Open any project | 1 (Project filter or Recent) |
| Client report → download / WhatsApp | 3 |
| Board comment on a project | 3 |
| Reply to a board comment | 2 |
| Add budget received | 3 |
| Edit and save observations / way forward | 4 |
| See what needs attention and open it | 2 |
| View / download any uploaded file | 2 / 3 |

## Repository: view and download

Every row has **View** and **Download** under the file name. Excel / CSV uploads (performance data, media plans, platform exports, CRM data) open as a table of the data that was read from the file, with any automatic-check notes; creatives, videos and PDFs open in the viewer. **Download** gives the original file as uploaded (kept in `data/files/` on your server). If an original is missing (e.g. data loaded before files were kept), the download is rebuilt from the stored data as .xlsx (or .csv for CSV uploads). For full Excel rebuilds offline, host SheetJS yourself (see "Before company-wide use").

## Page layout

- **Dashboard tabs:** Summary (summary tiles, month on month, platform split, target vs achieved), Breakdown (by location / brand / project, top spending brands), Creatives (statics and videos), and Needs attention (data checks and overdue reports; for the board, comments and projects at risk). The last tab shows a count.
- **Project tabs:** Project details (opens first: project at a glance with exact address and map link, RERA, inventory, land area, towers, floors, units, price range, configurations with carpet area, price and ₹ per sq ft; micro-market; competition; discovery markets; other details and sources), Summary, Performance, Observations & way forward, Lead quality (when CRM data is uploaded), Budget, and Files (grouped as reports and plans, presentations, platform and CRM data, creatives, each with View and Download).
- Summary tiles come before month on month everywhere, including the report. The Full funnel panel is removed; Target vs achieved covers leads, QL, site visits and bookings.

## Creative studio (heatmap, AI reading, new version)

It has its own **Creative studio** tab: choose a project, see every image creative with its attention scores (overall, focus, clutter) next to spend, leads, QL and CPQL, sort by spend, score or cost, and pick one to open its heatmap, AI reading, suggestions and new version on the same page. The **Heatmap** links in the Repository, a project's Files tab and the creative tables open the same tab.

- **Predicted attention heatmap.** Computed in the browser with a visual saliency model (multi-scale contrast on brightness and colour, edge and text density, centre bias). It estimates where eyes go in the first seconds; it is not eye-tracking. Views: Original, Heatmap, Focus view (dims what is unlikely to be seen), with the likely viewing order numbered. Feed screenshots are cropped to the ad automatically.
- **Scores:** Overall, Focus (attention concentrated on a few areas), Clutter (lower is better), Contrast.
- **AI reading (Read with AI).** Claude finds the headline, price, offer, call to action, logo, project name, people and buildings, so the studio can show each element's share of attention, name what is seen first, and add its own suggestions and new copy. Saved with the creative for the whole team. In the review link it runs on the viewer's own Claude (they are asked to allow it once). On your server it needs `ANTHROPIC_API_KEY` (and optionally `ANTHROPIC_MODEL`, default `claude-sonnet-5-5`) in the environment; without a key the heatmap, scores and rule-based suggestions still work.
- **Suggestions** combine the heatmap, the AI reading and the creative's results (its CPQL or CPL against the project average).
- **New version.** Builds a fresh creative from the hero visual (people / building / interior, with the old baked-in text cut away), the AI copy or the project details (price from the configurations, RERA number, connectivity): three layouts (image on top, full image with a dark fade, price first) and three sizes (1080×1080, 1080×1350, 1080×1920). Text is editable; a different hero image can be chosen. The new version is scored with the same heatmap and compared with the original (overall, focus, clutter, contrast, attention on price, headline and call to action). **Download PNG**, or **Save to project creatives** (project team only). The Ten X previews are about 190 px wide, so for a sharp output upload the full-size creative with the same name or choose a different image.

## Quick filters

The dashboard and every project page start with a filter bar: **Location**, **Brand** and **Project** (each list narrows the next; on a project page the Project list shows every project you can see, so you can switch in one step), **Clear filters**, and **Recent** — the last projects you opened, remembered per login in that browser. Lists only ever contain projects the person is allowed to see.

## Creative analysis (statics and videos)

- **Where:** board dashboard (all visible projects, top 5 statics and top 5 videos across projects with the project name), every project page, and the report and PowerPoint ("Creatives · statics and videos").
- **Format** is read from the creative name: Static / image / banner / 1080x1080 → Static; Video / reel / 15s / walkthrough → Video; Carousel; RSA / search ad → Text. If the name says nothing, a creative file uploaded with the same name decides it (image or video). Ask the team to keep "Static" or "Video" in ad names.
- **Message theme** is read from the name too: festive / offer, price and payment plan, connectivity and location, amenities and lifestyle, family, site walkthrough, configuration, testimonial, brand.
- **Inferences and suggestions** compare formats and themes on CPQL (CPL where QL isn't in the export), name the best static and video (at least 10 leads and 3 QL), flag creatives that spent without a qualified lead, and suggest budget shifts, new variants and briefs. Project-level points also feed the automatic observations and way forward; a review the team has already saved is kept, and Edit review offers the new points.

## Before company-wide use

This is a prototype for review. Plan these items before all 40+ people use it daily:

1. **Sign-in is built in** (see "Sign-in"). Optional later: company Google or Microsoft single sign-on, and finer edit rules on the server (today the server limits saves to the projects a person can see; within those, finer rules such as "the board is read-only" are applied by the page).
2. **HTTPS** in front of the server, with `COOKIE_SECURE=1`.
3. **A database.** Platform exports with daily rows make the data file grow quickly (the example data is about 1 MB). Move from one `state.json` file to PostgreSQL or MySQL with tables for users, projects, money entries, plans, plan rows, reports, report rows, files and audit log. The JSON export maps one-to-one to these tables.
4. **Per-change API.** Replace "save everything" with endpoints per action (`POST /reports`, `POST /money`, `PATCH /projects/:id/owner`) so simultaneous edits never collide.
5. **Host the spreadsheet library.** The page loads SheetJS from cdnjs. For offline or locked-down servers, download `xlsx.full.min.js` into `public/` and point the `<script>` tag at it.
6. **Daily, weekly, monthly reminders** (optional): an email or WhatsApp nudge to owners whose reports are due.
7. **Client link expiry** (optional): links in `data/shares/` never expire; delete a file there to revoke a link, or add an expiry date.

## Data format (for developers)

```json
{
  "users":    [{ "id", "name", "role": "L1|LEAD|AM|SR|JR", "reportsTo" }],
  "projects": [{ "id", "location", "brand", "name", "startDate", "ownerId", "cadence": "daily|weekly|monthly" }],
  "money":    [{ "id", "projectId", "date", "amount", "note", "by" }],
  "blocks":   [{ "id", "projectId", "segment", "note", "amount", "date", "by" }],
  "plans":    [{ "id", "projectId", "month": "YYYY-MM", "rows": [Row], "file", "url", "uploadedBy", "at" }],
  "reports":  [{ "id", "projectId", "type", "from", "to", "rows": [Row], "file", "url", "uploadedBy", "at" }],
  "docs":     [{ "id", "projectId", "category": "deck|creative", "type", "from", "to", "title", "channel", "file", "size", "mime", "url", "uploadedBy", "at" }],
  "raws":     [{ "id", "projectId", "platform", "from", "to", "rows": [RawRow], "file", "url", "uploadedBy", "at" }],
  "profiles": { "<projectId>": { "type", "locality", "rera", "priceRange", "possession", "launch", "website", "address", "configs": [{ "type", "area", "price", "units" }], "usps", "amenities", "audience", "contacts": { "name", "email", "phone" }, "targets": { "budget", "cpl", "cpql", "cpsv" }, "notes", "updatedBy", "updatedAt" } },
  "notes":    { "<projectId>": { "text", "by", "at" } },
  "shares":   [{ "id", "projectId", "url", "period", "by", "at" }],
  "crm":      [{ "id", "projectId", "from", "to", "label", "status": { "<source>": { "<status>": n } }, "lost": { "<reason>": { "<channel>": n } }, "svSource": { "<source>": n }, "prevQl"?, "file", "uploadedBy", "at" }],
  "reviews":  { "<projectId>|<from>|<to>": { "obs": [{ "text", "src": "team|auto" }], "wf": [...], "by", "at" } },
  "audit":    [{ "at", "by", "text", "projectId" }]
}
Row = { "channel", "spend", "impr", "clicks", "leads", "ql", "sv", "bookings" }   (reports may also carry "warnings": [text])
RawRow = { "date", "dateEnd"?, "campaign", "adset", "ad", "spend", "impr", "clicks", "leads", "ql"?, "sv"?, "status"? }   (raw files carry "level": "full" | "creative" | "keyword"; plans may carry "totals": { "ql", "sv", "bookings" })
```
