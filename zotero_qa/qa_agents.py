import autogen
from autogen import AssistantAgent, UserProxyAgent, ConversableAgent, GroupChat, GroupChatManager
from autogen.agentchat.contrib.retrieve_assistant_agent import RetrieveAssistantAgent
from autogen.agentchat.contrib.retrieve_user_proxy_agent import RetrieveUserProxyAgent
from autogen_core.tools import FunctionTool
from typing import List, Dict, Any, Optional, Union, Callable
import logging
import json
import os
import sys

# 更新日志格式，包含文件名、函数名和行号
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - [%(filename)s:%(funcName)s:%(lineno)d] - %(message)s'
)
logger = logging.getLogger(__name__)

# 处理相对导入
from .search_tools import search_arxiv, search_elasticsearch, search_zotero

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
                
        try:
            with open(config_path, 'r') as f:
                config = json.load(f)
                # 合并默认配置
                return config
        except Exception as e:
            logger.error(f"加载配置文件出错: {str(e)}")
            return default_config
    
    def _setup_agents(self):
        """设置智能体系统"""
        # 用户代理
        self.user_proxy = UserProxyAgent(
            name="user_proxy",
            human_input_mode="TERMINATE",
            max_consecutive_auto_reply=10,
            system_message="你是一位研究人员，需要从学术论文中查找信息。",
            code_execution_config={"work_dir": self.config.get("work_dir", "./workspace")}
        )
        
        # 助手智能体 - 主要交互智能体
        self.assistant = AssistantAgent(
            name="assistant",
            system_message="""你是一位有用的学术论文研究助手。
            你帮助用户查找论文并从中提取信息。
            对于任何问题，首先理解用户需求，然后利用可用的工具来完成请求。
            当需要查找特定信息时，使用search_zotero, search_elasticsearch或search_arxiv工具。
            回答要简洁、精确且有帮助。""",
            model_client=self.model_client,
            tools = TOOLS
        )
        
        # 注册工具
        self._register_tools()
        
    def _register_tools(self):
        """注册搜索工具函数供智能体使用"""

    
    def get_answer(self, message: str = None, context: Dict[str, Any] = None) -> str:
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
        if not message:
            message = "请告诉我如何使用这个系统查找论文信息。"
        
        # 准备用户消息
        user_message = message
        if context:
            # 如果有上下文，将其添加到消息中
            context_str = ""
            if context.get("selected_items"):
                context_str += f"所选论文: {', '.join(context['selected_items'])}\n"
            if context.get("selected_text"):
                context_str += f"所选文本: {context['selected_text']}\n"
            if context.get("context_text"):
                context_str += f"上下文: {context['context_text']}\n"
            
            if context_str:
                user_message = f"{context_str}\n\n问题: {message}"
        
        # 启动对话并获取回复
        chat_result = self.user_proxy.initiate_chat(
            self.assistant,
            message=user_message,
            summary_method="last_msg"
        )
        
        # 提取回复
        if hasattr(chat_result, "summary") and chat_result.summary:
            return chat_result.summary
        elif hasattr(chat_result, "messages") and chat_result.messages:
            return chat_result.messages[-1]["content"]
        else:
            return "抱歉，无法获取有效回答"

    def start_chat(self, message: str = None, context: Dict[str, Any] = None):
        """
        启动对话界面
        
        Args:
            message: 用户问题
            context: 上下文信息
        """
        # 启动对话
        self.user_proxy.initiate_chat(
            self.assistant,
            message=message or "你好，我需要查找一些学术论文信息，可以帮助我吗？"
        )


if __name__ == "__main__":
    import argparse
    
    # 创建命令行参数解析器
    parser = argparse.ArgumentParser(description="Zotero QA System 命令行测试工具")
    parser.add_argument("--config", type=str, default="config.json", help="配置文件路径")
    parser.add_argument("--query", type=str, default="查找关于机器学习的最新研究", help="要提问的问题")
    parser.add_argument("--debug", action="store_true", help="启用调试模式")
    args = parser.parse_args()
    
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
    
    try:
        # 初始化QA系统
        config_path = os.path.abspath(args.config)
        qa_system = ZoteroQASystem(config_path=config_path)
        
        # 开始问答交互
        print("开始问答...\n")
        qa_system.start_chat(message=args.query)
        
    except Exception as e:
        logger.error(f"错误: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        sys.exit(1)
    
    print("\n" + "=" * 50)
    print("测试完成")
