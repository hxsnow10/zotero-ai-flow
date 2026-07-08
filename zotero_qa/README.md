# Zotero QA 子系统

基于 **AutoGen 多智能体框架** 的 Python 问答子系统，为 Zotero 提供 RAG（检索增强生成）能力。与 Zotero 侧 JS 脚本互补——JS 脚本负责 UI 交互和笔记写入，Python 端负责搜索与智能体编排。

## 架构概览

```
用户问题
  │
  ▼
ZoteroQASystem (qa_agents.py)   ← AutoGen 多智能体编排
  │
  ├─ search_zotero()       → ZoteroSearchTool (zotero_search.py)     ← pyzotero API
  ├─ search_elasticsearch() → ElasticsearchClient  (search_es.py)    ← 语义/关键词检索
  ├─ search_arxiv()        → ArxivSearchTool     (web_search/)       ← arxiv 学术搜索
  └─ search_semantic()     → SemanticScholarAPI  (web_search/)       ← Semantic Scholar
        │
        ▼
    AliYunEmbedding (aliyun_embedding.py)  ← 文本向量化
    DocumentSplitter (document_splitter.py) ← 文档切片
```

## 模块说明

| 文件 | 功能 |
|------|------|
| **main.py** | 命令行入口，解析参数 → 初始化 `ZoteroQASystem` → 启动聊天 |
| **qa_agents.py** | 核心：基于 AutoGen 的多智能体问答系统。定义 planner / searcher_and_summary / writer 三个 agent，通过 RoundRobinGroupChat 轮流协作 |
| **search_tools.py** | 统一搜索工具层，封装三种搜索为 `FunctionTool`，供 AutoGen Agent 调用 |
| **search_es.py** | Elasticsearch 客户端，支持全文检索 + 向量语义检索（kNN），管理索引的创建/写入/查询 |
| **zotero_search.py** | 通过 pyzotero 库访问 Zotero 在线 API，搜索库内文献元信息 |
| **aliyun_embedding.py** | 阿里云 Embedding 接口（OpenAI 兼容），将文本转为向量，用于语义搜索 |
| **document_splitter.py** | 文档切片工具，支持按固定大小(chunk)、段落(paragraph)、章节(section)三种策略 |
| **web_search/arxiv_search.py** | arxiv API 封装，搜索学术论文 |
| **web_search/semantic_scholar.py** | Semantic Scholar API 封装，含引用网络搜索 |

## 关键设计

### 三种搜索源

| 搜索源 | 工具类 | 数据范围 | 适用场景 |
|--------|--------|----------|----------|
| Zotero 在线库 | `ZoteroSearchTool` | 用户 Zotero 云端文献 | 查询已有文献元信息 |
| Elasticsearch | `ElasticsearchClient` | 本地已索引的文献片段 | 语义搜索、段落级检索 |
| 互联网学术 | `ArxivSearchTool` / `SemanticScholarAPI` | 全网学术论文 | 扩展知识、获取新文献 |

### 多 Agent 编排

使用 AutoGen 的多智能体协作模式（RoundRobinGroupChat）：

1. **planner**：接收用户问题，分解研究任务，调度给 specialist agent
2. **searcher_and_summary**：执行搜索（Zotero / ES / arxiv），并对结果进行初步总结
3. **writer**：整理研究成果，生成最终回答报告

Agent 间通过 `handoff` 机制流转控制权，`TextMentionTermination("APPROVE")` 终止对话。

### 向量语义搜索

解决了 Zotero 自带关键词搜索的两个问题：
1. 缺少语义匹配能力
2. 无法返回段落级 offset/上下文

使用阿里云 Embedding 模型生成文本向量，存入 Elasticsearch 后进行 kNN 语义检索，实现细粒度的段落级搜索，避免全量文本输入带来的 token 浪费。

### 文档切片

`DocumentSplitter` 提供三种切片策略：
- **chunk**：按固定大小切片，适合通用场景
- **paragraph**：按段落边界切片，保留语义完整性
- **section**：按章节标题正则匹配切片，适合结构化文档

## 使用方式

```bash
# 交互式问答
python zotero_qa/main.py

# 单次查询
python zotero_qa/main.py --query "查找关于机器学习在医疗领域的最近研究"

# 指定配置文件
python zotero_qa/main.py --config my_config.json

# 调试模式
python zotero_qa/main.py --query "xxx" --debug
```
