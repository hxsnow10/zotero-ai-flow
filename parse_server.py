import os
import sys
import hashlib
import json
import argparse
import logging
from pathlib import Path
from fastapi import FastAPI, UploadFile, Form, HTTPException, Request
from datetime import datetime
from paper_summary import PaperSummarizer
import sqlite3
import uvicorn
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain.schema import Document
from langchain_community.document_loaders import PyPDFLoader
from markdown_it import MarkdownIt
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware
import traceback

# 导入新增接口需要的模块
from zotero_qa.qa_agents import ZoteroQASystem # type: ignore
from build_zotero_es_index import insert_zotero_item, load_config
from zotero_qa.document_splitter import DocumentSplitter
from zotero_qa.search_es import ElasticsearchClient
from pyzotero import zotero

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levellevel)s - [%(filename)s:%(funcName)s:%(lineno)d] - %(message)s',
    handlers=[
        logging.FileHandler("zotero_es_index.log"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# 初始化限制器
limiter = Limiter(key_func=get_remote_address)

# 初始化 FastAPI 服务器
app = FastAPI()

# 添加中间件支持代理头信息
app.add_middleware(ProxyHeadersMiddleware, trusted_hosts=["*"])
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["*"])  # 生产环境建议配置具体域名

# 添加限制器异常处理
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# 配置数据库缓存
DB_PATH = "summary_cache.db"
conn = sqlite3.connect(DB_PATH)
cursor = conn.cursor()
try:
    cursor.execute(
        """
    CREATE TABLE IF NOT EXISTS summaries (
        title TEXT,
        link TEXT,
        pdf_hash TEXT PRIMARY KEY,
        summary TEXT,
        model_name TEXT
    )
    """
    )
    conn.commit()
except sqlite3.Error as e:
    print(f"Database error: {e}")
except Exception as e:
    print(f"Unexpected error: {e}")


def compute_pdf_hash(file_path: Path) -> str:
    """计算 PDF 文件的哈希值"""
    hasher = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(8192):
            hasher.update(chunk)
    return hasher.hexdigest()


def get_cached_summary(title: str, link: str, pdf_hash: str):
    """检查是否已有缓存的论文总结，优先匹配 pdf_hash，其次匹配 link，最后匹配 title"""
    try:
        cursor.execute(
            """
            SELECT summary, model_name FROM summaries
            WHERE pdf_hash = ?
        """,
            (pdf_hash,),
        )
        result = cursor.fetchone()
        if result:
            return result

        cursor.execute(
            """
            SELECT summary, model_name FROM summaries
            WHERE link = ?
        """,
            (link,),
        )
        result = cursor.fetchone()
        if result:
            return result

        cursor.execute(
            """
            SELECT summary, model_name FROM summaries
            WHERE title = ?
        """,
            (title,),
        )
        return cursor.fetchone()
    except sqlite3.Error as e:
        print(f"Database query error: {e}")
        return None


def cache_summary(title: str, link: str, pdf_hash: str, summary: str, model_name: str):
    """缓存论文总结"""
    try:
        cursor.execute(
            """
            INSERT INTO summaries (title, link, pdf_hash, summary, model_name)
            VALUES (?, ?, ?, ?, ?)
        """,
            (title, link, pdf_hash, summary, model_name),
        )
        conn.commit()
    except sqlite3.Error as e:
        print(f"Database insert error: {e}")
    except Exception as e:
        print(f"Unexpected error while caching: {e}")


# summarizer = PaperSummarizer()

# 初始化QA系统和ES客户端
qa_system = None
es_client = None
document_splitter = None
zot = None
config = None

def init_services(config_path="config.json"):
    """初始化服务组件"""
    global qa_system, es_client, document_splitter, zot, config
    
    # 加载配置
    config = load_config(config_path)
    
    # 初始化QA系统
    if qa_system is None:
        try:
            qa_system = ZoteroQASystem(config_path=config_path)
            logger.info("QA系统初始化成功")
        except Exception as e:
            logger.error(f"QA系统初始化失败: {str(e)}")
    
    # 初始化ES客户端
    if es_client is None:
        try:
            es_config = config.get("elasticsearch", {})
            vector_dim = config.get("zotero_indexing", {}).get("vector_dim", es_config.get("vector_dim", 1024))
            
            # 创建自定义映射
            mapping = {
                "mappings": {
                    "properties": {
                        "zotero_key": {"type": "keyword"},
                        "parent_id": {"type": "keyword"},
                        "chunk_id": {"type": "integer"},
                        "is_chunk": {"type": "boolean"},
                        "chunk_type": {"type": "keyword"},
                        "chunk_title": {"type": "text"},
                        "start_char": {"type": "integer"},
                        "end_char": {"type": "integer"},
                        "title": {"type": "text", "analyzer": "standard", "fields": {"keyword": {"type": "keyword"}}},
                        "abstract": {"type": "text", "analyzer": "standard"},
                        "content": {"type": "text", "analyzer": "standard"},
                        "date": {"type": "date", "format": "yyyy-MM-dd||yyyy||epoch_millis", "ignore_malformed": True},
                        "creators": {"type": "text", "fields": {"keyword": {"type": "keyword"}}},
                        "tags": {"type": "keyword"},
                        "item_type": {"type": "keyword"},
                        "notes": {"type": "text", "analyzer": "standard"},
                        "text_for_embedding": {"type": "text", "analyzer": "standard"},
                        "indexed_at": {"type": "date"},
                        "vector": {
                            "type": "dense_vector",
                            "dims": vector_dim,
                            "index": True,
                            "similarity": "cosine"
                        }
                    }
                },
                "settings": {
                    "number_of_shards": 1,
                    "number_of_replicas": 0,
                    "analysis": {
                        "analyzer": {
                            "standard": {
                                "type": "standard",
                                "max_token_length": 255
                            }
                        }
                    }
                }
            }
            
            es_client = ElasticsearchClient(
                hosts=es_config.get("host", "http://localhost:9200"),
                index_name=es_config.get("index", "zotero_papers"),
                vector_dim=vector_dim,
                mapping=mapping
            )
            logger.info("ES客户端初始化成功")
        except Exception as e:
            logger.error(f"ES客户端初始化失败: {str(e)}")
    
    # 初始化文档切片器
    if document_splitter is None:
        try:
            document_splitter = DocumentSplitter()
            logger.info("文档切片器初始化成功")
        except Exception as e:
            logger.error(f"文档切片器初始化失败: {str(e)}")
    
    # 初始化Zotero客户端
    if zot is None:
        try:
            zotero_config = config.get("zotero", {})
            zot = zotero.Zotero(
                library_id=zotero_config.get("library_id", ""),
                library_type=zotero_config.get("library_type", "user"),
                api_key=zotero_config.get("api_key", "")
            )
            logger.info("Zotero客户端初始化成功")
        except Exception as e:
            logger.error(f"Zotero客户端初始化失败: {str(e)}")

# 在服务器启动时初始化服务
init_services()

@app.post("/upload")
@limiter.limit("1000/minute")  # 限制每个IP每分钟最多3次请求
async def upload_paper(
    request: Request,
    title: str = Form(...),
    link: str = Form(...),
    secret: str = Form(...),
    pdf: UploadFile = UploadFile(...),
):
    """上传论文 PDF 并返回总结"""
    print(f'------------- /upload ({datetime.now().strftime("%Y-%m-%d %H:%M:%S")}) -------------')
    real_secret = os.getenv("SECRET_KEY")
    if secret != real_secret:
        raise HTTPException(status_code=403, detail="Invalid secret key")

    pdf_path = Path(f"uploads/{pdf.filename}")
    os.makedirs(pdf_path.parent, exist_ok=True)
    data = await pdf.read()
    print(f"New request: title={title}, link={link}, pdf.filename={pdf.filename}")
    with open(pdf_path, "wb") as buffer:
        buffer.write(data)

    # 计算 PDF 哈希值
    pdf_hash = compute_pdf_hash(pdf_path)

    # 查询缓存
    cached = get_cached_summary(title, link, pdf_hash)
    if cached:
        summary, model_name = cached
        print("Already cached!")
        return {"summary": summary, "model_name": model_name, "cached": True}

    # 生成论文总结
    try:
        print("Start summary...")
        summary = summarizer.summarize_paper(title, pdf_path)
        model_name = summarizer.model_name
        cache_summary(title, link, pdf_hash, summary, model_name)
        return {"summary": summary, "model_name": model_name, "cached": False}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/parse_pdf")
@limiter.limit("1000/minute")  # 限制每个IP每分钟最多5次请求
async def parse_pdf(
    request: Request,
    title: str = Form(...),
    link: str = Form(...),
    chunk_size: int = Form(...),
    chunk_overlap: int = Form(...),
    pdf: UploadFile = UploadFile(...),
):
    """上传并解析 PDF，返回文本片段"""
    print(f'------------- /parse_pdf ({datetime.now().strftime("%Y-%m-%d %H:%M:%S")}) -------------')
    pdf_path = Path(f"uploads/{pdf.filename}")
    os.makedirs(pdf_path.parent, exist_ok=True)
    data = await pdf.read()
    print(f"New parse request: title={title}, link={link}, pdf.filename={pdf.filename}")
    with open(pdf_path, "wb") as buffer:
        buffer.write(data)

    try:
        # 使用 PyPDFLoader 解析 PDF
        loader = PyPDFLoader(pdf_path)
        pages = loader.load()

        references_pages = []
        for k,page in enumerate(pages):
            if "References" in page.page_content:
                references_pages.append(k)
        if len(references_pages)>=1 and references_pages[-1]>len(pages)/2:
            pages = pages[:references_pages[-1]+1]
        
        if len(pages)>=50:
            pages = pages[:50]

        full_text = "\n".join(page.page_content for page in pages)
        doc = Document(page_content=full_text)

        # 使用文本分割器切分文本
        text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=chunk_size, chunk_overlap=chunk_overlap, length_function=len
        )
        splits = text_splitter.split_documents([doc])

        # 将分割后的文本转换为可序列化的格式
        splits_data = [
            {"content": split.page_content, "metadata": split.metadata}
            for split in splits
        ]
        print(f"sucess parse pdf, Total pages: {len(pages)}")
        return {
            "splits": splits_data,
            "total_pages": len(pages),
            "total_chars": len(full_text),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    


def post_process_summary(summary: str) -> str:
    """Post-process the summary"""
    lines = summary.strip().splitlines()
    if lines[0].startswith("```"):
        lines = lines[1:]
        while lines[0] == "":
            lines = lines[1:]
        while not lines[-1].startswith("```"):
            lines = lines[:-1]
        lines = lines[:-1]
    if "summary" in lines[0].lower() or "overview" in lines[0].lower():
        lines = lines[1:]
        while lines[0] == "":
            lines = lines[1:]
    summary = "\n".join(lines[:-1]).strip()
    return summary


@app.post("/md_to_html")
@limiter.limit("1000/minute")  # 限制每个IP每分钟最多10次请求
async def convert_md_to_html(
    request: Request,
    markdown: str = Form(...),
    model_name: str = Form(...),
):
    print(f'------------- /md_to_html ({datetime.now().strftime("%Y-%m-%d %H:%M:%S")}) -------------')
    """将 Markdown 转换为 HTML"""
    try:
        summary = post_process_summary(markdown)
        md = MarkdownIt()
        html = md.render(summary)
        html = html
        return {"html": html}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/test_ip")
@limiter.limit("3/minute")
async def test_ip(request: Request):
    """测试客户端 IP 地址和限流"""
    print(f'------------- /test_ip ({datetime.now().strftime("%Y-%m-%d %H:%M:%S")}) -------------')
    client_ip = get_remote_address(request)
    forwarded_for = request.headers.get("X-Forwarded-For")
    real_ip = request.headers.get("X-Real-IP")

    return {
        "client_ip": client_ip,
        "x_forwarded_for": forwarded_for,
        "x_real_ip": real_ip,
    }


@app.post("/question_answer")
@limiter.limit("1000/minute")  # 限制每个IP每分钟最多10次请求
async def question_answer(
    request: Request,
    query: str = Form(...),
    context: str = Form(None),
):
    """处理问答请求"""
    print(f'------------- /question_answer ({datetime.now().strftime("%Y-%m-%d %H:%M:%S")}) -------------')
    try:
        # 确保QA系统已初始化
        if qa_system is None:
            init_services()
            if qa_system is None:
                raise HTTPException(status_code=500, detail="QA系统初始化失败")

        # 调用QA系统获取回答
        answer = await qa_system.get_answer(message=query, context=context)

        return {"status": "success", "answer": answer}
    except Exception as e:
        print(f"处理问答请求时出错: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/add_index")
@limiter.limit("1000/minute")  # 限制每个IP每分钟最多10次请求
async def add_index(
    request: Request,
    item: str = Form(...),
    config_path: str = Form("config.json"),
):
    """添加Zotero条目到Elasticsearch索引"""
    print(f'------------- /add_index ({datetime.now().strftime("%Y-%m-%d %H:%M:%S")}) -------------')
    try:
        # 确保服务已初始化
        if es_client is None or document_splitter is None or zot is None:
            init_services()
            if es_client is None or document_splitter is None or zot is None:
                raise HTTPException(status_code=500, detail="服务初始化失败，无法添加索引")


        global config
        config = load_config(config_path)

        # 获取切片配置
        indexing_config = config.get("zotero_indexing", {})
        split_config = indexing_config.get("document_splitting", {})
        split_enabled = split_config.get("enabled", False)
        split_method = split_config.get("method", "chunk")

        # 获取切片参数
        split_params = {
            "chunk_size": split_config.get("chunk_size", 1000),
            "overlap": split_config.get("chunk_overlap", 100),
            "min_paragraph_length": split_config.get("min_paragraph_length", 200),
            "section_patterns": split_config.get("section_patterns", None)
        }

        # 获取向量维度
        es_config = config.get("elasticsearch", {})
        vector_dim = indexing_config.get("vector_dim", es_config.get("vector_dim", 1024))

        # 调用insert_zotero_item函数
        success = insert_zotero_item(
            item=item,
            zot=zot,
            es_client=es_client,
            document_splitter=document_splitter,
            config=config,
            vector_dim=vector_dim,
            split_enabled=split_enabled,
            split_method=split_method,
            split_params=split_params
        )

        if success:
            return {"status": "success", "message": f"已成功将条目 '{item.get('data', {}).get('title', 'Unknown')}' 添加到索引"}
        else:
            raise HTTPException(status_code=500, detail="添加索引失败，详情请查看服务器日志")
    except Exception as e:
        print(f"添加索引时出错: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    print(f"============================== {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} ==============================")

    # 设置日志配置
    logging.basicConfig(
        level=logging.INFO,
        handlers=[
            logging.StreamHandler(sys.stdout)  # 将日志输出到 stdout
        ],
    )

    parser = argparse.ArgumentParser()
    parser.add_argument("--unix-socket", help="Unix socket path")
    parser.add_argument("--host", default="127.0.0.1", help="Bind host")
    parser.add_argument("--port", type=int, default=13210, help="Bind port")
    args = parser.parse_args()

    if args.unix_socket:
        # Unix socket模式
        uvicorn.run(app, uds=args.unix_socket, log_config=None)
    else:
        # TCP模式
        uvicorn.run(app, host=args.host, port=args.port, log_config=None)
