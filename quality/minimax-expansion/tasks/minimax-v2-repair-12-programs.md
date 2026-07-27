# MiniMax v2 repair task: minimax-v2-repair-12-programs

## Locked parameters

- TASK_ID: minimax-v2-repair-12-programs
- TASK_KIND: programs (repair)
- CHECKED_AT: 2026-07-27
- SCHOOL_LIMIT: 1

## School

南京大学 (Nanjing University)
- institutionRef: uni-nanjing-university
- Admissions home: https://hwxy.nju.edu.cn/English/

## Output

- quality/minimax-expansion/inbox/minimax-v2-repair-12-programs.json
- quality/minimax-expansion/inbox/minimax-v2-repair-12-programs.md

After completion:

```bash
npx tsx scripts/ingestion/validate-minimax-expansion.ts --task minimax-v2-repair-12-programs
```

## Boundary

- Must not modify content/data, migrations, frontend, Workers, GitHub Actions.
- Must not commit/push (handled by main agent).
- Must not use third-party aggregators, model knowledge, or search snippets as evidence.
- Must not include "homepage" or "search snippet" strings.
