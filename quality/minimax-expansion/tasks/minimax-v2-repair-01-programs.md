# MiniMax v2 扩校任务：minimax-v2-repair-01-programs

先完整读取：
- `MINIMAX_DATA_COLLECTION_PROMPT.md`（仓库根）
- `MINIMAX_EXPAND_SCHOOLS_AND_PROGRAMS_PROMPT.md`（仓库根）
- `MINIMAX_CONTINUOUS_HARVEST_PROMPT.md`（仓库根）

## 锁定参数

- `TASK_ID`: `minimax-v2-repair-01-programs`
- `TASK_KIND`: `programs`（repair 任务）
- `CHECKED_AT`: `2026-07-27`
- `SCHOOL_LIMIT`: `1`
- `PROGRAM_LIMIT_PER_SCHOOL`: `5`

## 学校范围

华东师范大学（East China Normal University, ECNU）
- `institutionRef`: `uni-east-china-normal-university`
- 城市：上海 / 省份：上海
- 官方招生首页：https://lxs.ecnu.edu.cn/en/

## 任务类型：repair

本任务为 v2 第二阶段 repair 任务。仓库的 `content/data/programs.json` 已经为该校记录了 4 个非学历汉语项目（Intensive、Standard、Business Chinese Language Program），每个都有 `durationMonths`、`closesOn`、`tuitionCny`、`applicationFeeCny` 完整事实。

必须把以下事实按 v2 JSON 合同重新生成到 `inbox/`：
- 4 个项目的 `nameOriginal` + `name`（zh / en / ru），其中 ru 通过 `generatedTranslations` 标记；
- 每个项目的 `internationalEligibility.status: known` + value: true + evidence；
- 每个项目的 `individualApplication.status: known` + value: true + evidence；
- 每个项目的 `durationMonths.status: known` + value + evidence；
- 每个 cycle 的 `tuitionCny.status: known` + value + evidence；
- 每个 cycle 的 `applicationFeeCny.status: known` + value + evidence；
- 每个 cycle 的 `closesOn.status: known` + value + evidence；
- `programUrl` 必须不是学校首页（实际为各项目的官方英文子页面）；
- `programUrl` 不允许出现 `homepage`、`search snippet` 等禁用文本；
- 每个 cycle 的 `opensOn` 可以是 `officially_not_announced`（官网未公布）；
- 每条 evidence 的 `quote` ≤ 350 字、含具体定位（HTML 章节或表格行）；
- 每个 cycle 必须有 `academicYear: "2026-2027"`、`intake: "autumn"`、`publicationEligibility: "open"`（2026-07-31 截止，未来 4 天）；
- `reconciliation` 必须包含 ECNU 一行，11 个类别齐全。

## 输出

- `quality/minimax-expansion/inbox/minimax-v2-repair-01-programs.json`
- `quality/minimax-expansion/inbox/minimax-v2-repair-01-programs.md`

完成后执行：

```bash
npx tsx scripts/ingestion/validate-minimax-expansion.ts --task minimax-v2-repair-01-programs
```

验证失败必须修复，不得声称完成。

## 边界

- 不得修改 `content/data`、数据库迁移、前端、Worker、GitHub Actions
- 不得 commit/push（由主 Agent 统一执行）
- 不得使用第三方聚合站、模型常识、搜索摘要作为 evidence
- 不得使用 `homepage`、`search snippet` 等禁用字符串

## 验证最低门槛（v2 strict）

- `specificOfficialUrlRate = 1.0`
- `internationalEligibilityEvidenceRate = 1.0`
- `individualApplicationEvidenceRate = 1.0`
- `durationCoverageRate ≥ 0.6`
- `tuitionCoverageRate ≥ 0.5`
- `futureDeadlineCoverageRate ≥ 0.4`
- `searchSnippetEvidenceCount = 0`
- `homepageEvidenceCount = 0`