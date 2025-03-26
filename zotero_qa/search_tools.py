import logging
import os
import sys
from typing import List, Dict, Any, Optional
from pyzotero import zotero

# 更新日志格式，包含文件名、函数名和行号
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - [%(filename)s:%(funcName)s:%(lineno)d] - %(message)s'
)
logger = logging.getLogger(__name__)

# 处理相对导入
try:
    from .search_es import ElasticsearchClient
except ImportError:
    # 当直接运行此脚本时，使用绝对导入
    sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
    from zotero_qa.search_es import ElasticsearchClient

"""
搜索工具使用示例:

# 直接运行此示例:
python zotero_qa/search_tools.py

# Zotero搜索示例
zotero_tool = ZoteroSearchTool(
    zotero_api_key="your_api_key",
    zotero_library_id="your_library_id"
)
papers = zotero_tool.search("machine learning", limit=5)
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
    
    def __init__(self, zotero_api_key=None, zotero_library_id=None, zotero_library_type="user"):
        self.api_key = zotero_api_key
        self.library_id = zotero_library_id
        self.library_type = zotero_library_type
    
    def search(self, query: str, limit: int = 10) -> List[Dict[str, Any]]:
        """
        搜索Zotero库中的论文
        
        Args:
            query: 搜索关键词
            limit: 返回结果数量限制
        
        Returns:
            匹配的论文列表
        """
        try:
            from pyzotero import zotero
            
            if not self.api_key or not self.library_id:
                logger.error("Zotero API key or library ID not provided")
                return []
            
            zot = zotero.Zotero(self.library_id, self.library_type, self.api_key)
            results = zot.items(q=query, limit=limit)
            
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
            from pyzotero import zotero
            
            if not self.api_key or not self.library_id:
                logger.error("Zotero API key or library ID not provided")
                return {}
            
            zot = zotero.Zotero(self.library_id, self.library_type, self.api_key)
            item = zot.item(key)
            
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
              search_chunks: bool = False, group_by_parent: bool = True) -> List[Dict[str, Any]]:
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
            filters = None
            if not search_chunks:
                # 只搜索主文档
                filters = {"is_chunk": False}
            
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
                    'is_chunk': source.get('is_chunk', False)
                }
                
                if group_by_parent and source.get('is_chunk', False) and 'parent_id' in source:
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
            if group_by_parent and parent_docs:
                # 按得分排序
                parent_items = sorted(
                    parent_docs.items(), 
                    key=lambda x: x[1]['max_score'], 
                    reverse=True
                )
                
                for parent_id, parent_data in parent_items:
                    formatted_results.append({
                        'id': parent_id,
                        'score': parent_data['max_score'],
                        'title': parent_data['title'],
                        'chunks': parent_data['chunks'],
                        'is_parent_with_chunks': True
                    })
            
            return formatted_results
        except Exception as e:
            logger.error(f"Error searching Elasticsearch: {str(e)}")
            return []
    
    def search_chunks(self, query: str, size: int = 10, vector: Optional[List[float]] = None, 
                     parent_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        专门搜索文档切片
        
        Args:
            query: 搜索关键词
            size: 返回结果数量
            vector: 可选的向量搜索
            parent_id: 可选的父文档ID
            
        Returns:
            切片搜索结果列表
        """
        try:
            # 准备查询过滤器
            filters = {"is_chunk": True}
            
            # 如果指定了父文档ID，则添加到过滤器
            if parent_id:
                filters["parent_id"] = parent_id
            
            # 执行搜索
            if vector:
                results = self.es_client.search(query=query, vector=vector, size=size, filters=filters)
            else:
                results = self.es_client.search(query=query, size=size, filters=filters)
            
            formatted_results = []
            for hit in results['hits']['hits']:
                source = hit['_source']
                # 移除向量以减少输出大小
                if 'vector' in source:
                    del source['vector']
                
                formatted_result = {
                    'id': hit['_id'],
                    'score': hit['_score'],
                    'parent_id': source.get('parent_id', ''),
                    'chunk_id': source.get('chunk_id', 0),
                    'chunk_type': source.get('chunk_type', ''),
                    'chunk_title': source.get('chunk_title', ''),
                    'title': source.get('title', ''),
                    'content': source.get('content', ''),
                    'start_char': source.get('start_char', 0),
                    'end_char': source.get('end_char', 0)
                }
                formatted_results.append(formatted_result)
            
            return formatted_results
        except Exception as e:
            logger.error(f"Error searching chunks: {str(e)}")
            return []

class ArxivSearchTool:
    """封装arXiv搜索功能的工具类"""
    
    def search(self, query: str, max_results: int = 5) -> List[Dict[str, Any]]:
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
                max_results=max_results,
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
        

zot = zotero.Zotero(library_id='000000', library_type = 'user', local=True)
def search_zotero(query: str, limit: int = 10) -> List[Dict[str, Any]]:
    """
    搜索Zotero库中的论文
    
    Args:
        query: 搜索关键词
        limit: 返回结果数量限制
    
    Returns:
        匹配的论文列表
    """
    # 使用zotero配置
    
 
es_client = ElasticsearchClient("http://localhost:9200","zotero_papers")
def search_elasticsearch(query: str, size: int = 5) -> List[Dict[str, Any]]:
    """
    搜索本地ES索引中的论文
    
    Args:
        query: 搜索关键词
        size: 返回结果数量
    
    Returns:
        搜索结果列表
    """
    return es_search.search(query, size)

arxiv_search = ArxivSearchTool()
def search_arxiv(query: str, max_results: int = 5) -> List[Dict[str, Any]]:
    """
    搜索arXiv的论文
    
    Args:
        query: 搜索关键词
        max_results: 最大返回结果数
    
    Returns:
        匹配的论文列表
    """
    return arxiv_search.search(query, max_results)


def get_zotero_item(key: str) -> Dict[str, Any]:
    """
    根据论文键值获取详细信息
    
    Args:
        key: Zotero项目键值
    
    Returns:
        论文详细信息
    """
    return zot.get_item_by_key(key)

# 当脚本直接运行时的示例代码
if __name__ == "__main__":
    print("=" * 50)
    print("搜索工具演示")
    print("=" * 50)
    
    # 获取API密钥和库ID的环境变量
    zotero_api_key = os.environ.get("ZOTERO_API_KEY")
    zotero_library_id = os.environ.get("ZOTERO_LIBRARY_ID")
    
    if zotero_api_key and zotero_library_id:
        print("\n=== Zotero搜索示例 ===")
        zotero = ZoteroSearchTool(
            zotero_api_key=zotero_api_key, 
            zotero_library_id=zotero_library_id
        )
        try:
            results = zotero.search("machine learning", limit=2)
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
    else:
        print("Zotero API密钥或库ID未设置，跳过Zotero搜索示例")
    
    print("\n=== Elasticsearch搜索示例 ===")
    try:
        es = ElasticsearchSearchTool()
        results = es.search("neural networks", size=2)
        print(f"找到 {len(results)} 个结果")
        for i, result in enumerate(results):
            print(f"\n结果 {i+1}:")
            print(f"ID: {result['id']}")
            print(f"得分: {result['score']}")
            print(f"标题: {result['source'].get('title', 'N/A')}")
    except Exception as e:
        print(f"Elasticsearch搜索出错: {str(e)}")
    
    print("\n=== arXiv搜索示例 ===")
    try:
        arxiv = ArxivSearchTool()
        results = arxiv.search("reinforcement learning", max_results=2)
        print(f"找到 {len(results)} 个结果")
        for i, paper in enumerate(results):
            print(f"\n结果 {i+1}:")
            print(f"标题: {paper['title']}")
            print(f"作者: {', '.join(paper['authors'])}")
            print(f"发布日期: {paper['published']}")
            print(f"URL: {paper['url']}")
            if paper['abstract']:
                print(f"摘要: {paper['abstract'][:100]}..." if len(paper['abstract']) > 100 else paper['abstract'])
    except Exception as e:
        print(f"arXiv搜索出错: {str(e)}")
    
    print("\n" + "=" * 50)
