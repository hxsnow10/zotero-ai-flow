#!/usr/bin/env python
# -*- encoding=utf8 -*-

"""
Zotero QA System using AutoGen

示例用法:
    # 使用默认配置启动交互式问答
    python zotero_qa/main.py
    
    # 使用自定义配置文件
    python zotero_qa/main.py --config my_config.json
    
    # 直接提供初始问题
    python zotero_qa/main.py --query "查找关于机器学习在医疗领域的最新研究"
    
    # 启用调试模式
    python zotero_qa/main.py --debug
"""

import os
import sys
import argparse
import logging
from typing import Dict, List, Any, Optional, Union

# 添加项目根目录到Python路径，使得能够直接运行而不需要安装
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from zotero_qa.qa_agents import ZoteroQASystem

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def parse_args():
    """解析命令行参数"""
    parser = argparse.ArgumentParser(description="Zotero QA System using AutoGen")
    
    parser.add_argument(
        "--config", 
        type=str, 
        default="config.json",
        help="Path to configuration file"
    )
    
    parser.add_argument(
        "--query", 
        type=str, 
        default=None,
        help="Initial query to start the conversation"
    )
    
    parser.add_argument(
        "--debug", 
        action="store_true",
        help="Enable debug logging"
    )
    
    return parser.parse_args()

def main():
    """主函数"""
    args = parse_args()
    
    # 设置日志级别
    if args.debug:
        logging.getLogger().setLevel(logging.DEBUG)
        logger.debug("Debug logging enabled")
    
    # 初始化QA系统
    try:
        config_path = os.path.abspath(args.config) if args.config else None
        qa_system = ZoteroQASystem(config_path=config_path)
        
        # 启动聊天
        qa_system.start_chat(message=args.query)
        
        return 0
    except KeyboardInterrupt:
        logger.info("Program interrupted by user")
        return 0
    except Exception as e:
        logger.error(f"Error: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return 1

if __name__ == "__main__":
    sys.exit(main())
