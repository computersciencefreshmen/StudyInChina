# 无人值守自动发布交叉审查

日期：2026-09-16。范围：`assess-catalog-snapshot.ts` 的兼容快照字段完整性门禁。

## 发现与修复

原门禁检查实体身份、核验日期、来源关联和结构，但合法结构允许费用为 null、语言/要求为空、详情字段缺省。因而同 ID、较新 verifiedAt 的不完整快照可能抹去已有内容，并被自动发布。

新增逐字段保全检查，覆盖所有匹配的非草稿学校、项目、城市、奖学金及招生周期（包括历史周期）：

- 拒绝已有事实变成 null、缺失、空白字符串、空列表、空对象或 unknown。
- 保护已有语言、关联和来源列表；拒绝成员丢失或列表缩减。
- 语言要求按考试类型匹配；本地化列表按各语言的有效条目数比较，正常调序不触发错误。
- 保留 0 和 false 的事实意义，允许非空数值/文字修正及补齐未知字段。
- 生成 `field_erasure:<collection>:<id>:<field>` 问题，整份候选快照不进入自动替换；不修改内容 JSON，不自动拼接推测值。

设计取舍：快照缺少逐字段撤销凭据。故已证实事实的合法撤销也会被保守拦截；需要先由证据处理链确认撤销，建立明确可审计的撤销机制后才可放行。更晚的核验日期本身不能证明清空字段有依据。本门禁保护完整性，不代替上游对非空新值的官方正文及字段证据校验。

原有身份、时间、校验和及当前周期门禁未放宽。未扩大旧规则对整个历史周期删除的允许范围；新增保护针对仍在快照中的同 ID 记录。

## 验证

- `node node_modules/vitest/vitest.mjs run tests/unit/automation-snapshot.test.ts`：24 / 24 通过。
- `node node_modules/typescript/bin/tsc --noEmit --incremental false`：通过。
- `node node_modules/eslint/bin/eslint.js scripts/automation/assess-catalog-snapshot.ts tests/unit/automation-snapshot.test.ts`：通过。

修改限定为评估器、上述测试及本文；未部署、未改事实数据或其他代理的工作。
