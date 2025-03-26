#!/usr/bin/env python
# -*- encoding=utf8 -*-

"""
文档切片工具

此模块提供了多种文档切片策略，用于将长文本分割成更小的片段以便进行索引和检索。
"""

import re
from typing import List, Dict, Any, Optional, Callable, Union
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class DocumentSplitter:
    """文档切片工具类"""
    
    @staticmethod
    def split_by_chunk(text: str, chunk_size: int = 1000, overlap: int = 100) -> List[Dict[str, Any]]:
        """
        按固定大小进行切片
        
        Args:
            text: 要切片的文本
            chunk_size: 每个切片的大小
            overlap: 切片之间的重叠字符数
            
        Returns:
            切片列表，每个切片是一个包含内容和元数据的字典
        """
        if not text:
            return []
            
        chunks = []
        start = 0
        text_length = len(text)
        
        chunk_id = 0
        while start < text_length:
            # 确定当前切片的结束位置
            end = min(start + chunk_size, text_length)
            
            # 提取当前切片
            chunk_text = text[start:end]
            
            # 创建切片对象
            chunks.append({
                "content": chunk_text,
                "metadata": {
                    "chunk_id": chunk_id,
                    "start_char": start,
                    "end_char": end,
                    "chunk_type": "fixed_size"
                }
            })
            
            # 更新下一个切片的起始位置，考虑重叠
            start = end - overlap if end < text_length else text_length
            chunk_id += 1
        
        return chunks
    
    @staticmethod
    def split_by_paragraph(text: str, min_paragraph_length: int = 50, merge_short: bool = True) -> List[Dict[str, Any]]:
        """
        按段落进行切片
        
        Args:
            text: 要切片的文本
            min_paragraph_length: 最小段落长度
            merge_short: 是否合并短段落
            
        Returns:
            切片列表，每个切片是一个包含内容和元数据的字典
        """
        if not text:
            return []
            
        # 使用多种换行符模式进行分割
        paragraphs = re.split(r'\n\s*\n|\r\n\s*\r\n|\r\s*\r', text)
        
        # 过滤掉空段落
        paragraphs = [p.strip() for p in paragraphs if p.strip()]
        
        if not paragraphs:
            return []
        
        # 处理短段落
        if merge_short:
            merged_paragraphs = []
            current_paragraph = ""
            
            for p in paragraphs:
                if len(current_paragraph) + len(p) < min_paragraph_length:
                    current_paragraph += " " + p if current_paragraph else p
                else:
                    if current_paragraph:
                        merged_paragraphs.append(current_paragraph)
                    current_paragraph = p
            
            if current_paragraph:  # 添加最后一个段落
                merged_paragraphs.append(current_paragraph)
                
            paragraphs = merged_paragraphs
        
        # 创建切片对象
        chunks = []
        start_char = 0
        for i, paragraph in enumerate(paragraphs):
            chunk_length = len(paragraph)
            chunks.append({
                "content": paragraph,
                "metadata": {
                    "chunk_id": i,
                    "start_char": start_char,
                    "end_char": start_char + chunk_length,
                    "chunk_type": "paragraph"
                }
            })
            start_char += chunk_length + 2  # +2 for the newline characters
        
        return chunks
    
    @staticmethod
    def split_by_section(text: str, section_patterns: List[str] = None) -> List[Dict[str, Any]]:
        """
        按章节标题进行切片
        
        Args:
            text: 要切片的文本
            section_patterns: 章节标题的正则表达式模式列表
            
        Returns:
            切片列表，每个切片是一个包含内容和元数据的字典
        """
        if not text:
            return []
            
        # 默认的章节标题模式
        if section_patterns is None:
            section_patterns = [
                r'^\s*(?:Chapter|CHAPTER)\s+\d+\s*(?::|\.|\s)\s*(.+)$',  # Chapter 1: Title
                r'^\s*\d+\.\s+(.+)$',  # 1. Title
                r'^\s*\d+\.\d+\s+(.+)$',  # 1.1 Title
                r'^\s*(?:Section|SECTION)\s+\d+\s*(?::|\.|\s)\s*(.+)$',  # Section 1: Title
                r'^\s*(?:Abstract|ABSTRACT)\s*$',  # Abstract
                r'^\s*(?:Introduction|INTRODUCTION)\s*$',  # Introduction
                r'^\s*(?:Conclusion|CONCLUSION|Conclusions|CONCLUSIONS)\s*$',  # Conclusion(s)
                r'^\s*(?:Discussion|DISCUSSION)\s*$',  # Discussion
                r'^\s*(?:Methods|METHODS|Methodology|METHODOLOGY)\s*$',  # Methods
                r'^\s*(?:Results|RESULTS)\s*$',  # Results
                r'^\s*(?:References|REFERENCES|Bibliography|BIBLIOGRAPHY)\s*$'  # References
            ]
        
        # 组合所有模式进行匹配
        combined_pattern = '|'.join(f'({p})' for p in section_patterns)
        
        # 查找所有章节标题的位置
        matches = list(re.finditer(combined_pattern, text, re.MULTILINE))
        
        if not matches:
            # 如果没有找到章节标题，则返回整个文本作为一个切片
            return [{
                "content": text,
                "metadata": {
                    "chunk_id": 0,
                    "start_char": 0,
                    "end_char": len(text),
                    "chunk_type": "full_document",
                    "title": "Full Document"
                }
            }]
        
        chunks = []
        for i, match in enumerate(matches):
            # 章节标题
            title = match.group(0).strip()
            
            # 章节起始位置
            start_pos = match.start()
            
            # 章节结束位置 (下一个章节的开始或文本结束)
            end_pos = matches[i+1].start() if i < len(matches) - 1 else len(text)
            
            # 提取章节内容 (包含标题)
            section_text = text[start_pos:end_pos].strip()
            
            chunks.append({
                "content": section_text,
                "metadata": {
                    "chunk_id": i,
                    "start_char": start_pos,
                    "end_char": end_pos,
                    "chunk_type": "section",
                    "title": title
                }
            })
        
        return chunks

    @staticmethod
    def split_text(text: str, method: str = "chunk", **kwargs) -> List[Dict[str, Any]]:
        """
        根据指定方法切分文本
        
        Args:
            text: 要切分的文本
            method: 切分方法 ('chunk', 'paragraph', 'section')
            **kwargs: 传递给具体切分方法的参数
            
        Returns:
            切片列表
        """
        if not text:
            return []
            
        if method == "chunk":
            chunk_size = kwargs.get("chunk_size", 1000)
            overlap = kwargs.get("overlap", 100)
            return DocumentSplitter.split_by_chunk(text, chunk_size, overlap)
            
        elif method == "paragraph":
            min_length = kwargs.get("min_paragraph_length", 50)
            merge_short = kwargs.get("merge_short", True)
            return DocumentSplitter.split_by_paragraph(text, min_length, merge_short)
            
        elif method == "section":
            patterns = kwargs.get("section_patterns", None)
            return DocumentSplitter.split_by_section(text, patterns)
            
        else:
            logger.warning(f"未知的切分方法: {method}，使用默认的chunk方法")
            return DocumentSplitter.split_by_chunk(text)


# 测试代码
if __name__ == "__main__":
    sample_text = """
# Introduction

This is a sample document to test the document splitter.
This paragraph is part of the introduction.

# Methods

Here we describe the methods used in our study.
The methods include several steps.

## Data Collection

Data was collected from multiple sources.
We ensured the quality of data.

## Analysis

We performed statistical analysis.
The analysis revealed interesting patterns.

# Results

Our results indicate significant findings.
The significance was p < 0.05.

# Discussion

We discuss the implications of our findings.
Future work should expand on these results.

# References

[1] Smith, J. (2020). Document splitting techniques.
[2] Jones, A. (2019). Text processing algorithms.
"""

    print("=== 按固定大小切片 ===")
    chunks = DocumentSplitter.split_text(sample_text, "chunk", chunk_size=200, overlap=50)
    for i, chunk in enumerate(chunks):
        print(f"Chunk {i+1} ({len(chunk['content'])} chars): {chunk['content'][:50]}...")
    
    print("\n=== 按段落切片 ===")
    chunks = DocumentSplitter.split_text(sample_text, "paragraph")
    for i, chunk in enumerate(chunks):
        print(f"Paragraph {i+1} ({len(chunk['content'])} chars): {chunk['content'][:50]}...")
    
    print("\n=== 按章节切片 ===")
    chunks = DocumentSplitter.split_text(sample_text, "section")
    for i, chunk in enumerate(chunks):
        print(f"Section {i+1}: {chunk['metadata']['title']}")
        print(f"Content ({len(chunk['content'])} chars): {chunk['content'][:50]}...")
