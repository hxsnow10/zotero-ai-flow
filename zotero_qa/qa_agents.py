import autogen
from autogen.agentchat.contrib.retrieve_assistant_agent import RetrieveAssistantAgent
from autogen.agentchat.contrib.retrieve_user_proxy_agent import RetrieveUserProxyAgent
from autogen_agentchat.agents import AssistantAgent
from autogen_agentchat.teams import RoundRobinGroupChat
from autogen_ext.models.openai import OpenAIChatCompletionClient
from autogen_core.tools import FunctionTool
from autogen_agentchat.conditions import TextMentionTermination
from autogen_agentchat.messages import TextMessage,ChatMessage
from typing import List, Dict, Any, Optional, Union, Callable
import logging
import json
import os
import sys
import asyncio

# 更新日志格式，包含文件名、函数名和行号
logger = logging.getLogger(__name__)
logger.setLevel(logging.WARNING)

# 处理相对导入
from search_tools import search_arxiv, search_elasticsearch, search_zotero

# 定义搜索工具列表
tools = [
    {
        "name": "search_zotero",
        "description": "Search papers in Zotero library",
        "function": search_zotero
    },
    {
        "name": "search_elasticsearch",
        "description": "Search papers in Elasticsearch index",
        "function": search_elasticsearch
    },
    {
        "name": "search_arxiv",
        "description": "Search papers on arXiv",
        "function": search_arxiv
    }
]
TOOLS = [FunctionTool(tool["function"],description=tool["description"]) for tool in tools]

class ZoteroQASystem:
    """基于AutoGen的Zotero问答系统"""
    
    def __init__(self, config_path: str = None):
        """
        初始化Zotero问答系统
        
        Args:
            config_path: 配置文件路径
        """
        # 加载配置
        self.config = self._load_config(config_path)
        
        self.model_client = OpenAIChatCompletionClient(
            model = "deepseek-chat",
            api_key = os.getenv("DEEPSEEK_API_KEY",""),  # 如果需要的话
            base_url =  "https://api.deepseek.com/v1",  # 自定义API端点
            api_type = "open_ai",  # 使用OpenAI兼容接口
            timeout=120,  # API超时时间
            max_retries=3,  # 最大重试次数
            model_info={
                "vision": False,  # 是否支持视觉输入
                "function_calling": True,  # 是否支持函数调用
                "json_output": False,  # 是否支持 JSON 格式输出
                "family": "unknown"  # 模型家族信息
            }
        )
        
        # 初始化智能体
        self._setup_agents()
    
    def _load_config(self, config_path: str) -> Dict[str, Any]:
        """加载配置文件"""
        config= {}
        try:
            with open(config_path, 'r') as f:
                config = json.load(f)
                # 合并默认配置
                return config
        except Exception as e:
            logger.error(f"加载配置文件出错: {str(e)}")
            return config
    
    def _setup_agents(self):
        """设置智能体系统"""
        # 用户代理
        
        # 助手智能体 - 主要交互智能体
        assistant_agent = AssistantAgent(
            "assistant",
            system_message="""你是一位有用的学术论文研究助手。
            你帮助用户查找论文并从中提取信息。
            对于任何问题，首先理解用户需求，然后利用可用的工具来完成请求。
            使用search_zotero, search_elasticsearch或search_arxiv工具。必须使用所有工具。，
            回答要简洁、精确且有帮助。
            
            你可能需要多次优化你的结果：eval_agent会评估你的结果并返回你的问题，你需要参考然后可能需要重新调用工具，修改参数，优化输出。
            """,
            model_client=self.model_client,
            tools = TOOLS,
            reflect_on_tool_use = True,
        )

        eval_agent = AssistantAgent(
            "eval",
            system_message = """你是一位评估助手,帮助用户基于问题评估assistant产生的结果。
            如果你认可结果,则输出APPROVE,否则输出 REJECT以及存在的问题。""",
            model_client = self.model_client,
        )
        termination = TextMentionTermination("APPROVE")
        self.team = RoundRobinGroupChat([assistant_agent,eval_agent],termination_condition=termination,max_turns=3)

    async def get_answer(self, message: str = None, context: Dict[str, Any] = None) -> str:
        """
        获取问题的答案
        
        Args:
            message: 用户问题
            context: 可选的上下文信息，例如：
                    {
                       "selected_items": ["item_key1", "item_key2"],
                       "selected_text": "选中的文本",
                       "context_text": "上下文文本", 
                       "window_type": "窗口类型"
                    }
                    
        Returns:
            回答内容
        """
        # 将context转换为字符串
        if context is None:
            context = ""
        elif isinstance(context, dict):
            context = json.dumps(context, ensure_ascii=False)
        
        task = "question: " + message + "\nfollowing is the question context\n" + context
        
        # 使用AutoGen自己处理事件循环的方式运行
        try:
            result_info = None
            """
            result = await self.team.run(task=task)
            print(result)
            for msg in result.messages:
                print(msg)
                if msg.source == "assistant":
                    result_info = msg.content
            """
            result = self.team.run_stream(task=task)
            print(result)
            async for msg in result:
                print(msg)
                if isinstance(msg,TextMessage) and msg.source == "assistant":
                    result_info = msg.content
            return result_info
        except Exception as e:
            logger.error(f"运行QA系统出错: {str(e)}")
            import traceback
            logger.error(traceback.format_exc())
            return f"发生错误: {str(e)}"
        
async def main():
        # 设置日志级别
    if args.debug:
        logging.getLogger().setLevel(logging.DEBUG)
        logger.debug("调试模式已启用")
    
    print("=" * 50)
    print("Zotero QA System 测试")
    print("=" * 50)
    print(f"配置文件: {args.config}")
    print(f"问题: {args.query}")
    print("-" * 50)
    problems = [
        {"query": "介绍neural network", "context":""},
        # {"query": "解释下这个句子", "context":"selected_text:  deepseek使用了GRPO的训练方法 selected_items: "},

    ]
        # 初始化QA系统
    config_path = os.path.abspath(args.config)
    qa_system = ZoteroQASystem(config_path=config_path)
    print("开始问答...\n")

    for problem in problems:
        
        query = problem["query"]
        context = problem.get("context", "")
        print(f"问题: {query}, 上下文: {context}")
        try:
            # 开始问答交互
            
            # 使用asyncio运行异步函数
            answer = await qa_system.get_answer(message=query, context=context)
            print(f"回答: {answer}")
            
        except Exception as e:
            logger.error(f"错误: {str(e)}")
            import traceback
            logger.error(traceback.format_exc())
            # sys.exit(1)
    
    print("\n" + "=" * 50)
    print("测试完成")

if __name__ == "__main__":
    import argparse
    
    # 创建命令行参数解析器
    parser = argparse.ArgumentParser(description="Zotero QA System 命令行测试工具")
    parser.add_argument("--config", type=str, default="config.json", help="配置文件路径")
    parser.add_argument("--query", type=str, default="介绍deepseek", help="要提问的问题")
    parser.add_argument("--debug", action="store_true", help="启用调试模式")
    args = parser.parse_args()

    asyncio.run(main())
    

