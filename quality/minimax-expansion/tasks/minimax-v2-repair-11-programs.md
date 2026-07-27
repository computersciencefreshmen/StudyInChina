# MiniMax v2 repair task: minimax-v2-repair-11-programs

## Locked parameters

- TASK_ID: minimax-v2-repair-11-programs
- TASK_KIND: programs (repair)
- CHECKED_AT: 2026-07-27
- SCHOOL_LIMIT: 1

## School

浙江大学 (Zhejiang University)
- institutionRef: uni-zhejiang-university
- Admissions home: https://iczu.zju.edu.cn/admissionsen/

## Output

- quality/minimax-expansion/inbox/minimax-v2-repair-11-programs.json
- quality/minimax-expansion/inbox/minimax-v2-repair-11-programs.md

After completion:

```bash
npx tsx scripts/ingestion/validate-minimax-expansion.ts --task minimax-v2-repair-11-programs
```

## Boundary

- Must not modify content/data, migrations, frontend, Workers, GitHub Actions.
- Must not commit/push (handled by main agent).
- Must not use third-party aggregators, model knowledge, or search snippets as evidence.
- Must not include "homepage" or "search snippet" strings.
