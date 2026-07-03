中文 | [English](README.md)

# Zotero AI Workflow

Zotero AI Workflow 是一套用于 Zotero 文献阅读与笔记管理的自动化工具集。
项目将 Zotero 插件、Python 服务和 LLM API 组合在一起，支持：

- AI 论文摘要
- 库级与 PDF 级问答
- 标注转结构化笔记
- 笔记导出与外部同步

## 工作流概览

一个常见流程如下：

- 文献入库
  - 自动：添加 To-Read 等标签
  - 手动：补充项目标签
- 打开文献
  - 自动：生成 AI 摘要并写入笔记
- 阅读文献
  - 手动：添加 PDF 标注
  - 交互：向 LLM 提问并将答案写入笔记
- 关闭文献或周期维护
  - 自动：根据标注生成或更新结构化笔记
  - 自动：导出笔记用于外部同步

## 环境与插件

必需组件：

- Zotero
- [zotero-actions-tags](https://github.com/windingwind/zotero-actions-tags)
- [zotero-better-notes](https://github.com/windingwind/zotero-better-notes)
- Python 3.10+

建议：

- 将解析服务常驻运行，便于摘要和 PDF 问答功能稳定使用。

## 快速开始

1. 先创建并填写配置文件：

```bash
cp config_example.json config.json
```

必填字段：

- server.url
- llm.openaiBaseUrl
- llm.modelName
- llm.apiKey

2. 启动解析服务：

```bash
python parse_server.py
```

如需后台运行：

```bash
nohup python parse_server.py > parse_server.log 2>&1 &
```

3. 在 Zotero 插件中配置脚本与模板：

- 在 actions-tags 中加载动作脚本
- 在 better-notes 中加载笔记模板

4. 按你的流程在 Zotero 中触发对应脚本。

## 配置说明

主配置文件：config.json

- server.url：PDF 解析与 markdown 转 HTML 的后端服务地址
- server.timeout：请求超时时间（秒）
- llm.openaiBaseUrl：兼容 OpenAI 的 API 地址
- llm.modelName：模型名称
- llm.apiKey：模型接口密钥
- llm.temperature：生成温度
- summary.chunkSize：map-reduce 分片大小
- summary.chunkOverlap：相邻分片重叠长度
- summary.maxChunk：最大分片数量
- summary.only_link_file：若使用 Link to File 流程（如 ZotMoov/ZotFile），请设为 true
- summary.support_item_types：支持生成摘要的条目类型
- qa.saveColelctionKey：问答结果保存到的 collection key（保持现有命名以兼容当前脚本）

提示词模板位于 prompt/ 目录：

- stuff_prompt.txt：单分片摘要
- map_prompt.txt：多分片摘要的 map 阶段
- reduce_prompt.txt：多分片摘要的 reduce 阶段
- qa_prompt.txt：问答提示词

## 功能：标注转结构化笔记

相关文件：

- zotero_note_template.js
- zotero_autoupdate_note.js

该功能在 Zotero 原生标注转笔记能力上增加了层级结构支持。
当前方案通过颜色标注标记标题层级，从而生成结构化笔记。

![annotation-note-example-1](docs/image.png)
![annotation-note-example-2](docs/image-1.png)

## 功能：AI 摘要

相关文件：

- zotero_pdf_summary.js

流程：

1. 获取选中文献的 PDF 和元信息
2. 将 PDF 发送到 parse_server.py 进行解析与分片
3. 调用 LLM 执行摘要（stuff 或 map-reduce）
4. 将 markdown 转为 HTML
5. 写回 Zotero 笔记

![summary-example](https://qyzhang-obsidian.oss-cn-hangzhou.aliyuncs.com/20250124100826.png)

## 功能：语义问答

相关文件：

- zotero_qa.js

问答模式：

- 库级问答：检索相关条目，结合元信息和已有摘要后调用 LLM
- PDF 级问答：检索相关 PDF 片段后带上下文调用 LLM

## 功能：笔记导出与同步

相关文件：

- zotero_export_note.js

导出后可在外部笔记系统中进行检索与复用。
可按你的工作流在脚本或配置中指定目标 key。

![note-export-example](docs/image3.png)

## 核心脚本索引

| 脚本文件 | 作用 |
|-------------|---------|
| zotero_pdf_summary.js | 为选中文献生成 AI 摘要 |
| zotero_qa.js | 执行库级/PDF 级 LLM 问答 |
| zotero_note_template.js | 根据标注生成结构化笔记 |
| zotero_autoupdate_note.js | 周期性更新模板生成笔记 |
| zotero_export_note.js | 导出笔记用于外部同步 |
| parse_server.py | 提供 PDF 解析与 markdown 转 HTML 服务 |

## 说明

- 本仓库重点提供工作流脚本与编排思路。
- 可根据实际 Zotero 使用习惯按需独立采用各脚本。
