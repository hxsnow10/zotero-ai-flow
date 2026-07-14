#!/usr/bin/env python3
"""
将独立的 .mmd 文件渲染为 SVG/PNG 静态图片。

用法:
    # 默认：渲染 docs/event-routing.mmd → docs/event-routing.svg
    python scripts/generate_mermaid_svg.py

    # 指定输入输出
    python scripts/generate_mermaid_svg.py -f docs/my-diagram.mmd -o docs/my-diagram.svg

    # 生成 PNG
    python scripts/generate_mermaid_svg.py --png

原理:
    通过 mermaid.ink 在线 API 将 mermaid 代码渲染为图片。
    也支持本地 mmdc 渲染（需安装 @mermaid-js/mermaid-cli）。
"""

import argparse, sys, os, base64, json, zlib, urllib.request

# ---------- 默认值 ----------
DEFAULT_MMD_FILE = "docs/event-routing.mmd"
DEFAULT_OUTPUT_FILE = "docs/event-routing.svg"
# ----------------------------


def read_mmd_file(filepath: str) -> str:
    """读取 .mmd 文件内容"""
    if not os.path.exists(filepath):
        print(f"[ERROR] 文件不存在: {filepath}")
        sys.exit(1)
    with open(filepath, "r", encoding="utf-8") as f:
        code = f.read().strip()
    if not code:
        print(f"[ERROR] 文件为空: {filepath}")
        sys.exit(1)
    print(f"[INFO] 读取 {filepath} ({len(code)} 字符)")
    return code


def mermaid_to_url(code: str) -> tuple[str, str]:
    """将 mermaid 代码编码为 mermaid.ink 的 SVG/PNG 下载 URL"""
    code_json = json.dumps({"code": code})
    deflated = zlib.compress(code_json.encode(), level=9)
    encoded = base64.urlsafe_b64encode(deflated).decode().rstrip("=")
    return (
        f"https://mermaid.ink/svg/pako:{encoded}",
        f"https://mermaid.ink/img/pako:{encoded}",
    )


def download_file(url: str, output_path: str) -> int:
    """下载文件，返回字节数"""
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = resp.read()
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    with open(output_path, "wb") as f:
        f.write(data)
    return len(data)


def render_with_mmdc(code: str, output_path: str) -> bool:
    """本地 mmdc 渲染，失败返回 False"""
    import subprocess, tempfile

    with tempfile.NamedTemporaryFile(mode="w", suffix=".mmd", delete=False) as f:
        f.write(code)
        mmd_path = f.name
    try:
        result = subprocess.run(
            ["mmdc", "-i", mmd_path, "-o", output_path, "-b", "transparent"],
            capture_output=True,
            text=True,
            timeout=30,
        )
        return result.returncode == 0
    except FileNotFoundError:
        return False
    finally:
        os.unlink(mmd_path)


def main():
    parser = argparse.ArgumentParser(
        description="将 .mmd 文件渲染为 SVG/PNG 静态图片",
        epilog=f"默认: python {sys.argv[0]}",
    )
    parser.add_argument(
        "-f",
        "--file",
        default=DEFAULT_MMD_FILE,
        help=f"输入的 .mmd 文件（默认: {DEFAULT_MMD_FILE}）",
    )
    parser.add_argument(
        "-o", "--output", default=None, help=f"输出路径（默认: {DEFAULT_OUTPUT_FILE}）"
    )
    parser.add_argument("--png", action="store_true", help="输出 PNG 格式（默认 SVG）")
    parser.add_argument("--local", action="store_true", help="优先使用本地 mmdc 渲染")
    args = parser.parse_args()

    # 读取 mermaid 代码
    code = read_mmd_file(args.file)

    # 确定输出路径
    output = args.output or DEFAULT_OUTPUT_FILE
    if args.png and not output.endswith(".png"):
        output = output.rsplit(".", 1)[0] + ".png"
    if not args.png and not output.endswith(".svg"):
        output += ".svg"

    # 渲染
    if args.local:
        print("[INFO] 尝试本地 mmdc 渲染...")
        if render_with_mmdc(code, output):
            print(f"[OK] 已保存: {output} ({os.path.getsize(output):,} bytes)")
            return
        print("[INFO] mmdc 不可用，回退到 mermaid.ink API...")

    svg_url, png_url = mermaid_to_url(code)
    url = png_url if args.png else svg_url
    fmt = "PNG" if args.png else "SVG"
    print(f"[INFO] 通过 mermaid.ink 生成 {fmt}...")
    size = download_file(url, output)
    print(f"[OK] 已保存: {output} ({size:,} bytes)")


if __name__ == "__main__":
    main()
