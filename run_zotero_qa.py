#!/usr/bin/env python
# -*- encoding=utf8 -*-

"""
Zotero QA System 主启动脚本

此脚本是整个系统的便捷入口点，无需安装到Python环境中即可运行。

使用方法:
    # 基本用法
    python run_zotero_qa.py

    # 提供问题
    python run_zotero_qa.py --query "查找关于机器学习在医疗领域的最新研究"

    # 使用自定义配置
    python run_zotero_qa.py --config path/to/config.json

    # 运行示例
    python run_zotero_qa.py --examples
"""

import os
import sys
import argparse


def main():
    parser = argparse.ArgumentParser(description="Zotero QA System")
    parser.add_argument(
        "--config", type=str, default="config.json", help="配置文件路径"
    )
    parser.add_argument("--query", type=str, default=None, help="搜索查询")
    parser.add_argument("--debug", action="store_true", help="启用调试模式")
    parser.add_argument("--examples", action="store_true", help="运行使用示例")
    args = parser.parse_args()

    if args.examples:
        # 运行示例
        print("正在运行示例...")
        import zotero_qa.examples

        sys.exit(0)
    else:
        # 构建命令行参数
        cmd_args = []
        if args.config:
            cmd_args.extend(["--config", args.config])
        if args.query:
            cmd_args.extend(["--query", args.query])
        if args.debug:
            cmd_args.append("--debug")

        # 导入并运行主程序
        from zotero_qa.main import main as run_qa

        sys.exit(run_qa(cmd_args))


if __name__ == "__main__":
    main()
