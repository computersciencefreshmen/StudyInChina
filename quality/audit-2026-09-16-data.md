# 2026-09-16 全量学校与招生数据审计

## 结论

本轮把“目录可发现”与“信息仍在有效期”分开核验。全量结构审计覆盖 **5,023 条最终记录**，不是逐条重新人工核验了 5,023 个网页。原有 **792 条超期但仍标 verified** 的记录已按原有日期降级；经过真实官网复核后，当前可发布的招生周期由 **0 恢复到 9**，涉及 **8 所学校**。不改动未核验记录的 verifiedAt 或 reviewAfter。

| 集合 | 原始记录 | 当前可发布 |
| --- | ---: | ---: |
| 学校 | 272 | 266 |
| 项目 | 1,280 | 1,265 |
| 奖学金 | 394 | 366 |
| 招生周期 | 860 | 9 |
| 城市 | 62 | 62 |
| 官方来源登记 | 2,155 | 2,090 被公开记录引用 |

最终 stale 状态共 **2,331 条**：学校 11、项目 1,143、奖学金 362、招生周期 815。这个数字表示证据需要复核，不表示学校停办或项目不存在。全量数据模型和引用关系校验通过；剩余超期 verified 为 **0**。

## 实际完成的官网复核

- 保存了 **12 个指定官方 URL** 的真实 HTTP 抓取回执、UTC 时间、SHA-256 与本地临时快照位置；其中 **10 个来源**完成关键字段审阅（9 所学校来源及语合中心标准）。这些快照不是生产 R2 存档的证明。
- 精确恢复 **7 条项目资料、9 个未来招生周期、4 条奖学金**。9 个周期中，清华春秋两个申请窗口为 upcoming，其他7个仅为 dates-published；截止日未来不等于现在可以申请。
- 优先周期来源：[清华访学](https://intl-nondegree.tsinghua.edu.cn/f/yzlxs/yz_lxs_kstzb/view?id=264627)、[厦大汉语](https://oec.xmu.edu.cn/en/Program1/Chinese_Language_Programs.htm)、[哈工大冬季](https://studyathit.hit.edu.cn/ShortwTermPrograms/list.htm)、[北语](https://admission.blcu.edu.cn/en/2026/0303/c1148a3044/page.htm)、[深大](https://lxs.szu.edu.cn/info/1169/6947.htm)、[广外](https://iie.gdufs.edu.cn/info/1087/1536.htm)、[上外](https://www.oisa.shisu.edu.cn/index.php/index/newscontent/cid/39/id/666.html)、[复旦官方PDF](https://iso.fudan.edu.cn/_upload/article/files/ec/db/98f894064930aeeec752ae6440b4/c5ee1e57-ef19-4b80-824e-d52ce48a22b5.pdf)。

### 实质修正

1. 哈工大冬季汉语：申请费 **400→500元**；结束日 **2027-01-24→2027-01-22**；住宿 **800–1000→1000–1200元/月/床**；删除当前页面不支持的统一不退款表述。另一个代理独立打开官网确认了这些变化。过时译文移除，使用网站既有翻译回退机制。
2. 厦大：官网400元标作新生入学注册费，applicationFeeCny 改为 null，保留费用类型说明；13000元/学期和2026-12-30截止日已核验。
3. 广外：补充官方要求的学校电话面试。
4. 清华：已核验日期和400元申请费；未重新审阅的费用附件分类金额从公开备注移除，不借日期刷新顺便恢复旧学费。
5. 北语奖学金：修正为正式英文校名 Beijing Language and Culture University。
6. 404关联处理：南京中医药大学、内蒙古师范大学、海南医科大学的资料标 stale。南京中医药大学改用[官方介绍](https://english.njucm.edu.cn/5128/list.htm)，不可用的招生入口置空；海南改用[当前官方简章](https://www.muhn.edu.cn/gjxy/zsgl/zsjz.htm)。旧来源 ID 保留用于历史溯源。

## 保留的冲突与缺口

- [北外奖学金](https://osao.bfsu.edu.cn/info/2462/6812.htm)表格列2026-12-30，而所引[语合中心标准](https://pmplatform.chinese.cn/tmp/2026/2/6/94005b2e-f2e9-438e-85e7-12212f0e9968.pdf)列2026-10-31；北外还存在1月/3月开学冲突。周期保持 stale，不选择更晚期限。
- 深大中文要求HSKK成绩，英文写成优先考虑；已复核的奖学金和截止日可用，项目要求仍保持 stale。
- 1,109个项目缺要求，448个缺学制，181个缺授课语言；1,257个公开项目缺当前可发布招生周期。
- 2,036条来源登记超过30天未复核；82个可能仍有申请价值的旧周期需要优先复查；15所学校缺可确认招生入口。
- 全量任务在 JSON 中按实体、字段、官方URL和优先级列出，不能把任务数当成全部事实错误数。已过截止日期属于历史信息，不应删去或自动改成年份+1。

## 文件与复现

- `audit-2026-09-16-data.before.json`：5,020条原始记录的修复前基线。
- `audit-2026-09-16-data.json`：最终全量逐条审计、快照哈希及4,631条实体跟进任务。
- `audit-2026-09-16-data-source-receipts.json`：真实来源抓取时间、SHA-256与临时快照。
- `audit-2026-09-16-data-changes.json`：逐字段更新与官方证据定位。
- `audit-2026-09-16-data-link-remediation.json`：来源404隔离、官网入口修复记录。

```text
npx tsx scripts/quality/comprehensive-data-audit.ts --today 2026-09-16
npx tsx --test scripts/quality/comprehensive-data-audit.test.ts
npm run validate:data
```

新审计的5项测试通过；涉及本轮过期变化的3组历史批次测试21项通过。历史测试现在允许资料随时间变为 stale，R2原始证据日期仍保留独立校验。带日期的修复脚本只接受当天真实抓取回执，在其他日期会拒绝续期；同一天重复预检返回0项变动。
