#!/usr/bin/env python
# -*- encoding=utf8
# @author      : xiahong
# @file        : zotero_search.py
# @created     : 2025-03-24 21:44:48

"""
Example:
    python zotero_search.py
"""

import sys
import argparse
import os
import logging
from typing import List, Dict, Any

# Configure logger
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


class ZoteroSearchTool:
    """Zotero搜索工具，用于从Zotero获取论文信息"""

    def __init__(
        self, zotero_api_key=None, zotero_library_id=None, zotero_library_type="user"
    ):
        self.api_key = zotero_api_key
        self.library_id = zotero_library_id
        self.library_type = zotero_library_type

    def search(self, query: str, size: int = 10) -> List[Dict[str, Any]]:
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
            results = zot.items(q=query, limit=size)

            # 转换为更易于使用的格式
            formatted_results = []
            for item in results:
                data = item["data"]
                formatted_result = {
                    "key": data.get("key", ""),
                    "title": data.get("title", ""),
                    "abstract": data.get("abstractNote", ""),
                    "authors": data.get("creators", []),
                    "date": data.get("date", ""),
                    "tags": data.get("tags", []),
                    "url": data.get("url", ""),
                    "doi": data.get("DOI", ""),
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

            data = item["data"]
            formatted_result = {
                "key": data.get("key", ""),
                "title": data.get("title", ""),
                "abstract": data.get("abstractNote", ""),
                "authors": data.get("creators", []),
                "date": data.get("date", ""),
                "tags": data.get("tags", []),
                "url": data.get("url", ""),
                "doi": data.get("DOI", ""),
            }

            return formatted_result
        except Exception as e:
            logger.error(f"Error getting Zotero item: {str(e)}")
            return {}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("-i", "--input_path", default=None, type=str)
    parser.add_argument("--foo", action="store_true")
    args = parser.parse_args()

    sys.exit(main(args))
