---
description: "当用户在 Issue 评论中 @github agent 时，按指令实现代码并创建 PR。"
on:
  roles: all
  issue_comment:
    types: [created]

permissions:
  contents: read
  issues: read
  pull-requests: read

tools:
  github:
    mode: gh-proxy
    toolsets: [default]
  bash: true
  edit: true

safe-outputs:
  add-comment:
    max: 2
  create-pull-request:
    title-prefix: "[issue-agent] "
    labels: [automation, copilot]
    draft: false
---

# Issue @github agent 代码处理

## 目标

当用户在 **Issue 评论**中显式提及 `@github-agent` 时：
1. 理解当前 Issue 上下文与该条评论中的用户指令。
2. 在当前仓库实现所需代码改动（必要时包含测试或文档更新）。
3. 通过 `create-pull-request` 提交 PR，并在 PR 描述中清楚说明变更内容、原因与验证方式。
如果没有提及 `@github-agent`，则不执行任何操作。

## 执行流程

1. 读取触发评论与关联 Issue 内容，确认这是 Issue（不是 PR）上下文。
2. 检查评论是否包含 `@github-agent`：
   - 若不包含，调用 `noop` 并结束。
   - 若包含，继续执行。
3. 从评论中提取明确需求：
   - 如果需求不明确或信息不足，先用 `add-comment` 提出最小必要澄清问题，然后结束本次执行。
4. 若需求明确：
   - 制定最小可行改动方案；
   - 编辑代码并保持与仓库现有风格一致；
   - 若仓库已有测试框架，优先运行与改动相关的最小测试集。
5. 当且仅当存在有效文件改动时，调用 `create-pull-request` 创建 PR：
   - PR 标题简洁说明目标；
   - PR 正文包含：问题背景、实现方案、影响范围、验证结果、潜在风险。
6. 如果无法安全完成改动（例如需求冲突、缺失关键上下文、受限于权限/环境），使用 `add-comment` 说明阻塞原因与下一步建议，不要伪造完成结果。

## 规则

- 全程使用中文输出评论与 PR 描述。
- 仅处理与当前 Issue 目标直接相关的改动，避免顺手重构。
- 不要直接推送到默认分支。
- 不要创建与当前任务无关的额外文件。
- 保持评论简洁、礼貌、可执行。
