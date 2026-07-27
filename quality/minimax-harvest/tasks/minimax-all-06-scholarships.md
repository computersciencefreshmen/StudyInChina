# MiniMax 持续采集任务：minimax-all-06-scholarships

先完整读取仓库根目录的 `MINIMAX_DATA_COLLECTION_PROMPT.md`，再执行本任务。

## 锁定参数

- `TASK_ID`: `minimax-all-06-scholarships`
- `TASK_KIND`: `scholarships`
- `CHECKED_AT`: 使用实际运行日期
- `SCHOOL_LIMIT`: `8`
- `PROGRAM_LIMIT_PER_SCHOOL`: `5`
- `SCHOLARSHIP_LIMIT_PER_SCHOOL`: `5`

本任务只采集奖学金。每校目标为 1–5 个可由国际学生申请、且官方页面明确适用于该校的奖学金。
必须分别检查校级、院系/项目、CSC 校级路线、省级和市级官方来源。项目数组保持为空。
整个批次不得以 0 条奖学金完成；若某校确实无法找到，必须记录至少 3 次不同官方入口的发现尝试、失败 URL 和失败原因。

## 学校范围

```json
[
  {
    "targetId": "dfc-2022-041",
    "cohort": "double_first_class",
    "officialNameZh": "大连理工大学",
    "officialNameEn": "Dalian University of Technology",
    "institutionRef": "uni-dalian-university-of-technology",
    "catalogInstitutionId": "uni-dalian-university-of-technology",
    "province": null,
    "city": null,
    "focusTags": []
  },
  {
    "targetId": "dfc-2022-042",
    "cohort": "double_first_class",
    "officialNameZh": "东北大学",
    "officialNameEn": "Northeastern University",
    "institutionRef": "uni-northeastern-university-china",
    "catalogInstitutionId": "uni-northeastern-university-china",
    "province": null,
    "city": null,
    "focusTags": []
  },
  {
    "targetId": "dfc-2022-043",
    "cohort": "double_first_class",
    "officialNameZh": "大连海事大学",
    "officialNameEn": "Dalian Maritime University",
    "institutionRef": "uni-dalian-maritime-university",
    "catalogInstitutionId": "uni-dalian-maritime-university",
    "province": null,
    "city": null,
    "focusTags": []
  },
  {
    "targetId": "dfc-2022-044",
    "cohort": "double_first_class",
    "officialNameZh": "吉林大学",
    "officialNameEn": "Jilin University",
    "institutionRef": "uni-jilin-university",
    "catalogInstitutionId": "uni-jilin-university",
    "province": null,
    "city": null,
    "focusTags": []
  },
  {
    "targetId": "dfc-2022-045",
    "cohort": "double_first_class",
    "officialNameZh": "延边大学",
    "officialNameEn": "Yanbian University",
    "institutionRef": "uni-yanbian-university",
    "catalogInstitutionId": "uni-yanbian-university",
    "province": null,
    "city": null,
    "focusTags": []
  },
  {
    "targetId": "dfc-2022-046",
    "cohort": "double_first_class",
    "officialNameZh": "东北师范大学",
    "officialNameEn": null,
    "institutionRef": "dfc-2022-046",
    "catalogInstitutionId": null,
    "province": null,
    "city": null,
    "focusTags": []
  },
  {
    "targetId": "dfc-2022-047",
    "cohort": "double_first_class",
    "officialNameZh": "哈尔滨工业大学",
    "officialNameEn": "Harbin Institute of Technology",
    "institutionRef": "uni-harbin-institute-of-technology",
    "catalogInstitutionId": "uni-harbin-institute-of-technology",
    "province": null,
    "city": null,
    "focusTags": []
  },
  {
    "targetId": "dfc-2022-048",
    "cohort": "double_first_class",
    "officialNameZh": "哈尔滨工程大学",
    "officialNameEn": "Harbin Engineering University",
    "institutionRef": "uni-harbin-engineering-university",
    "catalogInstitutionId": "uni-harbin-engineering-university",
    "province": null,
    "city": null,
    "focusTags": []
  }
]
```

## 强制实时发现

对每所学校至少执行以下步骤：

1. 从学校主站或国际学生招生首页发现当期/下一期招生简章。
2. 检查本科、硕士、博士、语言/非学历目录。
3. 检查费用、申请系统和截止日期页面。
4. 检查学校奖学金栏目以及明确适用于该校的政府奖学金页面。
5. 将新发现的官方入口写入 reconciliation；不得因为仓库已有一条 URL 就停止发现。

不允许用第三方聚合站作为事实来源。403、验证码或失败页面必须失败关闭。

奖学金任务中无法确认奖学金的学校，必须使用：

```json
{
  "institutionId": "分配的 institutionRef",
  "category": "scholarships",
  "reason": "无法确认的具体原因",
  "discoveryAttempts": [
    { "officialUrl": "https://...", "outcome": "检查结果" },
    { "officialUrl": "https://...", "outcome": "检查结果" },
    { "officialUrl": "https://...", "outcome": "检查结果" }
  ],
  "checkedAt": "YYYY-MM-DD"
}
```

## 输出

只能写：

- `quality/minimax-harvest/inbox/minimax-all-06-scholarships.json`
- `quality/minimax-harvest/inbox/minimax-all-06-scholarships.md`

JSON 的 `batchId` 必须等于 `minimax-all-06-scholarships`，`scope.schoolIds` 必须按顺序包含：

```json
[
  "uni-dalian-university-of-technology",
  "uni-northeastern-university-china",
  "uni-dalian-maritime-university",
  "uni-jilin-university",
  "uni-yanbian-university",
  "dfc-2022-046",
  "uni-harbin-institute-of-technology",
  "uni-harbin-engineering-university"
]
```

完成后执行：

```powershell
npx tsx scripts/ingestion/validate-minimax-harvest.ts --task minimax-all-06-scholarships
```

验证未通过时继续修复，不得声称完成。不得修改其他文件，不得 commit 或 push。
