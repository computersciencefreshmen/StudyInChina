# MiniMax 持续采集任务：minimax-all-19-scholarships

先完整读取仓库根目录的 `MINIMAX_DATA_COLLECTION_PROMPT.md`，再执行本任务。

## 锁定参数

- `TASK_ID`: `minimax-all-19-scholarships`
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
    "targetId": "regional-001",
    "cohort": "regional_priority",
    "officialNameZh": "广东外语外贸大学",
    "officialNameEn": "Guangdong University of Foreign Studies",
    "institutionRef": "uni-guangdong-university-of-foreign-studies",
    "catalogInstitutionId": null,
    "province": "Guangdong",
    "city": "Guangzhou",
    "focusTags": [
      "languages",
      "business",
      "international-studies"
    ]
  },
  {
    "targetId": "regional-002",
    "cohort": "regional_priority",
    "officialNameZh": "北京语言大学",
    "officialNameEn": "Beijing Language and Culture University",
    "institutionRef": "uni-beijing-language-and-culture-university",
    "catalogInstitutionId": "uni-beijing-language-and-culture-university",
    "province": "Beijing",
    "city": "Beijing",
    "focusTags": [
      "languages",
      "chinese-education"
    ]
  },
  {
    "targetId": "regional-003",
    "cohort": "regional_priority",
    "officialNameZh": "深圳大学",
    "officialNameEn": "Shenzhen University",
    "institutionRef": "uni-shenzhen-university",
    "catalogInstitutionId": "uni-shenzhen-university",
    "province": "Guangdong",
    "city": "Shenzhen",
    "focusTags": [
      "engineering",
      "business",
      "medicine"
    ]
  },
  {
    "targetId": "regional-004",
    "cohort": "regional_priority",
    "officialNameZh": "汕头大学",
    "officialNameEn": "Shantou University",
    "institutionRef": "uni-shantou-university",
    "catalogInstitutionId": null,
    "province": "Guangdong",
    "city": "Shantou",
    "focusTags": [
      "medicine",
      "engineering",
      "business"
    ]
  },
  {
    "targetId": "regional-005",
    "cohort": "regional_priority",
    "officialNameZh": "南方医科大学",
    "officialNameEn": "Southern Medical University",
    "institutionRef": "uni-southern-medical-university",
    "catalogInstitutionId": null,
    "province": "Guangdong",
    "city": "Guangzhou",
    "focusTags": [
      "medicine"
    ]
  },
  {
    "targetId": "regional-006",
    "cohort": "regional_priority",
    "officialNameZh": "广州大学",
    "officialNameEn": "Guangzhou University",
    "institutionRef": "uni-guangzhou-university",
    "catalogInstitutionId": null,
    "province": "Guangdong",
    "city": "Guangzhou",
    "focusTags": [
      "engineering",
      "business",
      "humanities"
    ]
  },
  {
    "targetId": "regional-007",
    "cohort": "regional_priority",
    "officialNameZh": "首都经济贸易大学",
    "officialNameEn": "Capital University of Economics and Business",
    "institutionRef": "uni-capital-university-of-economics-and-business",
    "catalogInstitutionId": null,
    "province": "Beijing",
    "city": "Beijing",
    "focusTags": [
      "business",
      "economics"
    ]
  },
  {
    "targetId": "regional-008",
    "cohort": "regional_priority",
    "officialNameZh": "浙江工业大学",
    "officialNameEn": "Zhejiang University of Technology",
    "institutionRef": "uni-zhejiang-university-of-technology",
    "catalogInstitutionId": null,
    "province": "Zhejiang",
    "city": "Hangzhou",
    "focusTags": [
      "engineering",
      "science"
    ]
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

- `quality/minimax-harvest/inbox/minimax-all-19-scholarships.json`
- `quality/minimax-harvest/inbox/minimax-all-19-scholarships.md`

JSON 的 `batchId` 必须等于 `minimax-all-19-scholarships`，`scope.schoolIds` 必须按顺序包含：

```json
[
  "uni-guangdong-university-of-foreign-studies",
  "uni-beijing-language-and-culture-university",
  "uni-shenzhen-university",
  "uni-shantou-university",
  "uni-southern-medical-university",
  "uni-guangzhou-university",
  "uni-capital-university-of-economics-and-business",
  "uni-zhejiang-university-of-technology"
]
```

完成后执行：

```powershell
npx tsx scripts/ingestion/validate-minimax-harvest.ts --task minimax-all-19-scholarships
```

验证未通过时继续修复，不得声称完成。不得修改其他文件，不得 commit 或 push。
