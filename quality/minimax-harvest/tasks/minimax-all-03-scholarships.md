# MiniMax 持续采集任务：minimax-all-03-scholarships

先完整读取仓库根目录的 `MINIMAX_DATA_COLLECTION_PROMPT.md`，再执行本任务。

## 锁定参数

- `TASK_ID`: `minimax-all-03-scholarships`
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
    "targetId": "dfc-2022-017",
    "cohort": "double_first_class",
    "officialNameZh": "北京外国语大学",
    "officialNameEn": "Beijing Foreign Studies University",
    "institutionRef": "uni-beijing-foreign-studies-university",
    "catalogInstitutionId": "uni-beijing-foreign-studies-university",
    "province": null,
    "city": null,
    "focusTags": []
  },
  {
    "targetId": "dfc-2022-018",
    "cohort": "double_first_class",
    "officialNameZh": "中国传媒大学",
    "officialNameEn": "Communication University of China",
    "institutionRef": "uni-communication-university-of-china",
    "catalogInstitutionId": "uni-communication-university-of-china",
    "province": null,
    "city": null,
    "focusTags": []
  },
  {
    "targetId": "dfc-2022-019",
    "cohort": "double_first_class",
    "officialNameZh": "中央财经大学",
    "officialNameEn": "Central University of Finance and Economics",
    "institutionRef": "uni-central-university-of-finance-and-economics",
    "catalogInstitutionId": "uni-central-university-of-finance-and-economics",
    "province": null,
    "city": null,
    "focusTags": []
  },
  {
    "targetId": "dfc-2022-020",
    "cohort": "double_first_class",
    "officialNameZh": "对外经济贸易大学",
    "officialNameEn": "University of International Business and Economics",
    "institutionRef": "uni-university-of-international-business-and-economics",
    "catalogInstitutionId": "uni-university-of-international-business-and-economics",
    "province": null,
    "city": null,
    "focusTags": []
  },
  {
    "targetId": "dfc-2022-021",
    "cohort": "double_first_class",
    "officialNameZh": "外交学院",
    "officialNameEn": "China Foreign Affairs University",
    "institutionRef": "uni-china-foreign-affairs-university",
    "catalogInstitutionId": "uni-china-foreign-affairs-university",
    "province": null,
    "city": null,
    "focusTags": []
  },
  {
    "targetId": "dfc-2022-022",
    "cohort": "double_first_class",
    "officialNameZh": "中国人民公安大学",
    "officialNameEn": null,
    "institutionRef": "dfc-2022-022",
    "catalogInstitutionId": null,
    "province": null,
    "city": null,
    "focusTags": []
  },
  {
    "targetId": "dfc-2022-023",
    "cohort": "double_first_class",
    "officialNameZh": "北京体育大学",
    "officialNameEn": "Beijing Sport University",
    "institutionRef": "uni-beijing-sport-university",
    "catalogInstitutionId": "uni-beijing-sport-university",
    "province": null,
    "city": null,
    "focusTags": []
  },
  {
    "targetId": "dfc-2022-024",
    "cohort": "double_first_class",
    "officialNameZh": "中央音乐学院",
    "officialNameEn": "Central Conservatory of Music",
    "institutionRef": "uni-central-conservatory-of-music",
    "catalogInstitutionId": "uni-central-conservatory-of-music",
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

- `quality/minimax-harvest/inbox/minimax-all-03-scholarships.json`
- `quality/minimax-harvest/inbox/minimax-all-03-scholarships.md`

JSON 的 `batchId` 必须等于 `minimax-all-03-scholarships`，`scope.schoolIds` 必须按顺序包含：

```json
[
  "uni-beijing-foreign-studies-university",
  "uni-communication-university-of-china",
  "uni-central-university-of-finance-and-economics",
  "uni-university-of-international-business-and-economics",
  "uni-china-foreign-affairs-university",
  "dfc-2022-022",
  "uni-beijing-sport-university",
  "uni-central-conservatory-of-music"
]
```

完成后执行：

```powershell
npx tsx scripts/ingestion/validate-minimax-harvest.ts --task minimax-all-03-scholarships
```

验证未通过时继续修复，不得声称完成。不得修改其他文件，不得 commit 或 push。
