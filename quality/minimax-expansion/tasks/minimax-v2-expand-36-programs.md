# MiniMax v2 expand task: minimax-v2-expand-36-programs

## Locked parameters

- TASK_ID: minimax-v2-expand-36-programs
- TASK_KIND: programs (expand)
- CHECKED_AT: 2026-07-27
- SCHOOL_LIMIT: 1

## School

浙江财经大学 (Zhejiang University of Finance and Economics)
- institutionRef: uni-zhejiang-university-of-finance-and-economics
- Official domain (assumed): zufe.edu.cn

## Output

- quality/minimax-expansion/inbox/minimax-v2-expand-36-programs.json
- quality/minimax-expansion/inbox/minimax-v2-expand-36-programs.md

After completion:

```bash
npx tsx scripts/ingestion/validate-minimax-expansion.ts --task minimax-v2-expand-36-programs
```

## Boundary

- Must not modify content/data, migrations, frontend, Workers, GitHub Actions.
- Must not commit/push (handled by main agent).
- No template evidence; only fields that were actually read from a live official page may carry `status: known`.
- Search snippets may only be used to discover URLs, not as evidence.
- Homepages are not accepted as program detail URLs.
- If a field cannot be sourced from the official page, it is `source_unavailable` and the URL attempt is recorded in `sourceFailures.discoveryAttempts`.
