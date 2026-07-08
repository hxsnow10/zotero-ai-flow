中文 | [English](README_en.md)

# Zotero AI Workflow

<<<<<<< HEAD
<<<<<<< HEAD
Zotero AI Workflow 是一套用于 Zotero 文献阅读与笔记管理的自动化工具集。
项目将 Zotero 插件、Python 服务和 LLM API 组合在一起，支持：

- AI 论文摘要
- 库级与 PDF 级问答
- 标注转结构化笔记
- 笔记导出与外部同步

核心架构：某种行为(入库/打开/关闭) -> zotero-actions触发脚本 -> 访问python后台/调用zotero-better-notes模板/调用LLM API等 -> 写回笔记

本库适合：期望自己动手搭建灵活的zotero工作流的用户。

界面化的插件可以使用zotero-AI-Butler

## zotero工作流概览

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
- `pip install .` 安装各种依赖

## 快速开始

1. 先创建并填写配置文件：

=======
=======
>>>>>>> origin/main
Zotero AI Workflow is an automation toolkit for literature reading and note management in Zotero.
It combines Zotero plugins, Python services, and LLM APIs to support:

- AI paper summarization
- Library-level and PDF-level Q&A
- Annotation-to-note generation
- Note export and external sync workflows

## Workflow Overview

A typical workflow looks like this:

- Item added to library
  - Auto: add tags such as To-Read
  - Manual: add project-specific tags
- Item opened
  - Auto: generate AI summary and save to note
- Item being read
  - Manual: annotate PDF
  - Interactive: ask LLM questions and save answers to note
- Item closed or periodic maintenance
  - Auto: generate/update structured notes from annotations
  - Auto: export notes for external sync

## Environment and Plugins

Required:

- Zotero
- [zotero-actions-tags](https://github.com/windingwind/zotero-actions-tags)
- [zotero-better-notes](https://github.com/windingwind/zotero-better-notes)
- Python 3.10+

Recommended:

- Keep the parser service running in the background for summary and PDF Q&A tasks.

## Quick Start

1. Create and fill the config file first:

<<<<<<< HEAD
>>>>>>> 40bfc43 (update README)
=======
>>>>>>> origin/main
```bash
cp config_example.json config.json
```

<<<<<<< HEAD
<<<<<<< HEAD
必填字段：
=======
Required fields:
>>>>>>> 40bfc43 (update README)
=======
Required fields:
>>>>>>> origin/main

- server.url
- llm.openaiBaseUrl
- llm.modelName
- llm.apiKey

<<<<<<< HEAD
<<<<<<< HEAD
2. 启动解析服务：

```bash
nohup python parse_server.py > parse_server.log 2>&1 &
```
可以写到bash_profile中，开机自启。

3. 在 Zotero 插件中配置脚本与模板：

- 在 actions-tags 中加载动作脚本 ./zotero_actions/ 下的脚本
![actions-tags-config](docs/img-actions-tags-config.png) 

- 在 better-notes 中加载笔记模板 ./zotero_note_templates/ 下的模板

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

## 功能：pdf标注转结构化笔记

相关文件：

- 模板 zotero_note_templates/zotero_note_template.js
- 行为脚本 zotero_actions/zotero_autoupdate_note.js

该功能在 Zotero 原生标注转笔记能力上增加了层级结构支持。
当前方案通过颜色标注标记标题层级，从而生成结构化笔记。

![annotation-note-example-1](docs/image.png)
![annotation-note-example-2](docs/image-1.png)

## 功能：AI 摘要

相关文件：

- zotero_actions/zotero_pdf_summary.js

流程：

1. 获取选中文献的 PDF 和元信息
2. 将 PDF 发送到 parse_server.py 进行解析与分片
3. 调用 LLM 执行摘要（stuff 或 map-reduce）
4. 将 markdown 转为 HTML
5. 写回 Zotero 笔记

![summary-example](https://qyzhang-obsidian.oss-cn-hangzhou.aliyuncs.com/20250124100826.png)

## 功能：语义问答

相关文件：

- zotero_actions/zotero_qa_simple.js
- zotero_actions/zotero_qa.js

语义问答目前支持两种模式：
1. 简单问答：将问题和选中相关内容直接发送给 LLM，获取答案。问题对象可能是：选中的文献、选中的PDF片段。
2. RAG问答：先检索相关内容，再将问题和检索结果发送给 LLM，获取答案。
检索手段包括：互联网检索，zotero库检索，文献片段语义检索等。

问答模式：

- 库级问答：检索相关条目，结合元信息和已有摘要后调用 LLM
- PDF 级问答：检索相关 PDF 片段后带上下文调用 LLM

## 功能：笔记导出与同步

相关文件：

- zotero_actions/zotero_export_note.js

导出后可在外部笔记系统中进行检索与复用。
可按你的工作流在脚本或配置中指定目标 key。

![note-export-example](docs/image3.png)

## 核心脚本索引

| 目录 | 脚本文件 | 作用 |
|------|----------|------|
| 根目录 | parse_server.py | PDF 解析与 markdown 转 HTML 的后端服务 |
| 根目录 | paper_summary.py | 论文摘要生成（map-reduce） |
| 根目录 | build_zotero_es_index.py | 构建 Elasticsearch 索引 |
| 根目录 | run_zotero_qa.py | 运行问答系统测试入口 |
| zotero_actions/ | zotero_pdf_summary.js | AI 论文摘要（获取 PDF → 解析 → LLM → 写回笔记） |
| zotero_actions/ | zotero_autoupdate_note.js | 标注转结构化笔记（颜色层级、自动更新） |
| zotero_actions/ | zotero_qa.js | 语义问答（RAG 检索 + LLM 回答） |
| zotero_actions/ | zotero_qa_simple.js | 简单问答（直接 LLM 问答） |
| zotero_actions/ | zotero_llm_qa.js | 基于 LLM 的问答交互 |
| zotero_actions/ | zotero_export_note.js | 笔记导出用于外部同步 |
| zotero_note_templates/ | zotero_note_template.js | 结构化笔记模板（颜色标记层级） |
| zotero_note_templates/ | zotero_merge_annoattaion_summary.js | 合并标注与 AI 摘要到笔记,暂时无用 |
| zotero_note_templates/ | zotero_note_template_mergeai.js | 合并 AI 摘要的笔记模板,暂时无用 |
| zotero_qa/ | main.py | QA 系统主模块 |
| zotero_qa/ | qa_agents.py | 问答 Agent（多智能体协作） |
| zotero_qa/ | search_es.py | Elasticsearch 语义检索 |
| zotero_qa/ | search_tools.py | 检索工具集（互联网/Zotero/语义） |
| zotero_qa/ | aliyun_embedding.py | 阿里云 Embedding 接口 |
| zotero_qa/ | document_splitter.py | 文档分片工具 |
| zotero_qa/ | zotero_search.py | Zotero 库检索接口 |
=======
2. Start the parser service:

```bash
python parse_server.py
```

Or run in background:

```bash
nohup python parse_server.py > parse_server.log 2>&1 &
```

3. Configure scripts/templates in Zotero plugins:

- Load action scripts into actions-tags
- Load note template into better-notes

4. Trigger scripts in Zotero according to your workflow.

## Configuration Guide

Main config file: config.json

- server.url: backend service endpoint for PDF parsing and markdown-to-html conversion
- server.timeout: request timeout in seconds
- llm.openaiBaseUrl: OpenAI-compatible API endpoint
- llm.modelName: model identifier
- llm.apiKey: LLM API key
- llm.temperature: generation temperature
- summary.chunkSize: chunk size for map-reduce summarization
- summary.chunkOverlap: overlap size between adjacent chunks
- summary.maxChunk: upper limit of chunks
- summary.only_link_file: set true when using Link to File workflows (for plugins like ZotMoov/ZotFile)
- summary.support_item_types: supported Zotero item types for summarization
- qa.saveColelctionKey: collection key where Q&A notes are saved (kept as-is for script compatibility)

Prompt templates are under prompt/:

- stuff_prompt.txt: single-chunk summarization
- map_prompt.txt: map phase for multi-chunk summarization
- reduce_prompt.txt: reduce phase for final merged summary
- qa_prompt.txt: Q&A prompt

## Feature: Annotation to Structured Notes

Files:

- zotero_note_template.js
- zotero_autoupdate_note.js

=======
2. Start the parser service:

```bash
python parse_server.py
```

Or run in background:

```bash
nohup python parse_server.py > parse_server.log 2>&1 &
```

3. Configure scripts/templates in Zotero plugins:

- Load action scripts into actions-tags
- Load note template into better-notes

4. Trigger scripts in Zotero according to your workflow.

## Configuration Guide

Main config file: config.json

- server.url: backend service endpoint for PDF parsing and markdown-to-html conversion
- server.timeout: request timeout in seconds
- llm.openaiBaseUrl: OpenAI-compatible API endpoint
- llm.modelName: model identifier
- llm.apiKey: LLM API key
- llm.temperature: generation temperature
- summary.chunkSize: chunk size for map-reduce summarization
- summary.chunkOverlap: overlap size between adjacent chunks
- summary.maxChunk: upper limit of chunks
- summary.only_link_file: set true when using Link to File workflows (for plugins like ZotMoov/ZotFile)
- summary.support_item_types: supported Zotero item types for summarization
- qa.saveColelctionKey: collection key where Q&A notes are saved (kept as-is for script compatibility)

Prompt templates are under prompt/:

- stuff_prompt.txt: single-chunk summarization
- map_prompt.txt: map phase for multi-chunk summarization
- reduce_prompt.txt: reduce phase for final merged summary
- qa_prompt.txt: Q&A prompt

## Feature: Annotation to Structured Notes

Files:

- zotero_note_template.js
- zotero_autoupdate_note.js

>>>>>>> origin/main
This feature extends Zotero's default annotation-to-note behavior by supporting hierarchical note generation.
A practical approach in this repo is to use color-coded annotations to mark heading levels.

![annotation-note-example-1](docs/image.png)
![annotation-note-example-2](docs/image-1.png)

## Feature: AI Summarization

File:

- zotero_pdf_summary.js

Process:

1. Get PDF and metadata from selected item
2. Send PDF to parse_server.py for parsing and chunking
3. Run LLM summarization (stuff or map-reduce)
4. Convert markdown to HTML
5. Save result to item note

![summary-example](https://qyzhang-obsidian.oss-cn-hangzhou.aliyuncs.com/20250124100826.png)

## Feature: Semantic Q&A

File:

- zotero_qa.js

Q&A modes:

- Library-level Q&A: search relevant items, combine metadata and existing summaries, then query LLM
- PDF-level Q&A: retrieve relevant PDF chunks and ask LLM with local context

## Feature: Note Export and Sync

File:

- zotero_export_note.js

Exporting notes makes them easier to search and reuse in external note systems.
Configure the target key in script/config as needed for your workflow.

![note-export-example](docs/image3.png)

## Core Script Reference

| Script File | Purpose |
|-------------|---------|
| zotero_pdf_summary.js | Generate AI summaries for selected papers |
| zotero_qa.js | Perform LLM Q&A for library/PDF context |
| zotero_note_template.js | Build structured notes from annotations |
| zotero_autoupdate_note.js | Periodically update notes from template output |
| zotero_export_note.js | Export notes for external synchronization |
| parse_server.py | Backend service for PDF parsing and markdown-to-html |

## Notes

- This repository focuses on workflow scripts and orchestration.
- You can adopt scripts independently based on your own Zotero setup.
<<<<<<< HEAD
>>>>>>> 40bfc43 (update README)
=======
>>>>>>> origin/main
