# Realty Funnel Desk

Performance dashboard and repository for the agency's real-estate projects.

- **Repository root** — the dashboard as a static site for **Vercel** (browser mode: each
  person's data stays in their own browser; no passwords, a demo picker instead). Import this repository in Vercel with the
  framework preset "Other", no build command, output directory `.`.
  Turn on Settings → Deployment Protection before sharing: the page includes client data.
- **`self-host/`** — the full version for your own server (`node server.js`): one shared
  dataset for the whole team, original files, PowerPoint export, client report links and the
  server AI reading, and **sign-in per person with role-based access** (usernames and passwords; the server only sends each person their projects). See `self-host/README.md` → Sign-in. Vercel ignores this folder (`.vercelignore`).

## Live team trial

Use the **server version** for the trial (sign-in and one shared dataset). Quickest online: Render → New → Blueprint → this repository (uses `render.yaml`: the `self-host/` folder, a persistent disk and a generated `SETUP_KEY`). Or build `self-host/Dockerfile` on any container host with a persistent volume at `/data`. Then follow `self-host/README.md` → "Running the team trial".
