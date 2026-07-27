# MiniMax 持续采集任务：minimax-all-01-scholarships

先完整读取仓库根目录的 `MINIMAX_DATA_COLLECTION_PROMPT.md`，再执行本任务。

## 锁定参数

- `TASK_ID`: `minimax-all-01-scholarships`
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
    "targetId": "dfc-2022-001",
    "cohort": "double_first_class",
    "officialNameZh": "北京大学",
    "officialNameEn": "Peking University",
    "institutionRef": "uni-peking-university",
    "catalogInstitutionId": "uni-peking-university",
    "province": null,
    "city": null,
    "focusTags": []
  },
  {
    "targetId": "dfc-2022-002",
    "cohort": "double_first_class",
    "officialNameZh": "中国人民大学",
    "officialNameEn": "Renmin University of China",
    "institutionRef": "uni-renmin-university-of-china",
    "catalogInstitutionId": "uni-renmin-university-of-china",
    "province": null,
    "city": null,
    "focusTags": []
  },
  {
    "targetId": "dfc-2022-003",
    "cohort": "double_first_class",
    "officialNameZh": "清华大学",
    "officialNameEn": "Tsinghua University",
    "institutionRef": "uni-tsinghua-university",
    "catalogInstitutionId": "uni-tsinghua-university",
    "province": null,
    "city": null,
    "focusTags": []
  },
  {
    "targetId": "dfc-2022-004",
    "cohort": "double_first_class",
    "officialNameZh": "北京交通大学",
    "officialNameEn": "Beijing Jiaotong University",
    "institutionRef": "uni-beijing-jiaotong-university",
    "catalogInstitutionId": "uni-beijing-jiaotong-university",
    "province": null,
    "city": null,
    "focusTags": []
  },
  {
    "targetId": "dfc-2022-005",
    "cohort": "double_first_class",
    "officialNameZh": "北京工业大学",
    "officialNameEn": "Beijing University of Technology",
    "institutionRef": "uni-beijing-university-of-technology",
    "catalogInstitutionId": "uni-beijing-university-of-technology",
    "province": null,
    "city": null,
    "focusTags": []
  },
  {
    "targetId": "dfc-2022-006",
    "cohort": "double_first_class",
    "officialNameZh": "北京航空航天大学",
    "officialNameEn": "Beihang University",
    "institutionRef": "uni-beihang-university",
    "catalogInstitutionId": "uni-beihang-university",
    "province": null,
    "city": null,
    "focusTags": []
  },
  {
    "targetId": "dfc-2022-007",
    "cohort": "double_first_class",
    "officialNameZh": "北京理工大学",
    "officialNameEn": "Beijing Institute of Technology",
    "institutionRef": "uni-beijing-institute-of-technology",
    "catalogInstitutionId": "uni-beijing-institute-of-technology",
    "province": null,
    "city": null,
    "focusTags": []
  },
  {
    "targetId": "dfc-2022-008",
    "cohort": "double_first_class",
    "officialNameZh": "北京科技大学",
    "officialNameEn": "University of Science and Technology Beijing",
    "institutionRef": "uni-university-of-science-and-technology-beijing",
    "catalogInstitutionId": "uni-university-of-science-and-technology-beijing",
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

- `quality/minimax-harvest/inbox/minimax-all-01-scholarships.json`
- `quality/minimax-harvest/inbox/minimax-all-01-scholarships.md`

JSON 的 `batchId` 必须等于 `minimax-all-01-scholarships`，`scope.schoolIds` 必须按顺序包含：

```json
[
  "uni-peking-university",
  "uni-renmin-university-of-china",
  "uni-tsinghua-university",
  "uni-beijing-jiaotong-university",
  "uni-beijing-university-of-technology",
  "uni-beihang-university",
  "uni-beijing-institute-of-technology",
  "uni-university-of-science-and-technology-beijing"
]
```

完成后执行：

```powershell
npx tsx scripts/ingestion/validate-minimax-harvest.ts --task minimax-all-01-scholarships
```

验证未通过时继续修复，不得声称完成。不得修改其他文件，不得 commit 或 push。
