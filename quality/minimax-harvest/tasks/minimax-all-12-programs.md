# MiniMax 持续采集任务：minimax-all-12-programs

先完整读取仓库根目录的 `MINIMAX_DATA_COLLECTION_PROMPT.md`，再执行本任务。

## 锁定参数

- `TASK_ID`: `minimax-all-12-programs`
- `TASK_KIND`: `programs`
- `CHECKED_AT`: 使用实际运行日期
- `SCHOOL_LIMIT`: `8`
- `PROGRAM_LIMIT_PER_SCHOOL`: `5`
- `SCHOLARSHIP_LIMIT_PER_SCHOOL`: `5`

本任务只采集国际学生项目与项目事实。每校目标为 3–5 个代表性项目。
必须进行官网实时发现，不能只复制仓库现有记录。重点补全学制、学费、申请费、当前或下一周期开放日和截止日、授课语言、申请入口、资格与材料。
奖学金数组保持为空；奖学金由同批次独立任务负责。

## 学校范围

```json
[
  {
    "targetId": "dfc-2022-089",
    "cohort": "double_first_class",
    "officialNameZh": "中国海洋大学",
    "officialNameEn": "Ocean University of China",
    "institutionRef": "uni-ocean-university-of-china",
    "catalogInstitutionId": "uni-ocean-university-of-china",
    "province": null,
    "city": null,
    "focusTags": []
  },
  {
    "targetId": "dfc-2022-090",
    "cohort": "double_first_class",
    "officialNameZh": "中国石油大学（华东）",
    "officialNameEn": "China University of Petroleum (East China)",
    "institutionRef": "uni-china-university-of-petroleum-east-china",
    "catalogInstitutionId": "uni-china-university-of-petroleum-east-china",
    "province": null,
    "city": null,
    "focusTags": []
  },
  {
    "targetId": "dfc-2022-091",
    "cohort": "double_first_class",
    "officialNameZh": "郑州大学",
    "officialNameEn": "Zhengzhou University",
    "institutionRef": "uni-zhengzhou-university",
    "catalogInstitutionId": "uni-zhengzhou-university",
    "province": null,
    "city": null,
    "focusTags": []
  },
  {
    "targetId": "dfc-2022-092",
    "cohort": "double_first_class",
    "officialNameZh": "河南大学",
    "officialNameEn": "Henan University",
    "institutionRef": "uni-henan-university",
    "catalogInstitutionId": "uni-henan-university",
    "province": null,
    "city": null,
    "focusTags": []
  },
  {
    "targetId": "dfc-2022-093",
    "cohort": "double_first_class",
    "officialNameZh": "武汉大学",
    "officialNameEn": "Wuhan University",
    "institutionRef": "uni-wuhan-university",
    "catalogInstitutionId": "uni-wuhan-university",
    "province": null,
    "city": null,
    "focusTags": []
  },
  {
    "targetId": "dfc-2022-094",
    "cohort": "double_first_class",
    "officialNameZh": "华中科技大学",
    "officialNameEn": "Huazhong University of Science and Technology",
    "institutionRef": "uni-huazhong-university-of-science-and-technology",
    "catalogInstitutionId": "uni-huazhong-university-of-science-and-technology",
    "province": null,
    "city": null,
    "focusTags": []
  },
  {
    "targetId": "dfc-2022-095",
    "cohort": "double_first_class",
    "officialNameZh": "中国地质大学（武汉）",
    "officialNameEn": "China University of Geosciences (Wuhan)",
    "institutionRef": "uni-china-university-of-geosciences-wuhan",
    "catalogInstitutionId": "uni-china-university-of-geosciences-wuhan",
    "province": null,
    "city": null,
    "focusTags": []
  },
  {
    "targetId": "dfc-2022-096",
    "cohort": "double_first_class",
    "officialNameZh": "武汉理工大学",
    "officialNameEn": "Wuhan University of Technology",
    "institutionRef": "uni-wuhan-university-of-technology",
    "catalogInstitutionId": "uni-wuhan-university-of-technology",
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

- `quality/minimax-harvest/inbox/minimax-all-12-programs.json`
- `quality/minimax-harvest/inbox/minimax-all-12-programs.md`

JSON 的 `batchId` 必须等于 `minimax-all-12-programs`，`scope.schoolIds` 必须按顺序包含：

```json
[
  "uni-ocean-university-of-china",
  "uni-china-university-of-petroleum-east-china",
  "uni-zhengzhou-university",
  "uni-henan-university",
  "uni-wuhan-university",
  "uni-huazhong-university-of-science-and-technology",
  "uni-china-university-of-geosciences-wuhan",
  "uni-wuhan-university-of-technology"
]
```

完成后执行：

```powershell
npx tsx scripts/ingestion/validate-minimax-harvest.ts --task minimax-all-12-programs
```

验证未通过时继续修复，不得声称完成。不得修改其他文件，不得 commit 或 push。
