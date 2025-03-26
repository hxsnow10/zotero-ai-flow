import logging
import os
import sys
from typing import List, Dict, Any, Optional
from pyzotero import zotero

# 更新日志格式，包含文件名、函数名和行号
logging.basicConfig(
    level=logging.WARNING,
    format='%(asctime)s - %(name)s - %(levelname)s - [%(filename)s:%(funcName)s:%(lineno)d] - %(message)s'
)
logger = logging.getLogger(__name__)

# 处理相对导入
from search_es import ElasticsearchClient

"""
搜索工具使用示例:

# 直接运行此示例:
python zotero_qa/search_tools.py

# Zotero搜索示例
zotero_tool = ZoteroSearchTool(
    zotero_api_key="your_api_key",
    zotero_library_id="your_library_id"
)
papers = zotero_tool.search("machine learning", size=5)
for paper in papers:
    print(f"标题: {paper['title']}")
    print(f"作者: {', '.join([author['lastName'] for author in paper['authors']])}")
    print(f"摘要: {paper['abstract'][:200]}...")
    print("---")

# Elasticsearch搜索示例
es_tool = ElasticsearchSearchTool(
    es_host="http://localhost:9200",
    es_index="zotero_papers"
)
results = es_tool.search("neural networks", size=3)
for result in results:
    print(f"得分: {result['score']}")
    print(f"标题: {result['source'].get('title', 'N/A')}")
    print("---")

# arXiv搜索示例
arxiv_tool = ArxivSearchTool()
papers = arxiv_tool.search("reinforcement learning", max_results=3)
for paper in papers:
    print(f"标题: {paper['title']}")
    print(f"作者: {', '.join(paper['authors'])}")
    print(f"发布日期: {paper['published']}")
    print(f"链接: {paper['url']}")
    print("---")
"""

# TODO: ADD google搜索
# TODO：ADD google scholar搜索

class ZoteroSearchTool:
    """Zotero搜索工具，用于从Zotero获取论文信息"""
    
    def __init__(self):
        self.zot = zotero.Zotero(library_id='000000', library_type = 'user', local=True) 

    
    def search(self, query: str, size: int = 10) -> List[Dict[str, Any]]:
        """
        搜索Zotero库中的论文
        
        Args:
            query: 搜索关键词
            size: 返回结果数量限制
        
        Returns:
            匹配的论文列表
        """
        try:

            results = self.zot.items(q=query, limit=size)
            
            # 转换为更易于使用的格式
            formatted_results = []
            for item in results:
                data = item['data']
                formatted_result = {
                    'key': data.get('key', ''),
                    'title': data.get('title', ''),
                    'abstract': data.get('abstractNote', ''),
                    'authors': data.get('creators', []),
                    'date': data.get('date', ''),
                    'tags': data.get('tags', []),
                    'url': data.get('url', ''),
                    'doi': data.get('DOI', '')
                }
                formatted_results.append(formatted_result)
            
            return formatted_results
        except Exception as e:
            logger.error(f"Error searching Zotero: {str(e)}")
            return []
            
    def get_item_by_key(self, key: str) -> Dict[str, Any]:
        """
        根据论文键值获取详细信息
        
        Args:
            key: Zotero项目键值
            
        Returns:
            论文详细信息
        """
        try:

            item = self.zot.item(key)
            
            if not item:
                return {}
                
            data = item['data']
            formatted_result = {
                'key': data.get('key', ''),
                'title': data.get('title', ''),
                'abstract': data.get('abstractNote', ''),
                'authors': data.get('creators', []),
                'date': data.get('date', ''),
                'tags': data.get('tags', []),
                'url': data.get('url', ''),
                'doi': data.get('DOI', '')
            }
            
            return formatted_result
        except Exception as e:
            logger.error(f"Error getting Zotero item: {str(e)}")
            return {}

class ElasticsearchSearchTool:
    """封装Elasticsearch搜索功能的工具类"""
    
    def __init__(self, es_host="http://localhost:9200", es_index="zotero_papers"):
        self.es_client = ElasticsearchClient(
            hosts=es_host,
            index_name=es_index
        )
    
    def search(self, query: str, size: int = 5, vector: Optional[List[float]] = None, 
              search_docs: bool = True, search_chunks: bool = True, group_by_parent: bool = False) -> List[Dict[str, Any]]:
        """
        搜索本地ES索引中的论文
        
        Args:
            query: 搜索关键词
            size: 返回结果数量
            vector: 可选的向量搜索
            search_chunks: 是否搜索文档切片
            group_by_parent: 是否按父文档分组结果
            
        Returns:
            搜索结果列表
        """
        try:
            # 准备查询过滤器
            filters = {}
            if search_docs and not search_chunks:
                # 只搜索主文档
                filters = {"is_chunk": False}
            elif not search_docs and search_chunks:
                # 只搜索切片
                filters = {"is_chunk": True}
            elif not search_docs and not search_chunks:
                # 不搜索任何内容
                return []
            
            # 执行搜索
            if vector:
                results = self.es_client.search(query=query, vector=vector, size=size, filters=filters)
            else:
                results = self.es_client.search(query=query, size=size, filters=filters)

            formatted_results = []
            
            # 用于分组的字典
            parent_docs = {}
            
            for hit in results['hits']['hits']:
                source = hit['_source']
                # 移除向量以减少输出大小
                if 'vector' in source:
                    del source['vector']
                
                # 创建结果对象
                formatted_result = {
                    'id': hit['_id'],
                    'score': hit['_score'],
                    'source': source,
                    'is_chunk': source.get('is_chunk', False),
                    'parent_id': source.get('parent_id', ''),
                    'chunks': []
                }
                
                if group_by_parent and 'parent_id' in source:
                    # 如果是切片且需要分组，则按父文档分组
                    parent_id = source['parent_id']
                    if parent_id not in parent_docs:
                        parent_docs[parent_id] = {
                            'id': parent_id,
                            'title': source.get('title', ''),
                            'chunks': [],
                            'max_score': hit['_score']
                        }
                    
                    # 更新最高得分
                    if hit['_score'] > parent_docs[parent_id]['max_score']:
                        parent_docs[parent_id]['max_score'] = hit['_score']
                    
                    # 添加切片
                    parent_docs[parent_id]['chunks'].append(formatted_result)
                else:
                    # 否则直接添加到结果列表
                    formatted_results.append(formatted_result)
            
            # 如果需要分组，则将分组结果添加到最终结果
            if group_by_parent:
                # 按得分排序
                parent_items = sorted(
                    parent_docs.items(), 
                    key=lambda x: x[1]['max_score'], 
                    reverse=True
                )
                
                for parent_id, parent_data in parent_items:
                    formatted_results.append(parent_data)
            
            return formatted_results
        except Exception as e:
            logger.error(f"Error searching Elasticsearch: {str(e)}")
            return []

class ArxivSearchTool:
    """封装arXiv搜索功能的工具类"""
    
    def search(self, query: str, size: int = 5) -> List[Dict[str, Any]]:
        """
        搜索arXiv的论文
        
        Args:
            query: 搜索关键词
            max_results: 最大返回结果数
            
        Returns:
            匹配的论文列表
        """
        try:
            import arxiv
            
            # 使用arxiv API搜索
            search = arxiv.Search(
                query=query,
                max_results=size,
                sort_by=arxiv.SortCriterion.Relevance
            )
            
            results = []
            for result in search.results():
                paper = {
                    'title': result.title,
                    'abstract': result.summary,
                    'authors': [author.name for author in result.authors],
                    'url': result.entry_id,
                    'pdf_url': result.pdf_url,
                    'published': result.published.strftime('%Y-%m-%d') if result.published else None,
                    'categories': result.categories
                }
                results.append(paper)
            
            return results
        except Exception as e:
            logger.error(f"Error searching arXiv: {str(e)}")
            return []
        
# TODO： 这里的输出格式不适合LLM，需要规整下
def good_read(results, prefix = ""):
    "返回一个适合阅读的字符串"
    res = prefix+":\n"
    for i, item in enumerate(results):
        res += f"\n--- 第 {i+1}篇结果 BEGIN---:\n"
        for key in item:
            res += f"{key}: {item[key]}\n"
        res += f"\n--- 第 {i+1}篇结果 END---:\n"
    print(res)
    return res
        
zot_clinet = ZoteroSearchTool()
def search_zotero(query: str, size: int = 10) -> List[Dict[str, Any]]:
    """
    搜索Zotero库中的论文
    
    Args:
        query: 搜索关键词
        size: 返回结果数量限制
    
    Returns:
        匹配的论文列表
    """
    return good_read(zot_clinet.search(query, size),"zotero 搜索结果")
    
 
es_client = ElasticsearchSearchTool()
def search_elasticsearch(query: str, size: int = 5,vector: Optional[List[float]] = None,) -> List[Dict[str, Any]]:
    """
    搜索本地ES索引中的论文
    
    Args:
        query: 搜索关键词
        size: 返回结果数量
    
    Returns:
        搜索结果列表
    """
    return good_read(es_client.search(query, vector = vector, size = size), "elasticsearch 搜索结果")

arxiv_search = ArxivSearchTool()
def search_arxiv(query: str, size: int = 5) -> List[Dict[str, Any]]:
    """
    搜索arXiv的论文
    
    Args:
        query: 搜索关键词
        size: 最大返回结果数
    
    Returns:
        匹配的论文列表
    """
    return good_read(arxiv_search.search(query, size), "arxiv 搜索结果")

# 当脚本直接运行时的示例代码
if __name__ == "__main__":
    print("=" * 50)
    print("搜索工具演示")
    print("=" * 50)
    

    print("\n=== Zotero搜索示例 ===")
    try:
        # 使用search_zotero函数测试
        results = search_zotero("machine learning", size=2)
        print(f"找到 {len(results)} 个结果")
        for i, item in enumerate(results):
            print(f"\n结果 {i+1}:")
            print(f"标题: {item['title']}")
            print(f"作者: {', '.join([f'{a.get('firstName', '')} {a.get('lastName', '')}' for a in item['authors'] if 'lastName' in a])}")
            print(f"日期: {item['date']}")
            if item['abstract']:
                print(f"摘要: {item['abstract'][:100]}..." if len(item['abstract']) > 100 else item['abstract'])
    except Exception as e:
        print(f"Zotero搜索出错: {str(e)}")

    
    print("\n=== Elasticsearch搜索示例 ===")
    try:
        # 使用search_elasticsearch函数测试
        results = search_elasticsearch("natural", size=2)
        if results:
            # 检查返回的结果类型
            if isinstance(results, dict) and 'hits' in results:
                # 这是原始的Elasticsearch响应
                hits = results['hits']['hits']
                print(f"找到 {len(hits)} 个结果")
                for i, hit in enumerate(hits):
                    print(f"\n结果 {i+1}:")
                    print(f"ID: {hit['_id']}")
                    print(f"得分: {hit['_score']}")
                    print(f"标题: {hit['_source'].get('title', 'N/A')}")
            elif isinstance(results, list):
                # 这是格式化后的结果列表
                print(f"找到 {len(results)} 个结果")
                for i, result in enumerate(results):
                    print(f"\n结果 {i+1}:")
                    if isinstance(result, dict):
                        print(f"ID: {result.get('id', 'N/A')}")
                        print(f"得分: {result.get('score', 'N/A')}")
                        source = result.get('source', {})
                        if isinstance(source, dict):
                            print(f"标题: {source.get('title', 'N/A')}")
                        else:
                            print(f"标题: 无法解析")
                    else:
                        print(f"结果格式无效: {result}")
            else:
                # 未知格式
                print(f"结果类型: {type(results)}")
                # print(f"结果内容: {results}")
        else:
            print("没有找到结果")
    except Exception as e:
        import traceback
        traceback.print_exc()   
        print(f"Elasticsearch搜索出错: {str(e)}")
    quit()
    print("\n=== arXiv搜索示例 ===")
    try:
        # 使用search_arxiv函数测试
        results = search_arxiv("reinforcement learning", size=2)
        print(f"找到 {len(results)} 个结果")
        for i, paper in enumerate(results):
            if isinstance(paper, dict):
                print(f"\n结果 {i+1}:")
                print(f"标题: {paper.get('title', 'N/A')}")
                print(f"作者: {', '.join(paper.get('authors', []))}")
                print(f"发布日期: {paper.get('published', 'N/A')}")
                print(f"URL: {paper.get('url', 'N/A')}")
                if paper.get('abstract'):
                    abstract = paper['abstract']
                    print(f"摘要: {abstract[:100]}..." if len(abstract) > 100 else abstract)
            else:
                print(f"\n结果 {i+1} 格式无效: {paper}")
    except Exception as e:
        print(f"arXiv搜索出错: {str(e)}")

    print("\n" + "=" * 50)
