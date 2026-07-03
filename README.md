English | [中文](README_zh.md)

# Zotero AI Workflow

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
