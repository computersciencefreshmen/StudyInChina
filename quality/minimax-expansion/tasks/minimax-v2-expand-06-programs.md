# MiniMax v2 expand task: minimax-v2-expand-06-programs

## Locked parameters

- TASK_ID: minimax-v2-expand-06-programs
- TASK_KIND: programs (expand)
- CHECKED_AT: 2026-07-27
- SCHOOL_LIMIT: 1

## School

杭州师范大学 (Hangzhou Normal University)
- institutionRef: uni-hangzhou-normal-university
- Official domain (assumed): hznu.edu.cn

## Output

- quality/minimax-expansion/inbox/minimax-v2-expand-06-programs.json
- quality/minimax-expansion/inbox/minimax-v2-expand-06-programs.md

After completion:

```bash
npx tsx scripts/ingestion/validate-minimax-expansion.ts --task minimax-v2-expand-06-programs
```

## Boundary

- Must not modify content/data, migrations, frontend, Workers, GitHub Actions.
- Must not commit/push (handled by main agent).
- No template evidence; only fields that were actually read from a live official page may carry `status: known`.
- Search snippets may only be used to discover URLs, not as evidence.
- Homepages are not accepted as program detail URLs.
- If a field cannot be sourced from the official page, it is `source_unavailable` and the URL attempt is recorded in `sourceFailures.discoveryAttempts`.
