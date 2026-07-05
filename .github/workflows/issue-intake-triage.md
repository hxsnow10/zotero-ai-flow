---
description: "Analyze newly opened non-report issues: add type/priority labels, detect duplicates, and ask clarification questions."
on:
  roles: all
  issues:
    types: [opened]

permissions:
  contents: read
  issues: read
  pull-requests: read

tools:
  github:
    mode: gh-proxy
    toolsets: [default]

safe-outputs:
  add-labels:
  add-comment:
---

# 新议题分流

## 任务
当一个新议题被创建时，为维护者进行分流处理。
1. 判断该议题是否为"报告类"议题。当标题/正文或现有标签明确表明是状态报告、周报或摘要报告时（例如包含 report、weekly-status 等标签），将其视为报告类议题。
2. 如果是报告类议题，调用 noop 并附上简短原因，然后停止处理。
3. 如果不是报告类议题，进行分类并添加以下两组标签：
- * * 类型标签（选择其一）：bug、enhancement、question、documentation、discussion。
- * * 优先级标签（选择其一）：priority:high、priority:medium、priority:low。
4. 使用标题和问题描述中的语义相似度，在已开启和近期关闭的议题中搜索潜在的重复项。如果存在可能的重复项，添加一条简洁的评论：
* 列出至多 3 个候选重复议题链接，并附上每个的一行理由。
* 请报告者确认该议题是否为重复项。
5. 如果议题描述不清楚，或bug缺少关键的复现步骤/上下文细节，添加一条简洁的澄清性评论，提出有针对性的问题。
5. 对于建议类、功能类或讨论类议题，基于这个议题，自动优化目标，产出简洁的解决方案。

## 规则
- 评论保持简洁、可操作且有礼貌。
- 保持积极、鼓励和乐于助人的语气 🌟
- 适度使用表情符号以增加互动性
- 保持简洁 —— 根据实际活动量调整篇幅
- 不要自动关闭议题, 不要创建新议题。
- 仅使用已配置的安全输出。
- 使用中文
