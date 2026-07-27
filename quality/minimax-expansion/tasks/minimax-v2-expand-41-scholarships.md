# MiniMax v2 expand-scholarship task: minimax-v2-expand-41-scholarships

## Locked parameters

- TASK_ID: minimax-v2-expand-41-scholarships
- TASK_KIND: scholarships (expand)
- CHECKED_AT: 2026-07-27
- SCHOOL_LIMIT: 1

## School

中南财经政法大学 (Zhongnan University of Economics and Law)
- institutionRef: uni-zhongnan-university-of-economics-and-law
- Official domain (assumed): zhongnanuniversityofeconomicsandlaw.edu.cn

## Output

- quality/minimax-expansion/inbox/minimax-v2-expand-41-scholarships.json
- quality/minimax-expansion/inbox/minimax-v2-expand-41-scholarships.md

After completion:

```bash
npx tsx scripts/ingestion/validate-minimax-expansion.ts --task minimax-v2-expand-41-scholarships
```

## Boundary

- Must not modify content/data, migrations, frontend, Workers, GitHub Actions.
- Must not commit/push (handled by main agent).
- No template scholarship entries fabricated.
- If a school has no verifiable official scholarship page, document the discovery attempts and mark `source_unavailable`.
