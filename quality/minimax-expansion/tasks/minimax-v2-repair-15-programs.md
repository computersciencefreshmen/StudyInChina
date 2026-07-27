# MiniMax v2 repair task: minimax-v2-repair-15-programs

## Locked parameters

- TASK_ID: minimax-v2-repair-15-programs
- TASK_KIND: programs (repair)
- CHECKED_AT: 2026-07-27
- SCHOOL_LIMIT: 1

## School

西安电子科技大学 (Xidian University)
- institutionRef: uni-xidian-university
- Admissions home: https://sie.xidian.edu.cn/

## Output

- quality/minimax-expansion/inbox/minimax-v2-repair-15-programs.json
- quality/minimax-expansion/inbox/minimax-v2-repair-15-programs.md

After completion:

```bash
npx tsx scripts/ingestion/validate-minimax-expansion.ts --task minimax-v2-repair-15-programs
```

## Boundary

- Must not modify content/data, migrations, frontend, Workers, GitHub Actions.
- Must not commit/push (handled by main agent).
- Must not use third-party aggregators, model knowledge, or search snippets as evidence.
- Must not include "homepage" or "search snippet" strings.
