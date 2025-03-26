#!/usr/bin/env python
# -*- encoding=utf8
# @author      : xiahong
# @file        : search_es.py
# @created     : 2025-03-24 09:50:58

"""
Example:
    python search_es.py
    python search_es.py --vector_search --with_vector
"""

import sys
import argparse
import os
import json
from elasticsearch import Elasticsearch
from elasticsearch.helpers import bulk
import logging
from typing import Dict, List, Any, Optional, Union

# 更新日志格式，包含文件名、函数名和行号
logging.basicConfig(
    level=logging.WARNING,
    format='%(asctime)s - %(name)s - %(levelname)s - [%(filename)s:%(funcName)s:%(lineno)d] - %(message)s'
)
logger = logging.getLogger(__name__)

# Elasticsearch客户端类
# zotero自带的搜索存在几个问题：1）缺少语义搜索  2）没法返回匹配的offset/上下文
# 缺少细粒度的段落级别的搜索会导致LLM的输入非常大，成本太大。
# 为了解决这些问题，所以我重建一个基于Elasticsearch的搜索引擎
# search与insert需要暴露出来web接口，方便zotero脚本调用
# 还需要一个后端建库的脚本，用于将zotero的文献信息导入到es中

class ElasticsearchClient:
    """Generic Elasticsearch client for document indexing and searching."""
    
    def __init__(self, 
                hosts: Union[str, List[str]] = "http://localhost:9200", 
                index_name: str = "documents",
                username: Optional[str] = None, 
                password: Optional[str] = None,
                timeout: int = 30,
                vector_dim: int = 1034,
                recreate_index: bool = False,
                mapping: Optional[Dict] = None):  # 添加映射参数
        """
        Initialize Elasticsearch client.
        
        Args:
            hosts: Elasticsearch hosts (string or list)
            index_name: Name of the index to use
            username: Optional username for authentication
            password: Optional password for authentication
            timeout: Connection timeout in seconds
            vector_dim: Dimension of document vectors (default: 1024 for BERT-like models)
            recreate_index: If True, delete and recreate the index if it exists
            mapping: Optional custom mapping to use when creating or recreating the index
        """
        self.hosts = hosts
        self.index_name = index_name
        self.vector_dim = vector_dim
        self.recreate_index = recreate_index
        self.custom_mapping = mapping  # 存储自定义映射
        
        # Connection settings
        conn_params = {
            'hosts': hosts,
            'timeout': timeout,
            'retry_on_timeout': True,
            'max_retries': 3
        }
        
        # Add authentication if provided
        if username and password:
            conn_params['http_auth'] = (username, password)
        
        try:
            self.es = Elasticsearch(**conn_params)
            # 验证连接
            info = self.es.info()
            logger.info(f"Connected to Elasticsearch: {info['version']['number']}")
            
            # 如果设置了重建索引标志，且索引存在，则删除索引
            if self.recreate_index and self.es.indices.exists(index=self.index_name):
                # 谨慎处理删除
                logger.info(f"Deleting existing index '{self.index_name}' for recreation...")
                self.es.indices.delete(index=self.index_name)
                logger.warning(f"Index '{self.index_name}' deleted successfully.")
                
            # 如果提供了自定义映射，立即创建新索引
            if not self.es.indices.exists(index=self.index_name) and self.custom_mapping:
                logger.warning(f"Creating index '{self.index_name}' with custom mapping...")
                self.create_index(mapping=self.custom_mapping)
                
        except Exception as e:
            raise ConnectionError(f"Cannot connect to Elasticsearch at {hosts}: {str(e)}")
    
    def create_index(self, mapping: Optional[Dict] = None) -> bool:
        """
        Create index with optional mapping.
        
        Args:
            mapping: Optional index mapping
            
        Returns:
            Boolean indicating success
        """
        if self.es.indices.exists(index=self.index_name):
            logger.info(f"Index {self.index_name} already exists")
            return True
        
        # 使用传入的映射，如果没有则使用实例化时提供的自定义映射，如果也没有则使用默认映射
        actual_mapping = mapping or self.custom_mapping
        
        # 默认映射，如果未提供自定义映射
        if actual_mapping is None:
            return False
        try:
            self.es.indices.create(index=self.index_name, body=actual_mapping)
            logger.info(f"Created index: {self.index_name}")
            return True
        except Exception as e:
            logger.error(f"Error creating index: {str(e)}")
            return False
    
    def insert_document(self, document: Dict[str, Any], doc_id: Optional[str] = None, vector: Optional[List[float]] = None) -> Dict:
        """
        Insert a single document into the index.
        
        Args:
            document: Dictionary containing document data
            doc_id: Optional document ID
            vector: Optional document vector embedding
            
        Returns:
            Response from Elasticsearch
        """
        # 克隆文档避免修改原始数据
        doc_to_insert = document.copy()
        
        # 如果提供了向量，添加到文档
        if vector is not None:
            doc_to_insert["vector"] = vector
        
        try:
            return self.es.index(index=self.index_name, id=doc_id, document=doc_to_insert)
        except Exception as e:
            logger.error(f"Error inserting document: {str(e)}")
            raise
    
    def bulk_insert(self, documents: List[Dict[str, Any]], vectors: Optional[List[List[float]]] = None) -> Dict:
        """
        Insert multiple documents in bulk.
        
        Args:
            documents: List of dictionaries containing document data
            vectors: Optional list of document vectors (same length as documents)
            
        Returns:
            Bulk operation results
        """
        if vectors and len(vectors) != len(documents):
            raise ValueError("Number of vectors must match number of documents")
        
        actions = []
        for i, doc in enumerate(documents):
            # 克隆文档避免修改原始数据
            doc_with_vector = doc.copy()
            
            # 如果提供了向量，添加到文档
            if vectors and i < len(vectors):
                doc_with_vector["vector"] = vectors[i]
            
            actions.append({
                "_index": self.index_name,
                "_id": doc.get("id", None),
                "_source": doc_with_vector
            })
        
        try:
            return bulk(self.es, actions)
        except Exception as e:
            logger.error(f"Error in bulk insert: {str(e)}")
            raise
    
    def search(self, 
              query: Optional[str] = None,
              vector: Optional[List[float]] = None, 
              fields: Optional[List[str]] = None, 
              filters: Optional[Dict] = None, 
              size: int = 10, 
              from_: int = 0) -> Dict:
        """
        Search documents by query and optional filters, with optional vector similarity.
        
        Args:
            query: Optional search query string
            vector: Optional vector for similarity search
            fields: List of fields to search in, defaults to all
            filters: Dictionary of field-value pairs for filtering
            size: Number of results to return
            from_: Starting offset for pagination
            
        Returns:
            Search results
        """
        # 准备过滤条件
        filter_conditions = []
        if filters:
            for field, value in filters.items():
                if isinstance(value, list):
                    filter_conditions.append({"terms": {field: value}})
                else:
                    filter_conditions.append({"term": {field: value}})
        
        # 如果同时提供文本查询和向量查询，使用组合查询
        if query and vector:
            # 文本查询部分
            if not fields:
                text_query = {"query_string": {"query": query}}
            else:
                text_query = {"multi_match": {"query": query, "fields": fields}}
            
            # 尝试使用KNN查询
            try:
                # Elasticsearch 8.x KNN 查询
                body = {
                    "knn": {
                        "field": "vector",
                        "query_vector": vector,
                        "k": size,
                        "num_candidates": size * 10
                    },
                    "post_filter": {
                        "bool": {
                            "must": [text_query]
                        }
                    }
                }
                
                # 添加过滤器
                if filter_conditions:
                    body["post_filter"]["bool"]["filter"] = filter_conditions
                    
            except Exception as e:
                logger.warning(f"KNN query failed, falling back to script_score: {str(e)}")
                # 回退到 script_score 查询
                body = {
                    "query": {
                        "script_score": {
                            "query": {
                                "bool": {
                                    "must": [text_query]
                                }
                            },
                            "script": {
                                "source": "cosineSimilarity(params.query_vector, 'vector') + 1.0",
                                "params": {
                                    "query_vector": vector
                                }
                            }
                        }
                    }
                }
                
                # 添加过滤器
                if filter_conditions:
                    body["query"]["script_score"]["query"]["bool"]["filter"] = filter_conditions
        
        # 仅向量查询 - 使用纯KNN
        elif vector and not query:
            try:
                # Elasticsearch 8.x KNN 查询
                body = {
                    "knn": {
                        "field": "vector",
                        "query_vector": vector,
                        "k": size,
                        "num_candidates": size * 10
                    }
                }
                
                # 添加过滤器
                if filter_conditions:
                    body["post_filter"] = {
                        "bool": {
                            "filter": filter_conditions
                        }
                    }
            except Exception as e:
                logger.warning(f"KNN query failed, falling back to script_score: {str(e)}")
                # 回退到 script_score 查询
                body = {
                    "query": {
                        "script_score": {
                            "query": {"match_all": {}},
                            "script": {
                                "source": "cosineSimilarity(params.query_vector, 'vector') + 1.0",
                                "params": {
                                    "query_vector": vector
                                }
                            }
                        }
                    }
                }
                
                # 添加过滤器
                if filter_conditions:
                    body["query"]["script_score"]["query"] = {
                        "bool": {
                            "must": {"match_all": {}},
                            "filter": filter_conditions
                        }
                    }
        
        # 仅文本查询 - 保持现有功能
        elif query and not vector:
            # 保持现有代码不变
            if not fields:
                search_query = {"query_string": {"query": query}}
            else:
                search_query = {"multi_match": {"query": query, "fields": fields}}
            
            body = {
                "query": {
                    "bool": {
                        "must": [search_query]
                    }
                }
            }
            
            # 添加过滤器
            if filter_conditions:
                body["query"]["bool"]["filter"] = filter_conditions
        
        # 如果既没有文本查询也没有向量查询，返回所有文档
        else:
            body = {
                "query": {"match_all": {}}
            }
            
            # 添加过滤器
            if filter_conditions:
                body = {
                    "query": {
                        "bool": {
                            "must": {"match_all": {}},
                            "filter": filter_conditions
                        }
                    }
                }
        
        try:
            # 打印调试信息
            logger.debug(f"ES query body: {json.dumps(body, indent=2)}")
            
            return self.es.search(
                index=self.index_name,
                body=body,
                size=size,
                from_=from_
            )
        except Exception as e:
            logger.error(f"Search error: {str(e)}")
            logger.error(f"Query body: {json.dumps(body, indent=2)}")
            raise
    
    def vector_search(self, vector: List[float], size: int = 10, filters: Optional[Dict] = None) -> Dict:
        """
        Convenience method for pure vector similarity search using KNN.
        
        Args:
            vector: Vector for similarity search
            size: Number of results to return
            filters: Optional filters to apply
            
        Returns:
            Search results
        """
        try:
            return self.knn_search(vector=vector, size=size, filters=filters)
        except Exception as e:
            logger.warning(f"KNN search failed, falling back to script_score: {str(e)}")
            return self.search(query=None, vector=vector, size=size, filters=filters)
    
    def knn_search(self, vector: List[float], size: int = 10, filters: Optional[Dict] = None) -> Dict:
        """
        Specialized KNN vector search for Elasticsearch 8.x.
        
        Args:
            vector: Vector for similarity search
            size: Number of results to return
            filters: Optional filters to apply
            
        Returns:
            Search results
        """
        # 准备KNN查询
        body = {
            "knn": {
                "field": "vector",
                "query_vector": vector,
                "k": size,
                "num_candidates": size * 10  # 提高召回率
            }
        }
        
        # 添加过滤器
        if filters:
            filter_conditions = []
            for field, value in filters.items():
                if isinstance(value, list):
                    filter_conditions.append({"terms": {field: value}})
                else:
                    filter_conditions.append({"term": {field: value}})
            
            body["post_filter"] = {
                "bool": {
                    "filter": filter_conditions
                }
            }
        
        try:
            logger.debug(f"KNN query body: {json.dumps(body, indent=2)}")
            return self.es.search(index=self.index_name, body=body)
        except Exception as e:
            logger.error(f"KNN search error: {str(e)}")
            logger.error(f"Query body: {json.dumps(body, indent=2)}")
            # 如果KNN查询失败，回退到向量搜索
            logger.info("Falling back to script_score vector search")
            return self.search(query=None, vector=vector, size=size, filters=filters)
    
    def delete_document(self, doc_id: str) -> Dict:
        """
        Delete a document by ID.
        
        Args:
            doc_id: Document ID to delete
            
        Returns:
            Deletion response
        """
        try:
            return self.es.delete(index=self.index_name, id=doc_id)
        except Exception as e:
            logger.error(f"Error deleting document: {str(e)}")
            raise
    
    def delete_by_query(self, query: str) -> Dict:
        """
        Delete documents matching a query.
        
        Args:
            query: Query string to match documents for deletion
            
        Returns:
            Deletion response
        """
        try:
            return self.es.delete_by_query(
                index=self.index_name,
                body={"query": {"query_string": {"query": query}}}
            )
        except Exception as e:
            logger.error(f"Error deleting by query: {str(e)}")
            raise
    
    def update_document(self, doc_id: str, updates: Dict[str, Any], vector: Optional[List[float]] = None) -> Dict:
        """
        Update a document by ID.
        
        Args:
            doc_id: Document ID to update
            updates: Dictionary of fields to update
            vector: Optional vector to update
            
        Returns:
            Update response
        """
        doc_updates = updates.copy()
        if vector is not None:
            doc_updates["vector"] = vector
            
        try:
            return self.es.update(
                index=self.index_name,
                id=doc_id,
                body={"doc": doc_updates}
            )
        except Exception as e:
            logger.error(f"Error updating document: {str(e)}")
            raise


def main(args):
    # 创建客户端
    mapping = {
        "mappings": {
            "properties": {
                "content": {"type": "text"},
                "metadata": {"type": "object", "enabled": True},
                "created_at": {"type": "date"},
                "updated_at": {"type": "date"},
                # 添加向量字段
                "vector": {
                    "type": "dense_vector",
                    "dims": args.vector_dim,
                    "index": True,
                    "similarity": "cosine"
                }
            }
        },
        "settings": {
            "number_of_shards": 1,
            "number_of_replicas": 0
        }
    }
    
    es_client = ElasticsearchClient(
        hosts=args.host,
        index_name=args.index,
        vector_dim=args.vector_dim,
        recreate_index=args.recreate_index,  # 传递重建索引参数
        mapping=mapping  # 传递映射参数
    )
    
    try:
        if (not es_client.es.indices.exists(index=args.index)):
            print("FUCK INIT")
            return
        # 获取索引中的文档数量
        count = es_client.es.count(index=args.index)
        
        logger.info(f"索引 '{args.index}' 中有 {count['count']} 个文档")
        
        # 如果索引为空，添加示例文档
        if count['count'] == 0:
            logger.info("Index is empty, adding sample document...")
            document = {
                "title": "Sample Document",
                "content": "This is a sample document for testing Elasticsearch.",
                "metadata": {
                    "author": "John Doe",
                    "tags": ["sample", "test", "elasticsearch"]
                },
                "created_at": "2025-03-24T10:00:00"
            }
            
            # 创建一个示例向量 (随机值)
            if args.with_vector:
                import numpy as np
                sample_vector = list(np.random.rand(args.vector_dim).astype(float))
                result = es_client.insert_document(document, vector=sample_vector)
                logger.info(f"Document with vector inserted with ID: {result['_id']}")
            else:
                result = es_client.insert_document(document)
                logger.info(f"Document inserted with ID: {result['_id']}")
            
            # 等待文档被索引
            es_client.es.indices.refresh(index=args.index)
            logger.info("Index refreshed.")
        
        # 执行查询
        if args.vector_search and args.with_vector:
            # 创建一个随机查询向量进行测试
            import numpy as np
            query_vector = list(np.random.rand(args.vector_dim).astype(float))
            logger.info(f"Performing vector search with random vector")
            
            search_results = es_client.vector_search(
                vector=query_vector,
                size=10
            )
        else:
            # 执行更简单的文本查询，不使用过滤器
            simple_query = "sample" if args.query is None else args.query
            logger.info(f"Searching for: '{simple_query}'")
            
            search_results = es_client.search(
                query=simple_query,
                fields=["title", "content"]
                # 移除过滤器以扩大搜索范围
            )
        
        logger.info(f"Found {len(search_results['hits']['hits'])} documents")
        if len(search_results['hits']['hits']) > 0:
            for hit in search_results['hits']['hits']:
                # 不打印向量以保持输出简洁
                source_copy = hit['_source'].copy()
                if 'vector' in source_copy:
                    source_copy['vector'] = f"[Vector with {len(source_copy['vector'])} dimensions]"
                
                logger.info(f"Score: {hit['_score']}, Document: {source_copy.get('title', 'No title')}")
                logger.info(f"Document preview: {json.dumps(source_copy, indent=2)}")
        else:
            logger.info("No documents found. Let's check all documents in the index:")
            # 使用 match_all 查询获取所有文档
            all_docs = es_client.es.search(
                index=args.index,
                body={"query": {"match_all": {}}}
            )
            logger.info(f"Total documents in index: {len(all_docs['hits']['hits'])}")
            for doc in all_docs['hits']['hits']:
                source_copy = doc['_source'].copy()
                if 'vector' in source_copy:
                    source_copy['vector'] = f"[Vector with {len(source_copy['vector'])} dimensions]"
                logger.info(f"ID: {doc['_id']}, Title: {source_copy.get('title', 'No title')}")
        
        return 0
    except Exception as e:
        logger.error(f"Error: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return 1

if __name__ == "__main__":                                                                                                                                                                                                                    
    parser = argparse.ArgumentParser()
    parser.add_argument("-i", "--input_path", default=None, type=str, help="Path to input data file")
    parser.add_argument("--host", default="http://localhost:9200", type=str, help="Elasticsearch host URL")
    parser.add_argument("--index", default="documents", type=str, help="Index name to use")
    parser.add_argument("--query", default=None, type=str, help="Search query")
    parser.add_argument("--with_vector", action="store_true", help="Add vector to sample document")
    parser.add_argument("--vector_search", action="store_true", help="Perform vector search demo")
    parser.add_argument("--vector_dim", default=1024, type=int, help="Vector dimension size")
    parser.add_argument("--recreate_index", action="store_true", help="Delete and recreate index if it exists")
    args = parser.parse_args()

    sys.exit(main(args))
