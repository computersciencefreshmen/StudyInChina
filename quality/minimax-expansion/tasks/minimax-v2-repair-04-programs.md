# MiniMax v2 扩校任务：minimax-v2-repair-04-programs

## 锁定参数

- `TASK_ID`: `minimax-v2-repair-04-programs`
- `TASK_KIND`: `programs`（repair 任务）
- `CHECKED_AT`: `2026-07-27`
- `SCHOOL_LIMIT`: `1`

## 学校范围

上海交通大学（Shanghai Jiao Tong University, SJTU）
- `institutionRef`: `uni-shanghai-jiao-tong-university`
- 国际学生招生首页：https://isc.sjtu.edu.cn/

## 任务类型：repair

仓库已记录 3 个项目：

1. Chinese Language Program（语言），`durationMonths=4`，3 个 cycle（2026-06-30 截止 / 2026-12-15 截止 / null）。
2. Long-term Chinese Language Course（语言，无事实）。
3. Civil Engineering (Smart and Sustainable Constructions)（本科，无事实）。

按 v2 §六：只把 Chinese Language Program 列为 publishable；其他 2 个保留为 quarantined（含具体 quarantine reasons）。

## 输出

- `quality/minimax-expansion/inbox/minimax-v2-repair-04-programs.json`
- `quality/minimax-expansion/inbox/minimax-v2-repair-04-programs.md`

完成后执行：

```bash
npx tsx scripts/ingestion/validate-minimax-expansion.ts --task minimax-v2-repair-04-programs
```

## 边界

- 不得修改 `content/data`、数据库迁移、前端、Worker、GitHub Actions
- 不得 commit/push（由主 Agent 统一执行）
- 不得使用第三方聚合站、模型常识、搜索摘要作为 evidence
- 不得使用 `homepage`、`search snippet` 等禁用字符串

## 验证最低门槛（v2 strict）

- 100% specificOfficialUrlRate / intlEligibility / individualApplication（publishable 内）
- ≥0.6 durationCoverage
- ≥0.5 tuitionCoverage
- ≥0.4 futureDeadlineCoverage（含 officially_not_announced / future / open cycle）
- 0 searchSnippetEvidence / homepageEvidence
- quarantinedPrograms 允许 > 0，但必须每个 program 有具体 `qualityReasons`