"""
Zotero QA System using AutoGen

此模块可直接作为本地脚本运行，无需安装。

运行方式:
    python zotero_qa/main.py --query "你的研究问题"
"""

# 为了使相对导入正常工作
from os.path import dirname, basename, isfile, join
import glob
import sys

# 此导入保留，但不影响直接运行脚本
try:
    from .qa_agents import ZoteroQASystem
    from .search_tools import ZoteroSearchTool, ElasticsearchSearchTool, ArxivSearchTool
except ImportError:
    pass

__version__ = "0.1.0"
