# MiniMax v2 扩校任务：minimax-v2-repair-02-programs

## 锁定参数

- `TASK_ID`: `minimax-v2-repair-02-programs`
- `TASK_KIND`: `programs`（repair 任务）
- `CHECKED_AT`: `2026-07-27`
- `SCHOOL_LIMIT`: `1`

## 学校范围

上海财经大学（Shanghai University of Finance and Economics, SUFE）
- `institutionRef`: `uni-shanghai-university-of-finance-and-economics`
- 国际学生招生首页：https://intlstu.sufe.edu.cn/

## 任务类型：repair

仓库已记录 2 个本科项目（International Economics and Trade、Finance），均带 `durationMonths=48`、`tuitionCny=15000`、`applicationFeeCny=830`。当前周期 `closesOn=null`，按 v2 §七 规则标记 `officially_not_announced`，并把 `publicationEligibility` 设为 `not_announced`。

## 输出

- `quality/minimax-expansion/inbox/minimax-v2-repair-02-programs.json`
- `quality/minimax-expansion/inbox/minimax-v2-repair-02-programs.md`

完成后执行：

```bash
npx tsx scripts/ingestion/validate-minimax-expansion.ts --task minimax-v2-repair-02-programs
```

## 边界

- 不得修改 `content/data`、数据库迁移、前端、Worker、GitHub Actions
- 不得 commit/push（由主 Agent 统一执行）
- 不得使用第三方聚合站、模型常识、搜索摘要作为 evidence
- 不得使用 `homepage`、`search snippet` 等禁用字符串

## 验证最低门槛（v2 strict）

- 100% specificOfficialUrlRate / intlEligibility / individualApplication
- ≥0.6 durationCoverage
- ≥0.5 tuitionCoverage
- ≥0.4 futureDeadlineCoverage（含 `officially_not_announced`）
- 0 searchSnippetEvidence / homepageEvidence