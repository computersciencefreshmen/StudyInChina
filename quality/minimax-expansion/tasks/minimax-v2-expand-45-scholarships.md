# MiniMax v2 expand-scholarship task: minimax-v2-expand-45-scholarships

## Locked parameters

- TASK_ID: minimax-v2-expand-45-scholarships
- TASK_KIND: scholarships (expand)
- CHECKED_AT: 2026-07-27
- SCHOOL_LIMIT: 1

## School

上海大学 (Shanghai University)
- institutionRef: uni-shanghai-university
- Official domain (assumed): shanghaiuniversity.edu.cn

## Output

- quality/minimax-expansion/inbox/minimax-v2-expand-45-scholarships.json
- quality/minimax-expansion/inbox/minimax-v2-expand-45-scholarships.md

After completion:

```bash
npx tsx scripts/ingestion/validate-minimax-expansion.ts --task minimax-v2-expand-45-scholarships
```

## Boundary

- Must not modify content/data, migrations, frontend, Workers, GitHub Actions.
- Must not commit/push (handled by main agent).
- No template scholarship entries fabricated.
- If a school has no verifiable official scholarship page, document the discovery attempts and mark `source_unavailable`.
