#!/usr/bin/env python
# -*- encoding=utf8
# @author      : xiahong
# @file        : aliyun_embedding.py
# @created     : 2025-03-24 13:58:08

"""
Example:
    python aliyun_embedding.py --text "这是一段测试文本"
    python aliyun_embedding.py --input_path texts.txt
"""

import sys
import argparse
import os
import json
import numpy as np
from typing import Union, List, Optional
from openai import OpenAI

def get_openai_client(api_key: Optional[str] = None):
    """
    创建并返回OpenAI客户端实例
    
    Args:
        api_key: 可选的API密钥，如果未提供则从环境变量获取
        
    Returns:
        OpenAI客户端实例
    """
    api_key = os.getenv("ALIYUN_API_KEY")
    if not api_key:
        raise ValueError("API密钥未提供，请设置ALIYUN_API_KEY环境变量或传入api_key参数")
            
    return OpenAI(
        api_key=api_key,
        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1"  # 百炼服务的base_url
    )

client = get_openai_client()

def get_text_vec_aliyun(
    text: Union[str, List[str]], 
    dimensions: int = 1024, 
    model: str = "text-embedding-v3",
    batch_size: int = 10,
    max_length: int = 8192
) -> Union[List[float], List[List[float]]]:
    """
    获取文本的向量表示
    
    Args:
        text: 输入文本或文本列表
        dimensions: 向量维度，默认1024
        model: 使用的模型名称
        api_key: 可选的API密钥，如果未提供则从环境变量获取
        batch_size: 批处理大小，避免发送过多文本
        max_length: 单个文本的最大长度
        
    Returns:
        文本的向量表示，如果输入是单个文本则返回向量，如果是列表则返回向量列表
    """

    
    # 统一转换为列表格式处理
    is_single = isinstance(text, str)
    texts = [text] if is_single else text
    
    # 检查文本长度，如果过长则截断
    processed_texts = []
    for t in texts:
        if len(t) > max_length:
            # 超过限制的文本有几种处理方式 1）截断向量化 2）按长度切片存储 3）按段落切片，如果太长了，内部切片后取向量mean或者max
            print(f"警告: 文本长度超过{max_length}，将被截断")
            processed_texts.append(t[:max_length])
        else:
            processed_texts.append(t)
    
    # 分批处理
    all_vectors = []
    for i in range(0, len(processed_texts), batch_size):
        batch = processed_texts[i:i+batch_size]
        try:
            completion = client.embeddings.create(
                model=model,
                input=batch,
                dimensions=dimensions,
                encoding_format="float"
            )
            
            # 提取向量
            for embed_data in completion.data:
                all_vectors.append(embed_data.embedding)
        except Exception as e:
            print(f"获取文本向量时出错: {str(e)}")
            # 如果发生错误，返回零向量
            for _ in range(len(batch)):
                all_vectors.append([0.0] * dimensions)
    
    # 返回单个向量或向量列表
    return all_vectors[0] if is_single else all_vectors

def average_vectors(vectors: List[List[float]]) -> List[float]:
    """
    计算多个向量的平均值
    
    Args:
        vectors: 向量列表
        
    Returns:
        平均向量
    """
    return list(np.mean(vectors, axis=0).tolist())

def main(args):
    """主函数"""
    texts = []
    
    # 从文件读取文本
    if args.input_path:
        try:
            with open(args.input_path, 'r', encoding='utf-8') as f:
                if args.input_path.endswith('.json'):
                    # 假设JSON文件包含文本列表
                    texts = json.load(f)
                else:
                    # 假设每行一个文本
                    texts = [line.strip() for line in f if line.strip()]
        except Exception as e:
            print(f"读取文件时出错: {str(e)}")
            return 1
    
    # 使用命令行参数的文本
    elif args.text:
        texts = [args.text]
    
    # 如果没有输入，使用示例文本
    else:
        texts = [
            'The clothes are of good quality and look good, definitely worth the wait. I love them.',
            "我爱你"
        ]
    
    # 获取向量
    vectors = get_text_vec_aliyun(
        texts, 
        dimensions=args.dimensions,
        model=args.model
    )
    
    # 输出结果
    if len(vectors) == 1:
        print(f"向量维度: {len(vectors[0])}")
        if args.verbose:
            print(f"向量: {vectors[0]}")
    else:
        print(f"生成了 {len(vectors)} 个向量，每个维度: {len(vectors[0])}")
        if args.verbose:
            for i, vec in enumerate(vectors):
                print(f"向量 {i+1}: {vec[:5]}... (仅显示前5个元素)")
    
    # 如果需要保存到文件
    if args.output_path:
        try:
            with open(args.output_path, 'w', encoding='utf-8') as f:
                json.dump(vectors, f)
            print(f"向量已保存到: {args.output_path}")
        except Exception as e:
            print(f"保存向量时出错: {str(e)}")
            return 1
    
    return 0

# https://help.aliyun.com/zh/model-studio/user-guide/batch-inference?scm=20140722.S_help%40%40%E6%96%87%E6%A1%A3%40%402864784.S_BB2%40bl%2BRQW%40ag0%2BBB1%40ag0%2Bos0.ID_2864784-RL_%E6%89%B9%E9%87%8F-LOC_doc%7EUND%7Eab-OR_ser-PAR1_212a5d3e17427987638825874dc73f-V_4-P0_0-P1_0&spm=a2c4g.11186623.help-search.i20&userCode=okjhlpr5

if __name__ == "__main__":                                                                                                                                                                                                                    
    parser = argparse.ArgumentParser(description="获取文本的向量表示")
    parser.add_argument("-i", "--input_path", default=None, type=str, help="输入文本文件路径，每行一个文本或JSON文件")
    parser.add_argument("-o", "--output_path", default=None, type=str, help="输出向量文件路径（JSON格式）")
    parser.add_argument("-t", "--text", default=None, type=str, help="要处理的文本")
    parser.add_argument("-d", "--dimensions", default=1024, type=int, help="向量维度")
    parser.add_argument("-m", "--model", default="text-embedding-v3", type=str, help="使用的模型名称")
    parser.add_argument("-v", "--verbose", action="store_true", help="显示详细输出")
    args = parser.parse_args()

    sys.exit(main(args))