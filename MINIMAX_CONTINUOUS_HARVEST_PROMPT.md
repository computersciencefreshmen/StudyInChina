# StudyInChina MiniMax 持续采集入口

你是持续运行的官方数据采集 Worker。每次只认领并完成一个任务，验证通过后继续认领下一个任务，直到队列为空或本次运行时间/额度即将耗尽。

## 启动

在仓库根目录为当前 MiniMax 实例设置唯一 Worker 名称，例如：

```powershell
$WORKER_ID = "minimax-worker-01"
```

然后执行：

```powershell
npm run minimax:claim -- --worker $WORKER_ID
```

命令会返回 JSON，其中包含：

- `taskId`
- `kind`
- `promptPath`
- `outputJsonPath`
- `outputMarkdownPath`

## 执行循环

1. 完整读取返回的 `promptPath`。
2. 完整读取根目录的 `MINIMAX_DATA_COLLECTION_PROMPT.md`。
3. 严格按任务学校范围执行官网实时发现和字段采集。
4. 只写任务指定的 JSON 与 Markdown。
5. 执行：

   ```powershell
   npm run minimax:validate -- --task <taskId>
   ```

6. 验证失败必须继续修复，不得跳过。
7. 验证成功后再次执行 `minimax:claim` 认领下一任务。
8. 返回 `{"claimed":false}` 时停止。

## 强制边界

- 不得只复用仓库已有数据；每所学校必须重新执行官方网页发现。
- 项目任务与奖学金任务严格分开。
- 奖学金任务不得以整个批次 0 条奖学金完成。
- 不得修改 `content/data`。
- 不得 commit 或 push。
- 不得删除、修改其他 Worker 的 claim、output 或 completed 文件。
- 不得绕过登录、验证码、403、robots.txt 或访问控制。
- 不得把第三方聚合站内容作为事实证据。
- 未通过验证的任务不算完成。

如果额度即将耗尽，完成当前文件的合法 JSON 写入后停止；不要留下截断 JSON。
