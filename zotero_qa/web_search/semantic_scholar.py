#!/usr/bin/env python
# -*- encoding=utf8
# @author      : xiahong
# @file        : semantic_scholar.py
# @created     : 2025-03-24 15:10:59

"""
Example:
    python semantic_scholar.py --query "large language models" --api_key "YOUR_API_KEY"
    python semantic_scholarpy --query "reinforcement learning" --limit 10 --fields "title,authors,abstract,venue,year"
    python semantic_scholar.py --paper_id "649def34f8be52c8b66281af98ae884c09aef38b" --paper_details
"""

import sys
import argparse
import os
import json
import time
import requests
import random
from typing import Dict, List, Any, Optional, Union
import logging

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
# https://www.semanticscholar.org/product/api/tutorial#author  # API文档


class SemanticScholarAPI:
    """与Semantic Scholar API交互的类"""

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: str = "https://api.semanticscholar.org/graph/v1",
    ):
        """
        初始化Semantic Scholar API客户端

        Args:
            api_key: Semantic Scholar API密钥(可选)
            base_url: API基础URL
        """
        self.base_url = base_url
        self.api_key = api_key or os.environ.get("SEMANTIC_SCHOLAR_API_KEY")
        self.headers = {}

        # 如果提供了API密钥，添加到请求头
        if self.api_key:
            self.headers["x-api-key"] = self.api_key
            logger.info("使用API密钥发送请求")
            # 有API密钥时的请求间隔更短
            self.request_interval = 1  # 秒
        else:
            logger.warning(
                "未提供API密钥，将受到更严格的速率限制，建议申请API密钥：https://www.semanticscholar.org/product/api"
            )
            # 无API密钥时使用更长的请求间隔
            self.request_interval = 3  # 秒

        # 设置请求头
        self.headers["Content-Type"] = "application/json"
        self.headers["User-Agent"] = "SemanticScholarPythonClient/1.0"

        # 限速计数器
        self.last_request_time = 0
        self.retry_count = 0
        self.max_retries = 3

    def _rate_limit(self):
        """实现简单的速率限制"""
        current_time = time.time()
        time_since_last_request = current_time - self.last_request_time

        # 添加随机抖动避免请求同步
        jitter = random.uniform(0, 0.5)

        if time_since_last_request < self.request_interval:
            wait_time = self.request_interval - time_since_last_request + jitter
            logger.debug(f"等待 {wait_time:.2f} 秒以遵守速率限制")
            time.sleep(wait_time)

        self.last_request_time = time.time()

    def _make_request(self, method, url, params=None, data=None, retry_on_429=True):
        """
        发送请求并处理重试逻辑

        Args:
            method: HTTP方法 ('get', 'post' 等)
            url: 请求URL
            params: URL参数
            data: 请求体数据
            retry_on_429: 遇到429错误时是否重试

        Returns:
            响应对象
        """
        self._rate_limit()
        self.retry_count = 0

        while self.retry_count <= self.max_retries:
            try:
                response = requests.request(
                    method=method,
                    url=url,
                    params=params,
                    json=data,
                    headers=self.headers,
                )

                # 检查是否遇到速率限制
                if response.status_code == 429 and retry_on_429:
                    self.retry_count += 1

                    # 指数退避策略
                    wait_time = (2**self.retry_count) + random.uniform(0, 1)
                    logger.warning(
                        f"遇到速率限制，等待 {wait_time:.2f} 秒后重试 (尝试 {self.retry_count}/{self.max_retries})"
                    )
                    time.sleep(wait_time)
                    continue

                # 对于其他错误，引发异常
                response.raise_for_status()
                return response

            except requests.exceptions.RequestException as e:
                if response.status_code == 429 and self.retry_count >= self.max_retries:
                    logger.error("达到最大重试次数，请稍后再试或申请API密钥")
                raise e

    def search_papers(
        self,
        query: str,
        limit: int = 5,
        offset: int = 0,
        fields: str = "title,authors,abstract,year,venue,url",
        return_raw: bool = False,
    ) -> Union[Dict, List[Dict]]:
        """
        搜索学术论文

        Args:
            query: 搜索查询
            limit: 返回结果数量限制
            offset: 结果偏移量(用于分页)
            fields: 返回的字段，逗号分隔
            return_raw: 是否返回原始API响应

        Returns:
            搜索结果字典或论文列表
        """
        # 构建API端点
        endpoint = f"{self.base_url}/paper/search"

        # 构建请求参数
        params = {"query": query, "limit": limit, "offset": offset, "fields": fields}

        try:
            # 发送GET请求
            response = self._make_request("get", endpoint, params=params)

            # 解析JSON响应
            data = response.json()

            # 返回原始响应或仅论文列表
            return data if return_raw else data.get("data", [])

        except requests.exceptions.RequestException as e:
            logger.error(f"API请求错误: {str(e)}")
            if hasattr(e, "response") and e.response:
                logger.error(f"响应内容: {e.response.text}")

            # 提供更有帮助的错误信息
            if hasattr(e, "response") and e.response and e.response.status_code == 429:
                logger.error(
                    "请考虑申请API密钥以获得更高的速率限制: https://www.semanticscholar.org/product/api#api-key-form"
                )

            return [] if not return_raw else {"error": str(e)}

    def get_paper_details(
        self,
        paper_id: str,
        fields: str = "title,authors,abstract,citations,references,year,venue,url,tldr",
    ) -> Dict:
        """
        获取单篇论文的详细信息

        Args:
            paper_id: 论文ID (可以是S2PaperId、DOI、ArXiv ID、MAG ID、ACL ID或PMID)
            fields: 返回的字段，逗号分隔

        Returns:
            论文详细信息字典
        """
        # 检查ID类型并格式化
        if paper_id.startswith("10.") and "/" in paper_id:
            # 看起来像DOI，需要URL编码
            import urllib.parse

            paper_id = f"DOI:{urllib.parse.quote(paper_id)}"
        elif paper_id.startswith("arXiv:"):
            paper_id = paper_id.replace("arXiv:", "ARXIV:")

        # 构建API端点
        endpoint = f"{self.base_url}/paper/{paper_id}"

        # 构建请求参数
        params = {"fields": fields}

        try:
            # 发送GET请求
            response = self._make_request("get", endpoint, params=params)

            # 解析JSON响应
            return response.json()

        except requests.exceptions.RequestException as e:
            logger.error(f"获取论文详情错误: {str(e)}")
            if hasattr(e, "response") and e.response:
                logger.error(f"响应内容: {e.response.text}")
            return {"error": str(e)}

    def get_author_details(
        self, author_id: str, fields: str = "name,paperCount,citationCount,hIndex"
    ) -> Dict:
        """
        获取作者详细信息

        Args:
            author_id: 作者ID
            fields: 返回的字段，逗号分隔

        Returns:
            作者详细信息字典
        """
        # 构建API端点
        endpoint = f"{self.base_url}/author/{author_id}"

        # 构建请求参数
        params = {"fields": fields}

        try:
            # 发送GET请求
            response = self._make_request("get", endpoint, params=params)

            # 解析JSON响应
            return response.json()

        except requests.exceptions.RequestException as e:
            logger.error(f"获取作者详情错误: {str(e)}")
            if hasattr(e, "response") and e.response:
                logger.error(f"响应内容: {e.response.text}")
            return {"error": str(e)}

    def get_author_papers(
        self, author_id: str, limit: int = 10, fields: str = "title,year,venue,abstract"
    ) -> List[Dict]:
        """
        获取作者的论文列表

        Args:
            author_id: 作者ID
            limit: 返回结果数量限制
            fields: 返回的字段，逗号分隔

        Returns:
            作者论文列表
        """
        # 构建API端点
        endpoint = f"{self.base_url}/author/{author_id}/papers"

        # 构建请求参数
        params = {"fields": fields, "limit": limit}

        try:
            # 发送GET请求
            response = self._make_request("get", endpoint, params=params)

            # 解析JSON响应
            data = response.json()
            return data.get("data", [])

        except requests.exceptions.RequestException as e:
            logger.error(f"获取作者论文错误: {str(e)}")
            if hasattr(e, "response") and e.response:
                logger.error(f"响应内容: {e.response.text}")
            return []

    def format_paper_info(self, paper: Dict) -> str:
        """
        格式化论文信息为可读字符串

        Args:
            paper: 论文信息字典

        Returns:
            格式化的论文信息字符串
        """
        parts = []

        # 标题
        if "title" in paper:
            parts.append(f"标题: {paper['title']}")

        # 作者
        if "authors" in paper and paper["authors"]:
            author_names = [
                author.get("name", "Unknown") for author in paper["authors"]
            ]
            parts.append(f"作者: {', '.join(author_names)}")

        # 发表年份和期刊/会议
        year_venue = []
        if "year" in paper and paper["year"]:
            year_venue.append(str(paper["year"]))
        if "venue" in paper and paper["venue"]:
            year_venue.append(paper["venue"])
        if year_venue:
            parts.append(f"发表: {' '.join(year_venue)}")

        # 摘要
        if "abstract" in paper and paper["abstract"]:
            parts.append(f"摘要: {paper['abstract']}")

        # TLDR (简短摘要)
        if "tldr" in paper and paper["tldr"] and paper["tldr"].get("text"):
            parts.append(f"简述: {paper['tldr']['text']}")

        # 引用计数
        if "citationCount" in paper:
            parts.append(f"引用数: {paper['citationCount']}")

        # 链接
        if "url" in paper and paper["url"]:
            parts.append(f"链接: {paper['url']}")

        return "\n".join(parts)


def main(args):
    """主函数"""
    api = SemanticScholarAPI(api_key=args.api_key)

    # 查询论文
    if args.query:
        logger.info(f"搜索: {args.query}")
        papers = api.search_papers(
            query=args.query, limit=args.limit, offset=args.offset, fields=args.fields
        )

        if not papers:
            logger.info("没有找到相关论文")
            return 1

        logger.info(f"找到 {len(papers)} 篇相关论文:")
        for i, paper in enumerate(papers, 1):
            paper_info = api.format_paper_info(paper)
            logger.info(f"\n--- 论文 {i} ---\n{paper_info}\n")

        # 保存结果到文件
        if args.output:
            with open(args.output, "w", encoding="utf-8") as f:
                json.dump(papers, f, ensure_ascii=False, indent=2)
            logger.info(f"结果已保存到: {args.output}")

    # 获取论文详情
    elif args.paper_id and args.paper_details:
        logger.info(f"获取论文 ID: {args.paper_id} 的详细信息")
        paper = api.get_paper_details(args.paper_id, fields=args.fields)

        if "error" in paper:
            logger.error(f"获取论文详情失败: {paper['error']}")
            return 1

        paper_info = api.format_paper_info(paper)
        logger.info(f"\n{paper_info}\n")

        # 保存结果到文件
        if args.output:
            with open(args.output, "w", encoding="utf-8") as f:
                json.dump(paper, f, ensure_ascii=False, indent=2)
            logger.info(f"结果已保存到: {args.output}")

    # 获取作者详情
    elif args.author_id:
        if args.author_papers:
            logger.info(f"获取作者 ID: {args.author_id} 的论文")
            papers = api.get_author_papers(
                args.author_id, limit=args.limit, fields=args.fields
            )

            if not papers:
                logger.info("没有找到该作者的论文")
                return 1

            logger.info(f"找到 {len(papers)} 篇论文:")
            for i, paper in enumerate(papers, 1):
                paper_info = api.format_paper_info(paper)
                logger.info(f"\n--- 论文 {i} ---\n{paper_info}\n")
        else:
            logger.info(f"获取作者 ID: {args.author_id} 的详细信息")
            author = api.get_author_details(args.author_id, fields=args.fields)

            if "error" in author:
                logger.error(f"获取作者详情失败: {author['error']}")
                return 1

            logger.info(f"作者名称: {author.get('name', 'Unknown')}")
            logger.info(f"论文数量: {author.get('paperCount', 'Unknown')}")
            logger.info(f"引用总数: {author.get('citationCount', 'Unknown')}")
            logger.info(f"H指数: {author.get('hIndex', 'Unknown')}")

        # 保存结果到文件
        if args.output:
            with open(args.output, "w", encoding="utf-8") as f:
                if args.author_papers:
                    json.dump(papers, f, ensure_ascii=False, indent=2)
                else:
                    json.dump(author, f, ensure_ascii=False, indent=2)
            logger.info(f"结果已保存到: {args.output}")

    else:
        logger.error("请提供搜索查询或论文/作者ID")
        return 1

    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Semantic Scholar API搜索工具")
    parser.add_argument("-q", "--query", default=None, type=str, help="搜索查询")
    parser.add_argument("-l", "--limit", default=5, type=int, help="结果数量限制")
    parser.add_argument("--offset", default=0, type=int, help="结果偏移量(用于分页)")
    parser.add_argument(
        "-f",
        "--fields",
        default="title,authors,abstract,year,venue,url",
        type=str,
        help="返回字段，逗号分隔",
    )
    parser.add_argument("-p", "--paper_id", default=None, type=str, help="论文ID")
    parser.add_argument(
        "-pd", "--paper_details", action="store_true", help="获取论文详情"
    )
    parser.add_argument("-a", "--author_id", default=None, type=str, help="作者ID")
    parser.add_argument(
        "-ap", "--author_papers", action="store_true", help="获取作者论文"
    )
    parser.add_argument(
        "-k", "--api_key", default=None, type=str, help="Semantic Scholar API密钥"
    )
    parser.add_argument("-o", "--output", default=None, type=str, help="输出文件路径")
    args = parser.parse_args()

    sys.exit(main(args))
