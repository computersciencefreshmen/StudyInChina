# MiniMax v2 expand-scholarship task: minimax-v2-expand-01-scholarships

## Locked parameters

- TASK_ID: minimax-v2-expand-01-scholarships
- TASK_KIND: scholarships (expand)
- CHECKED_AT: 2026-07-27
- SCHOOL_LIMIT: 1

## School

广东外语外贸大学 (Guangdong University of Foreign Studies)
- institutionRef: uni-guangdong-university-of-foreign-studies
- Official domain (assumed): gdufs.edu.cn

## Output

- quality/minimax-expansion/inbox/minimax-v2-expand-01-scholarships.json
- quality/minimax-expansion/inbox/minimax-v2-expand-01-scholarships.md

After completion:

```bash
npx tsx scripts/ingestion/validate-minimax-expansion.ts --task minimax-v2-expand-01-scholarships
```

## Boundary

- Must not modify content/data, migrations, frontend, Workers, GitHub Actions.
- Must not commit/push (handled by main agent).
- No template scholarship entries fabricated.
- If a school has no verifiable official scholarship page, document the discovery attempts and mark `source_unavailable`.
