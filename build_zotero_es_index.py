#!/usr/bin/env python
# -*- encoding=utf8 -*-

"""
构建Zotero文档的Elasticsearch索引

此脚本使用pyzotero遍历Zotero库中的文档，利用阿里云嵌入式模型生成向量表示，
然后将文档及其向量存储到Elasticsearch中，用于高效的语义搜索。

使用方法:
    python build_zotero_es_index.py --config config.json
"""

import os
import sys
import argparse
import json
import logging
import time
from datetime import datetime
from typing import Dict, List, Any, Optional, Union
import numpy as np
import requests
from tqdm import tqdm

# 添加项目目录到路径
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))
from zotero_qa.search_es import ElasticsearchClient

# 导入阿里云嵌入函数
from zotero_qa.aliyun_embedding import get_text_vec_aliyun

# 导入文档切片工具
from zotero_qa.document_splitter import DocumentSplitter

# 设置日志格式，包含文件名、函数名和行号
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levellevel)s - [%(filename)s:%(funcName)s:%(lineno)d] - %(message)s",
    handlers=[logging.FileHandler("zotero_es_index.log"), logging.StreamHandler()],
)
logger = logging.getLogger(__name__)


def load_config(config_path: str) -> Dict[str, Any]:
    """
    加载配置文件

    Args:
        config_path: 配置文件路径

    Returns:
        配置字典
    """
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            config = json.load(f)
        return config
    except Exception as e:
        logger.error(f"加载配置文件失败: {str(e)}")
        raise


def get_zotero_items(
    zotero_api_key: str,
    zotero_library_id: str,
    library_type: str = "user",
    item_types: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """
    从Zotero库获取文档条目

    Args:
        zotero_api_key: Zotero API密钥
        zotero_library_id: Zotero库ID
        library_type: 库类型 ('user' 或 'group')
        item_types: 要检索的项目类型列表

    Returns:
        Zotero项目列表
    """
    try:
        from pyzotero import zotero

        zot = zotero.Zotero(library_id="000000", library_type="user", local=True)

        # 获取所有顶级项目
        items = []

        # 获取条目总数
        total_items = zot.count_items()
        logger.info(f"Zotero库中共有 {total_items} 个条目")

        # 分批获取条目
        start = 0
        limit = 100
        with tqdm(total=total_items, desc="获取Zotero条目") as pbar:
            while start < total_items:
                batch = zot.items(start=start, limit=limit, itemType="-attachment")

                # 过滤项目类型
                if item_types:
                    batch = [
                        item
                        for item in batch
                        if item["data"].get("itemType") in item_types
                    ]

                items.extend(batch)
                start += limit
                pbar.update(min(limit, total_items - pbar.n))

                if len(items) >= 10:
                    break

        logger.info(f"成功获取 {len(items)} 个匹配条件的Zotero条目")
        return items

    except Exception as e:
        logger.error(f"获取Zotero条目失败: {str(e)}")
        import traceback

        logger.error(traceback.format_exc())
        return []


def get_zotero_item_content(zot, item_data: Dict[str, Any]) -> str:
    children = zot.children(item_data["key"])
    attachments = [
        child for child in children if child["data"].get("itemType") == "attachment"
    ]
    content = ""
    for attachment in attachments:
        if attachment["data"].get("contentType") == "application/pdf":
            path = attachment["links"]["enclosure"]["href"][7:]
            import urllib.parse

            path = urllib.parse.unquote(path)
            print(path)
            content = extract_text_from_pdf(path)
            input(f"get pdf {path} content:{len(content)}")
            if not content:
                break
    if not content:
        for attachment in attachments:
            if attachment["data"].get("contentType") == "text/html":
                path = attachment["links"]["enclosure"]["href"]
                path = urllib.parse.unquote(path)
                # content = extract_text_from_html(path)
                if not content:
                    break
    return content


def extract_text_from_pdf(pdf_path: str) -> str:
    """
    从PDF文件中提取文本

    Args:
        pdf_path: PDF文件路径

    Returns:
        提取的文本
    """
    from langchain_community.document_loaders import PyPDFLoader

    loader = PyPDFLoader(pdf_path)
    pages = loader.load()

    references_pages = []
    for k, page in enumerate(pages):
        if "References" in page.page_content:
            references_pages.append(k)
    if len(references_pages) >= 1 and references_pages[-1] > len(pages) / 2:
        pages = pages[: references_pages[-1] + 1]

    if len(pages) >= 50:
        pages = pages[:50]

    full_text = "\n".join(page.page_content for page in pages)
    return full_text


def extract_text_from_zotero_item(zot, item: Dict[str, Any]) -> Dict[str, Any]:
    """
    从Zotero条目中提取信息和文本

    Args:
        zot: Zotero客户端实例
        item: Zotero条目

    Returns:
        包含提取信息的字典
    """
    item_data = item["data"]
    key = item["key"]

    # 基本信息
    extracted = {
        "key": key,
        "title": item_data.get("title", ""),
        "abstract": item_data.get("abstractNote", ""),
        "date": item_data.get("date", ""),
        "creators": item_data.get("creators", []),
        "tags": [tag["tag"] for tag in item_data.get("tags", [])],
        "item_type": item_data.get("itemType", ""),
        "content": "",
        "notes": [],
    }

    # 尝试获取PDF内容
    extracted["content"] = get_zotero_item_content(zot, item_data)

    # 获取笔记
    try:
        notes = [
            note for note in zot.children(key) if note["data"].get("itemType") == "note"
        ]
        for note in notes:
            note_text = note["data"].get("note", "")
            if note_text:
                # 移除HTML标签
                from bs4 import BeautifulSoup

                soup = BeautifulSoup(note_text, "html.parser")
                clean_text = soup.get_text(separator=" ", strip=True)
                extracted["notes"].append(clean_text)
    except Exception as e:
        logger.error(f"获取笔记失败: {str(e)}")

    return extracted


def prepare_item_for_indexing(item_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    准备条目数据用于ES索引

    Args:
        item_data: 条目数据

    Returns:
        格式化用于索引的数据
    """
    # 将多个字段组合成一个文本，用于生成嵌入
    text_for_embedding = (
        f"标题: {item_data['title']}\n" f"摘要: {item_data['abstract']}\n"
    )

    # 添加笔记 TODO: 笔记应该不用加吧
    if item_data["notes"]:
        notes_text = "\n".join(item_data["notes"])
        text_for_embedding += f"笔记: {notes_text}\n"

    # 添加部分内容(如果太长，截断)
    if item_data["content"]:
        # 截取前10000个字符的内容
        content_preview = item_data["content"][:10000]
        text_for_embedding += f"内容预览: {content_preview}"
    text_for_embedding = text_for_embedding.strip()[:30000]  # 限制长度
    # 格式化创建者
    creators = []
    for creator in item_data["creators"]:
        name_parts = []
        if creator.get("firstName"):
            name_parts.append(creator["firstName"])
        if creator.get("lastName"):
            name_parts.append(creator["lastName"])
        if name_parts:
            creators.append(" ".join(name_parts))

    # 返回格式化的文档
    return {
        "zotero_key": item_data["key"],
        "title": item_data["title"],
        "abstract": item_data["abstract"],
        "content": item_data["content"],
        "date": item_data["date"],
        "creators": creators,
        "tags": item_data["tags"],
        "item_type": item_data["item_type"],
        "notes": item_data["notes"],
        "text_for_embedding": text_for_embedding,
        "indexed_at": datetime.now().isoformat(),
    }


def prepare_chunk_for_indexing(
    item_data: Dict[str, Any], chunk: Dict[str, Any], parent_id: str, chunk_idx: int
) -> Dict[str, Any]:
    """
    准备文档切片数据用于ES索引

    Args:
        item_data: 原始条目数据
        chunk: 文档切片
        parent_id: 父文档ID
        chunk_idx: 切片索引

    Returns:
        格式化用于索引的切片数据
    """
    # 从切片中提取内容和元数据
    content = chunk["content"]
    metadata = chunk["metadata"]

    # 创建用于生成嵌入的文本
    # 为切片添加元数据上下文，以便更好地理解和检索
    text_for_embedding = f"标题: {item_data['title']}\n" f"切片内容: {content}\n"

    # 如果切片有标题（如章节标题），添加到嵌入文本中
    if "title" in metadata:
        text_for_embedding = f"切片标题: {metadata['title']}\n" + text_for_embedding

    # 准备切片文档
    chunk_doc = {
        "zotero_key": item_data["key"],
        "parent_id": parent_id,
        "chunk_id": chunk_idx,
        "title": item_data["title"],
        "content": content,
        "chunk_type": metadata["chunk_type"],
        "chunk_title": metadata.get("title", ""),
        "start_char": metadata["start_char"],
        "end_char": metadata["end_char"],
        "creators": item_data["creators"],
        "tags": item_data["tags"],
        "item_type": item_data["item_type"],
        "text_for_embedding": text_for_embedding,
        "indexed_at": datetime.now().isoformat(),
        "is_chunk": True,  # 标记为切片文档
    }

    return chunk_doc


def insert_es(
    es_client: ElasticsearchClient,
    item: Dict[str, Any],
    vector: Optional[List[float]] = None,
) -> Dict[str, Any]:
    """
    将文档插入Elasticsearch

    Args:
        es_client: Elasticsearch客户端
        item: 要插入的文档
        vector: 文档的向量表示

    Returns:
        Elasticsearch响应
    """
    try:
        # 获取文档ID
        doc_id = None
        if "is_chunk" in item and item["is_chunk"]:
            # 对于切片，使用父文档ID和切片ID构建唯一标识
            doc_id = f"zotero_{item['zotero_key']}_chunk_{item['chunk_id']}"
        else:
            # 对于主文档，使用Zotero键作为ID
            doc_id = f"zotero_{item['zotero_key']}"

        # 插入文档
        response = es_client.insert_document(
            document=item, doc_id=doc_id, vector=vector
        )

        return response
    except Exception as e:
        logger.error(f"插入Elasticsearch失败: {str(e)}")
        raise


def insert_zotero_item(
    item,
    zot,
    es_client,
    document_splitter,
    config,
    vector_dim,
    split_enabled,
    split_method,
    split_params,
):
    """
    处理单个Zotero条目并将其插入到Elasticsearch中

    Args:
        item: Zotero条目数据
        zot: Zotero客户端实例
        es_client: Elasticsearch客户端实例
        document_splitter: 文档切片器实例
        config: 配置信息
        vector_dim: 向量维度
        split_enabled: 是否启用文档切片
        split_method: 文档切片方法
        split_params: 文档切片参数

    Returns:
        插入状态，True表示成功，False表示失败
    """
    try:
        # 从条目中提取文本
        item_data = extract_text_from_zotero_item(zot, item)

        # 准备索引数据
        es_item = prepare_item_for_indexing(item_data)
        parent_id = f"zotero_{es_item['zotero_key']}"

        # 生成主文档的嵌入向量并索引
        main_vector = None
        # TODO：这个设置到配置里
        max_length = 8192  # 模型的最大处理长度
        aliyun_config = config.get("aliyun", {})
        if config.get("use_embeddings", True):
            text_for_embedding = es_item["text_for_embedding"]
            # 限制长度以避免超出嵌入模型限制
            """
            main_vector = get_text_vec_aliyun(
                text=text_for_embedding[:max_length],
                dimensions=vector_dim,
                model=aliyun_config.get("embedding_model", "text-embedding-v3"),
            )"""

        # 标记为非切片文档
        es_item["is_chunk"] = False

        # 插入主文档到Elasticsearch
        # insert_es(es_client, es_item, main_vector)
        logger.info(
            f"split_enabled = {split_enabled}, content = {item_data['content']}, item={item_data}"
        )
        # 处理文档切片
        # 需要考虑切片对象； note需要不需要单独索引
        if split_enabled and (item_data["content"] or item_data["notes"]):
            logger.info(f"对文档 '{es_item['title']}' 进行切片...")
            # 切分存在问题
            chunks = sum(
                [
                    document_splitter.split_text(
                        text, method=split_method, **split_params
                    )
                    for text in [item_data["content"]]
                    if len(text) > 3000
                ],
                [],
            )
            logger.info(
                f"生成了 {len(chunks)} 个切片, conetent={len(item_data['content'])}"
            )
            input("xxxx")
            # 处理每个切片
            with tqdm(
                total=len(chunks), desc="处理文档切片", leave=False
            ) as chunk_pbar:
                for i, chunk in enumerate(chunks)[:3]:
                    # 准备切片数据
                    chunk_doc = prepare_chunk_for_indexing(
                        item_data, chunk, parent_id, i
                    )
                    # 为切片生成嵌入向量
                    chunk_vector = None
                    if config.get("use_embeddings", True):
                        chunk_text = chunk_doc["text_for_embedding"]
                        """
                        chunk_vector = get_text_vec_aliyun(
                            text=chunk_text[:max_length],
                            dimensions=vector_dim,
                            model=aliyun_config.get("embedding_model", "text-embedding-v3"),
                        )"""

                    # 插入切片到Elasticsearch
                    # insert_es(es_client, chunk_doc, chunk_vector)
                    chunk_pbar.update(1)

        return True

    except Exception as e:
        logger.error(f"处理条目时出错: {str(e)}")
        import traceback

        logger.error(traceback.format_exc())
        return False


def main():
    # 简化为只有一个配置文件参数
    parser = argparse.ArgumentParser(description="构建Zotero文档的Elasticsearch索引")
    parser.add_argument(
        "--config", type=str, default="config.json", help="配置文件路径"
    )
    args = parser.parse_args()

    # 加载配置
    config = load_config(args.config)
    zotero_config = config.get("zotero", {})
    indexing_config = config.get("zotero_indexing", {})

    # 初始化文档切片器
    document_splitter = DocumentSplitter()

    # 获取切片配置
    split_config = indexing_config.get("document_splitting", {})
    split_enabled = split_config.get("enabled", False)
    split_method = split_config.get("method", "chunk")

    # 获取切片参数
    split_params = {
        "chunk_size": split_config.get("chunk_size", 1000),
        "overlap": split_config.get("chunk_overlap", 100),
        "min_paragraph_length": split_config.get("min_paragraph_length", 200),
        "section_patterns": split_config.get("section_patterns", None),
    }

    logger.info(
        f"文档切片配置: 启用={split_enabled}, 方法={split_method}, 参数={split_params}"
    )

    # 初始化Elasticsearch客户端
    es_config = config.get("elasticsearch", {})
    vector_dim = es_config.get("vector_dim", 1024)

    # 创建自定义映射
    mapping = {
        "mappings": {
            "properties": {
                "zotero_key": {"type": "keyword"},
                "parent_id": {"type": "keyword"},  # 父文档ID
                "chunk_id": {"type": "integer"},  # 切片ID
                "is_chunk": {"type": "boolean"},  # 是否为切片
                "chunk_type": {"type": "keyword"},  # 切片类型
                "chunk_title": {"type": "text"},  # 切片标题
                "start_char": {"type": "integer"},  # 起始位置
                "end_char": {"type": "integer"},  # 结束位置
                "title": {
                    "type": "text",
                    "analyzer": "standard",
                    "fields": {"keyword": {"type": "keyword"}},
                },
                "abstract": {"type": "text", "analyzer": "standard"},
                "content": {"type": "text", "analyzer": "standard"},
                "date": {
                    "type": "date",
                    "format": "yyyy-MM-dd||yyyy||epoch_millis",
                    "ignore_malformed": True,
                },
                "creators": {
                    "type": "text",
                    "fields": {"keyword": {"type": "keyword"}},
                },
                "tags": {"type": "keyword"},
                "item_type": {"type": "keyword"},
                "notes": {"type": "text", "analyzer": "standard"},
                "text_for_embedding": {"type": "text", "analyzer": "standard"},
                "indexed_at": {"type": "date"},
                "vector": {
                    "type": "dense_vector",
                    "dims": vector_dim,
                    "index": True,
                    "similarity": "cosine",
                },
            }
        },
        "settings": {
            "number_of_shards": 1,
            "number_of_replicas": 0,
            "analysis": {
                "analyzer": {"standard": {"type": "standard", "max_token_length": 255}}
            },
        },
    }

    # 初始化Elasticsearch客户端，传入自定义映射
    es_client = ElasticsearchClient(
        hosts=es_config.get("host", "http://localhost:9200"),
        index_name=es_config.get("index", "zotero_papers"),
        vector_dim=vector_dim,
        recreate_index=indexing_config.get("recreate_index", False),
        mapping=mapping,  # 使用自定义映射
    )

    # 初始化pyzotero客户端
    zotero_config = config.get("zotero", {})
    from pyzotero import zotero

    zot = zotero.Zotero(library_id="000000", library_type="user", local=True)

    # 获取Zotero条目，使用配置文件中的item_types
    items = get_zotero_items(
        zotero_api_key=zotero_config.get("api_key", ""),
        zotero_library_id=zotero_config.get("library_id", ""),
        library_type=zotero_config.get("library_type", "user"),
        item_types=indexing_config.get(
            "item_types",
            ["journalArticle", "book", "bookSection", "conferencePaper", "thesis"],
        ),
    )

    # 限制处理数量
    limit = indexing_config.get("item_num_limit", 0)
    if limit > 0 and limit < len(items):
        items = items[:limit]
        logger.info(f"已限制处理数量为 {limit} 个条目")

    # 处理项目并索引
    logger.info(f"开始处理和索引 {len(items)} 个Zotero条目")

    # 设置环境变量用于aliyun_embedding
    aliyun_config = config.get("aliyun", {})

    # 使用封装的函数来处理每个条目
    success_count = 0
    with tqdm(total=len(items), desc="索引文档进度") as doc_pbar:
        for item in items:
            # 处理单个Zotero条目并索引
            success = insert_zotero_item(
                item=item,
                zot=zot,
                es_client=es_client,
                document_splitter=document_splitter,
                config=config,
                vector_dim=vector_dim,
                split_enabled=split_enabled,
                split_method=split_method,
                split_params=split_params,
            )
            if success:
                success_count += 1
            doc_pbar.update(1)

    # 刷新索引
    es_client.es.indices.refresh(index=es_client.index_name)

    # 显示索引统计信息
    count = es_client.es.count(index=es_client.index_name)
    logger.info(
        f"索引完成。成功处理 {success_count}/{len(items)} 个条目。{es_client.index_name} 索引中共有 {count['count']} 个文档。"
    )

    # 如果启用了切片，显示切片统计
    if split_enabled:
        chunk_count = es_client.es.count(
            index=es_client.index_name, body={"query": {"term": {"is_chunk": True}}}
        )
        parent_count = es_client.es.count(
            index=es_client.index_name, body={"query": {"term": {"is_chunk": False}}}
        )
        logger.info(
            f"其中，主文档 {parent_count['count']} 个，文档切片 {chunk_count['count']} 个"
        )


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        logger.info("程序被用户中断")
    except Exception as e:
        logger.error(f"程序执行出错: {str(e)}")
        import traceback

        logger.error(traceback.format_exc())
