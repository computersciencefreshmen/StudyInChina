# StudyInChina

A multilingual Next.js guide that helps international students compare Chinese universities, language requirements, scholarship routes, and application links.

## What It Does

StudyInChina is a small product prototype for students who want to study humanities-related programs in China, especially translation, interpreting, international relations, and related majors. It turns scattered university information into a browsable decision guide.

The app focuses on practical questions:

- Which universities should I consider by region?
- What HSK level is usually expected?
- Is a preparatory or language-bridge route useful before degree study?
- Where can I view official details and start the application?

## Features

- University cards with region, program, HSK, bridge-route, detail, and application information.
- Multi-language interface support for English, Chinese, and Russian.
- Search and filtering by region, program type, and keyword.
- Favorite list for shortlisting universities.
- PDF export for selected schools or filtered results.
- Separate pages for university search, programs, scholarships, and application guidance.

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 |
| Language | TypeScript |
| UI | React, Tailwind CSS, Heroicons |
| Export | jsPDF, html2canvas |
| Deployment | Vercel-ready |

## Project Structure

```text
StudyInChina/
├── components/          # Navigation, footer, university card
├── data/                # Curated university dataset
├── lib/                 # Language context and shared utilities
├── pages/               # Next.js pages
├── styles.css           # Global styling
└── package.json
```

## Local Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Build

```bash
npm run build
npm start
```

## Updating the Dataset

Most content is stored in `data/universities.ts`. Each school entry should include:

- `name`
- `region`
- `programs`
- `hskNote`
- optional `bridgeNote`
- `viewUrl`
- `applyUrl`

Always verify admission rules from official university pages because HSK, scholarship, and intake requirements can change.

## Portfolio Value

This project demonstrates data-driven UI design, multilingual product thinking, student-facing information architecture, and a deployable Next.js workflow.

