English | [中文](README.md)

# Zotero AI Workflow

Zotero AI Workflow is an automated toolset for Zotero literature reading and note management. It combines Zotero plugins, Python services, and LLM APIs to support:

- AI paper summarization
- Library-level and PDF-level Q&A
- Structured notes from annotations
- Note export and external sync

Core architecture: some action (item added/opened/closed) → zotero-actions triggers script → call Python backend / zotero-better-notes template / LLM API etc. → write back to note

This repository is for users who want to build a flexible Zotero workflow on their own.

For a GUI plugin, try zotero-AI-Butler.

## Zotero Workflow Overview

A common workflow is as follows:

- Item added
  - Auto: Add To-Read tag
  - Manual: Add project-specific tags
- Item opened
  - Auto: Generate AI summary and write to note
- Item reading
  - Manual: Add PDF annotations
  - Interactive: Ask LLM questions and write answers to note
- Item closed or periodic maintenance
  - Auto: Generate or update structured notes from annotations
  - Auto: Export notes for external sync

## Environment & Plugins

Required components:

- Zotero
- [zotero-actions-tags](https://github.com/windingwind/zotero-actions-tags)
- [zotero-better-notes](https://github.com/windingwind/zotero-better-notes)
- Python 3.10+
- `pip install .` to install dependencies

## Quick Start

1. Create and fill in the config file:

```bash
cp config_example.json config.json
```

Required fields:

- server.url
- llm.openaiBaseUrl
- llm.modelName
- llm.apiKey

2. Start the parser service:

```bash
nohup python parse_server.py > parse_server.log 2>&1 &
```

You can add this to your bash_profile for auto-start on login.

3. Configure scripts and templates in Zotero plugins:

- In actions-tags, load action scripts from ./zotero_actions/
![actions-tags-config](docs/img-actions-tags-config.png)

- In better-notes, load note templates from ./zotero_note_templates/

4. Trigger the corresponding scripts in Zotero according to your workflow.

## Configuration

Main config file: config.json

- server.url: Backend service address for PDF parsing and markdown-to-HTML conversion
- server.timeout: Request timeout (seconds)
- llm.openaiBaseUrl: OpenAI-compatible API address
- llm.modelName: Model name
- llm.apiKey: Model API key
- llm.temperature: Generation temperature
- summary.chunkSize: Chunk size for map-reduce
- summary.chunkOverlap: Overlap between adjacent chunks
- summary.maxChunk: Maximum number of chunks
- summary.only_link_file: Set to true if using Link to File workflow (e.g. ZotMoov/ZotFile)
- summary.support_item_types: Item types supported for summary generation
- qa.saveColelctionKey: Collection key for saving Q&A results (keep naming for compatibility)

Prompt templates are located in the prompt/ directory:

- stuff_prompt.txt: Single-chunk summary
- map_prompt.txt: Map phase of multi-chunk summary
- reduce_prompt.txt: Reduce phase of multi-chunk summary
- qa_prompt.txt: Q&A prompt

## Feature: PDF Annotations to Structured Notes

Related files:

- Template: zotero_note_templates/zotero_note_template.js
- Action script: zotero_actions/zotero_autoupdate_note.js

This feature adds hierarchical structure support on top of Zotero's native annotation-to-note capability. The current solution uses annotation colors to mark heading levels, generating structured notes.

![annotation-note-example-1](docs/image.png)
![annotation-note-example-2](docs/image-1.png)

## Feature: AI Summary

Related files:

- zotero_actions/zotero_pdf_summary.js

Workflow:

1. Get the PDF and metadata of the selected item
2. Send the PDF to parse_server.py for parsing and chunking
3. Call LLM for summarization (stuff or map-reduce)
4. Convert markdown to HTML
5. Write back to Zotero note

![summary-example](https://qyzhang-obsidian.oss-cn-hangzhou.aliyuncs.com/20250124100826.png)

## Feature: Semantic Q&A

Related files:

- zotero_actions/zotero_qa_simple.js
- zotero_actions/zotero_qa.js

Semantic Q&A currently supports two modes:
1. Simple Q&A: Send the question and selected content directly to LLM to get an answer. Question targets can be: selected items, selected PDF excerpts.
2. RAG Q&A: First retrieve relevant content, then send the question and retrieval results to LLM for an answer. Retrieval methods include: web search, Zotero library search, semantic search on document excerpts, etc.

Q&A modes:

- Library-level Q&A: Search for relevant items, combine metadata and existing summaries, then call LLM
- PDF-level Q&A: Search for relevant PDF excerpts, then call LLM with context

## Feature: Note Export & Sync

Related files:

- zotero_actions/zotero_export_note.js

Exported notes can be searched and reused in external note-taking systems.
You can specify the target key in the script or config according to your workflow.

![note-export-example](docs/image3.png)

## Core Script Index

| Directory | Script File | Description |
|-----------|-------------|-------------|
| Root | parse_server.py | Backend service for PDF parsing and markdown-to-HTML conversion |
| Root | paper_summary.py | Paper summary generation (map-reduce) |
| Root | build_zotero_es_index.py | Build Elasticsearch index |
| Root | run_zotero_qa.py | Q&A system test entry point |
| zotero_actions/ | zotero_pdf_summary.js | AI paper summary (get PDF → parse → LLM → write back to note) |
| zotero_actions/ | zotero_autoupdate_note.js | Structured notes from annotations (color hierarchy, auto-update) |
| zotero_actions/ | zotero_qa.js | Semantic Q&A (RAG retrieval + LLM answer) |
| zotero_actions/ | zotero_qa_simple.js | Simple Q&A (direct LLM Q&A) |
| zotero_actions/ | zotero_llm_qa.js | LLM-based Q&A interaction |
| zotero_actions/ | zotero_export_note.js | Note export for external sync |
| zotero_note_templates/ | zotero_note_template.js | Structured note template (color-marked hierarchy) |
| zotero_note_templates/ | zotero_merge_annoattaion_summary.js | Merge annotations with AI summary (currently unused) |
| zotero_note_templates/ | zotero_note_template_mergeai.js | Note template that merges AI summary (currently unused) |
| zotero_qa/ | main.py | Q&A system main module |
| zotero_qa/ | qa_agents.py | Q&A Agent (multi-agent collaboration) |
| zotero_qa/ | search_es.py | Elasticsearch semantic search |
| zotero_qa/ | search_tools.py | Search tools (web/Zotero/semantic) |
| zotero_qa/ | aliyun_embedding.py | Aliyun Embedding API |
| zotero_qa/ | document_splitter.py | Document splitting tool |
| zotero_qa/ | zotero_search.py | Zotero library search API |
