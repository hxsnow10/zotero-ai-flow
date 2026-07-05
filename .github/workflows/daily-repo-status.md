---
description: |
  This workflow creates weekly repo status reports. It gathers recent repository
  activity (issues, PRs, discussions, releases, code changes) and generates
  engaging GitHub issues with productivity insights, community highlights,
  and project recommendations.

on:
  schedule:  
    - cron: '0 10 * * 1' # Every Monday at 10:00 UTC
  workflow_dispatch:

permissions:
  contents: read
  issues: read
  pull-requests: read

network: defaults

tools:
  github:
    # If in a public repo, setting `lockdown: false` allows
    # reading issues, pull requests and comments from 3rd-parties
    # If in a private repo this has no particular effect.
    lockdown: false
    min-integrity: none # This workflow is allowed to examine and comment on any issues

safe-outputs:
  mentions: false
  allowed-github-references: []
  create-issue:
    title-prefix: "[repo-status] "
    labels: [report, weekly-status]
    close-older-issues: true
source: githubnext/agentics/workflows/repo-status.md@1c6668b751c51af8571f01204ceffb19362e0f66
---

# 仓库状态报告

为仓库创建一份积极向上的每周状态报告，并以 GitHub Issue 形式发布。

## 报告内容

- **近期仓库活动**：汇总近期的议题、拉取请求、讨论、发布和代码变更。
- **进度与状态评估**：跟踪项目进度，提醒关键目标，并总结当前项目整体状态。
- **改进建议与后续行动**：标注问题的优先级与复杂度
  - **短期优化**：针对现有功能的细粒度改进建议。
  - **长期规划**：宏观层面的改进方向, 包括而不限整体功能规划、架构优化等。
- **解决方案**: 对于改进建议，简单提供可行的解决方案和行动计划，帮助团队更好地规划未来工作。

## 风格要求

- 保持积极、鼓励和乐于助人的语气 🌟
- 适度使用表情符号以增加互动性
- 保持简洁 —— 根据实际活动量调整篇幅
- 使用中文

## 执行流程

1. 收集仓库近期活动
2. 研究仓库、其议题和拉取请求
3. 用你的发现和见解创建一条新的 GitHub Issue