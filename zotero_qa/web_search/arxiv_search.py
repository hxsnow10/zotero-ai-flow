#!/usr/bin/env python
# -*- encoding=utf8
# @author      : xiahong
# @file        : arxiv_search.py
# @created     : 2025-03-24 15:53:11

"""
Example:
    python arxiv_search.py --query "large language models" --limit 5
    python arxiv_search.py --query "reinforcement learning" --category cs.AI --limit 10
    python arxiv_search.py --id "2303.08774" --download --output_dir papers/
"""

import sys
import argparse
import os
import json
import time
import logging
from typing import List, Dict, Any, Optional, Union
import arxiv  # 导入第三方库

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levellevel)s - %(message)s'
)
logger = logging.getLogger(__name__)

# https://github.com/lukasschwab/arxiv.py API

class ArxivSearch:
    """arXiv搜索类"""
    
    def __init__(self, rate_limit_delay: float = 3.0):
        """
        初始化arXiv搜索客户端
        
        Args:
            rate_limit_delay: 请求之间的延迟秒数，避免触发arXiv的限制
        """
        self.client = arxiv.Client(
            page_size=10,  # 每页结果数量
            delay_seconds=rate_limit_delay,  # 请求之间的延迟
            num_retries=3  # 重试次数
        )
        self.rate_limit_delay = rate_limit_delay
    
    def search_papers(self, 
                    query: str, 
                    max_results: int = 10, 
                    sort_by: arxiv.SortCriterion = arxiv.SortCriterion.Relevance,
                    sort_order: arxiv.SortOrder = arxiv.SortOrder.Descending,
                    categories: Optional[List[str]] = None) -> List[arxiv.Result]:
        """
        搜索arXiv论文
        
        Args:
            query: 搜索查询字符串
            max_results: 最大返回结果数
            sort_by: 排序标准(Relevance, LastUpdatedDate, SubmittedDate)
            sort_order: 排序顺序(Ascending, Descending)
            categories: 限制搜索的分类列表，如['cs.AI', 'cs.CL']
            
        Returns:
            论文结果列表
        """
        search_query = query
        
        # 添加分类过滤
        if categories:
            category_filters = [f"cat:{cat}" for cat in categories]
            category_query = " OR ".join(category_filters)
            search_query = f"({search_query}) AND ({category_query})"
        
        logger.info(f"搜索arXiv: {search_query}")
        
        # 创建搜索对象
        search = arxiv.Search(
            query=search_query,
            max_results=max_results,
            sort_by=sort_by,
            sort_order=sort_order
        )
        
        try:
            # 执行搜索并获取结果
            results = list(self.client.results(search))
            logger.info(f"找到 {len(results)} 篇论文")
            return results
        except Exception as e:
            logger.error(f"arXiv搜索出错: {str(e)}")
            return []
    
    def get_paper_by_id(self, paper_id: str) -> Optional[arxiv.Result]:
        """
        通过ID获取论文
        
        Args:
            paper_id: arXiv论文ID，如"2303.08774"
            
        Returns:
            论文对象，如果未找到则为None
        """
        # 确保ID格式正确（去掉可能的前缀）
        if paper_id.startswith("arXiv:"):
            paper_id = paper_id[6:]
        
        logger.info(f"获取ID为 {paper_id} 的论文")
        
        try:
            # 创建搜索对象
            search = arxiv.Search(
                id_list=[paper_id],
                max_results=1
            )
            
            # 获取结果
            results = list(self.client.results(search))
            
            if not results:
                logger.warning(f"未找到ID为 {paper_id} 的论文")
                return None
            
            return results[0]
        except Exception as e:
            logger.error(f"获取论文出错: {str(e)}")
            return None
    
    def download_paper(self, paper: arxiv.Result, output_dir: str = "downloads") -> str:
        """
        下载论文PDF
        
        Args:
            paper: 论文对象
            output_dir: 保存PDF的目录
            
        Returns:
            下载的文件路径
        """
        # 创建输出目录（如果不存在）
        os.makedirs(output_dir, exist_ok=True)
        
        # 构建文件名，使用ID和简化的标题
        safe_title = "".join(c if c.isalnum() else "_" for c in paper.title)
        safe_title = safe_title[:50]  # 截断标题以避免文件名过长
        filename = f"{paper.get_short_id()}_{safe_title}.pdf"
        filepath = os.path.join(output_dir, filename)
        
        # 检查文件是否已存在
        if os.path.exists(filepath):
            logger.info(f"文件已存在: {filepath}")
            return filepath
        
        logger.info(f"正在下载论文: {paper.title}")
        try:
            paper.download_pdf(dirpath=output_dir, filename=filename)
            logger.info(f"下载完成: {filepath}")
            return filepath
        except Exception as e:
            logger.error(f"下载论文出错: {str(e)}")
            return ""
    
    def format_paper_info(self, paper: arxiv.Result) -> Dict[str, Any]:
        """
        将论文对象格式化为字典
        
        Args:
            paper: 论文对象
            
        Returns:
            包含论文信息的字典
        """
        # 获取作者姓名列表
        authors = [author.name for author in paper.authors]
        
        # 获取分类列表
        categories = [cat for cat in paper.categories]
        
        # 创建论文信息字典
        paper_info = {
            "id": paper.get_short_id(),
            "title": paper.title,
            "authors": authors,
            "abstract": paper.summary,
            "categories": categories,
            "published": paper.published.strftime("%Y-%m-%d"),
            "updated": paper.updated.strftime("%Y-%m-%d") if paper.updated else None,
            "pdf_url": paper.pdf_url,
            "entry_id": paper.entry_id,
            "primary_category": paper.primary_category,
            "comment": paper.comment,
            "journal_ref": paper.journal_ref,
            "doi": paper.doi
        }
        
        return paper_info
    
    def print_paper_summary(self, paper: arxiv.Result) -> None:
        """
        打印论文摘要信息
        
        Args:
            paper: 论文对象
        """
        print("\n" + "="*80)
        print(f"标题: {paper.title}")
        print(f"作者: {', '.join(author.name for author in paper.authors)}")
        print(f"发布日期: {paper.published.strftime('%Y-%m-%d')}")
        if paper.updated:
            print(f"更新日期: {paper.updated.strftime('%Y-%m-%d')}")
        print(f"主分类: {paper.primary_category}")
        print(f"所有分类: {', '.join(paper.categories)}")
        if paper.doi:
            print(f"DOI: {paper.doi}")
        if paper.journal_ref:
            print(f"期刊引用: {paper.journal_ref}")
        print(f"arXiv URL: {paper.entry_id}")
        print(f"PDF URL: {paper.pdf_url}")
        print("\n摘要:")
        print(paper.summary)
        print("="*80 + "\n")

def main(args):
    # 创建arXiv搜索对象
    arxiv_search = ArxivSearch(rate_limit_delay=3.0)
    
    # 按论文ID搜索
    if args.id:
        paper = arxiv_search.get_paper_by_id(args.id)
        if not paper:
            logger.error(f"未找到ID为 {args.id} 的论文")
            return 1
        
        # 打印论文摘要
        arxiv_search.print_paper_summary(paper)
        
        # 下载论文（如果指定）
        if args.download:
            output_dir = args.output_dir or "downloads"
            filepath = arxiv_search.download_paper(paper, output_dir)
            if filepath:
                logger.info(f"论文已下载到: {filepath}")
        
        # 保存元数据到JSON
        if args.output_json:
            paper_info = arxiv_search.format_paper_info(paper)
            with open(args.output_json, 'w', encoding='utf-8') as f:
                json.dump(paper_info, f, ensure_ascii=False, indent=2)
            logger.info(f"论文元数据已保存到: {args.output_json}")
    
    # 按查询搜索
    elif args.query:
        # 处理分类
        categories = None
        if args.category:
            categories = [args.category]
        
        # 确定排序方式
        sort_by = arxiv.SortCriterion.Relevance
        if args.sort_by:
            if args.sort_by.lower() == "relevance":
                sort_by = arxiv.SortCriterion.Relevance
            elif args.sort_by.lower() == "lastupdate":
                sort_by = arxiv.SortCriterion.LastUpdatedDate
            elif args.sort_by.lower() == "submitted":
                sort_by = arxiv.SortCriterion.SubmittedDate
            else:
                logger.warning(f"未知排序标准 '{args.sort_by}'，使用默认值 'relevance'")
        
        # 排序顺序
        sort_order = arxiv.SortOrder.Descending
        if args.sort_order and args.sort_order.lower() == "ascending":
            sort_order = arxiv.SortOrder.Ascending
        
        # 执行搜索
        results = arxiv_search.search_papers(
            query=args.query,
            max_results=args.limit,
            sort_by=sort_by,
            sort_order=sort_order,
            categories=categories
        )
        
        if not results:
            logger.info("未找到符合条件的论文")
            return 1
        
        # 打印搜索结果
        logger.info(f"找到 {len(results)} 篇论文:")
        for i, paper in enumerate(results, 1):
            print(f"\n--- 论文 {i}/{len(results)} ---")
            arxiv_search.print_paper_summary(paper)
            
            # 如果需要，下载论文
            if args.download:
                output_dir = args.output_dir or "downloads"
                arxiv_search.download_paper(paper, output_dir)
                # 添加短暂延迟，避免连续下载触发限制
                time.sleep(1)
        
        # 保存结果到JSON
        if args.output_json:
            paper_info_list = [arxiv_search.format_paper_info(paper) for paper in results]
            with open(args.output_json, 'w', encoding='utf-8') as f:
                json.dump(paper_info_list, f, ensure_ascii=False, indent=2)
            logger.info(f"搜索结果已保存到: {args.output_json}")
    
    else:
        logger.error("请提供搜索查询或论文ID")
        return 1
    
    return 0

if __name__ == "__main__":                                                                                                                                                                                                                    
    parser = argparse.ArgumentParser(description="arXiv论文搜索和下载工具")
    
    # 搜索相关参数
    parser.add_argument("-q", "--query", default=None, type=str, help="搜索查询字符串")
    parser.add_argument("-l", "--limit", default=5, type=int, help="最大结果数量")
    parser.add_argument("-c", "--category", default=None, type=str, help="限制搜索的分类，如cs.AI")
    parser.add_argument("--sort-by", default="relevance", type=str, help="排序标准: relevance, lastupdate, submitted")
    parser.add_argument("--sort-order", default="descending", type=str, help="排序顺序: ascending, descending")
    
    # 论文ID相关参数
    parser.add_argument("-i", "--id", default=None, type=str, help="论文ID，如2303.08774")
    
    # 下载相关参数
    parser.add_argument("-d", "--download", action="store_true", help="下载论文PDF")
    parser.add_argument("-o", "--output-dir", default="downloads", type=str, help="下载PDF的目录")
    
    # 输出相关参数
    parser.add_argument("-j", "--output-json", default=None, type=str, help="保存结果到JSON文件")
    
    args = parser.parse_args()

    sys.exit(main(args))
