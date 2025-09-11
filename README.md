Study in China Guide

Overview
- Next.js site providing a triage guide for studying in China focused on humanities majors (Translation / Interpreting / International Relations).
- Includes a curated university list across regions (华北/东北/华东/华中) with HSK and transition (preparatory/语言) notes.
- All cards include working external links: "View Details" to school info, "Apply Now" to the online application portal.

Local Development
- Install: `npm install`
- Run dev: `npm run dev`
- Build: `npm run build` then `npm start`

Deploy to Vercel
1) Push this repo to GitHub (e.g., create a new repo and `git remote add origin <your-repo>` then `git push -u origin main`).
2) In Vercel, import the GitHub repo. Framework preset: Next.js. Root = repository root. Build command = default.
3) Set `NODE_VERSION` (18+) if needed.

Data Updates
- Edit `data/universities.ts` to add more schools or adjust URLs and HSK/bridge notes.
- Each entry requires: `name`, `region`, `programs`, `hskNote`, optional `bridgeNote`, `viewUrl`, `applyUrl`.

Notes on HSK/Bridge
- For Chinese-taught Translation/IR, common entry is HSK4–5. If at HSK3–4, use the pre-sessional/foundation (预科/语言进修) route first, then progress to degree.
- Always verify current requirements on official pages; policies may change each intake.

