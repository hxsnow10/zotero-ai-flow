# AGENTS.md

本文件定义本仓库中 AI Agent（含 Copilot/Codex/Claude 等）执行任务时的统一约束与工作流程。

## 1. 项目定位

本仓库是 Zotero AI 工作流工具集，主要由三部分构成：

- Zotero 侧自动化脚本（JavaScript）
- 解析与服务端能力（Python/FastAPI）
- GitHub 工作流与自动化（.github/workflows）

核心目标：围绕论文阅读、总结、问答、标注整理与笔记导出，提供可组合的自动化能力。

## 2. 目录与关键文件

- `parse_server.py`: PDF 解析与 markdown 转换服务入口
- `paper_summary.py`: 论文总结相关逻辑
- `zotero_*.js`: Zotero 脚本集合（总结、问答、导出、模板等）
- `prompt/`: LLM 提示词模板
- `.github/workflows/`: GitHub Actions 与 Agentic Workflow
- `config_example.json`: 配置模板（复制为 `config.json` 后使用）

## 3. 本地运行与开发

### 3.1 Python 依赖

建议使用 Poetry（仓库已配置 `pyproject.toml`）：

- 安装依赖：`poetry install`
- 启动服务：`poetry run python parse_server.py`

若未使用 Poetry，可直接：

- `python parse_server.py`

### 3.2 前端/脚本格式化

仓库含 Prettier 依赖，用于 JS/JSON/Markdown 格式化。

- 安装：`npm install`
- 格式化（如需）：`npx prettier -w "**/*.{js,json,md}"`

## 4. Agent 修改原则

1. 只做与当前任务直接相关的最小改动，避免顺手重构。
2. 优先保持现有脚本接口与字段兼容，特别是 Zotero 脚本输入输出结构。
3. 涉及配置项时，优先同步更新 `config_example.json` 与 README 文档。
4. 不在仓库中提交密钥、Token 或任何敏感信息。
5. 修改 GitHub 工作流时，明确触发条件与权限最小化（least privilege）。

## 5. GitHub Workflow 约定

1. workflow 名称应表达单一职责，避免一个 workflow 做多件不相关的事。
2. 触发器尽量精确；issue_comment 场景需用 `if` 条件过滤 PR 评论与无关指令。
3. 需要写权限时才开启 `contents: write` / `pull-requests: write`。
4. 对 AI 自动改码链路，必须包含失败兜底（回帖说明或安全退出）。
5. 自动创建 PR 时，标题建议使用统一前缀，例如 `[issue-agent]`。

## 6. 提交与 PR 规范

- 提交信息建议：`type(scope): summary`
  - 示例：`feat(workflow): support direct ai patch apply`
- PR 描述至少包含：
  - 变更目的
  - 关键改动点
  - 验证方式
  - 风险与回滚说明（如适用）

## 7. 常见任务建议

- 新增 Zotero 脚本：先在 README 对应功能段落补一行说明。
- 调整 prompt：同步说明影响范围（总结、问答、导出等）。
- 修改服务端接口：检查所有 `zotero_*.js` 调用点是否一致。
- 新增自动化工作流：优先使用独立文件，避免影响已有稳定流程。

## 8. 禁止事项

- 禁止提交 API Key/Token 到仓库。
- 禁止在未说明的情况下修改与任务无关文件。
- 禁止删除现有 workflow 或脚本，除非任务明确要求。

