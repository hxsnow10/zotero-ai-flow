#!/bin/bash
# ============================================================
# Zotero AI Flow - XPI 打包脚本
# 将 zotero_plugin/ 目录打包为 .xpi 文件（即 .zip）
#
# 用法:
#   bash scripts/build_xpi.sh                    # 默认输出到当前目录
#   bash scripts/build_xpi.sh /path/to/output    # 指定输出目录
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PLUGIN_DIR="$PROJECT_DIR/zotero_plugin"
OUTPUT_DIR="${1:-$PROJECT_DIR}"
OUTPUT_FILE="$OUTPUT_DIR/zotero-ai-flow.xpi"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  Zotero AI Flow - XPI Builder${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""

# 检查必要文件
REQUIRED_FILES=("install.rdf" "bootstrap.js")
for f in "${REQUIRED_FILES[@]}"; do
  if [ ! -f "$PLUGIN_DIR/$f" ]; then
    echo -e "${RED}[ERROR] 缺少文件: $PLUGIN_DIR/$f${NC}"
    exit 1
  fi
done
echo -e "  ${GREEN}✓${NC} 必需文件检查通过"

# 检查 install.rdf 中的版本号
VERSION=$(grep -oP '<em:version>\K[^<]+' "$PLUGIN_DIR/install.rdf" 2>/dev/null || echo "unknown")
echo -e "  ${YELLOW}→${NC} 插件版本: ${VERSION}"

# 删除旧的 xpi
if [ -f "$OUTPUT_FILE" ]; then
  echo -e "  ${YELLOW}→${NC} 删除旧文件: $OUTPUT_FILE"
  rm -f "$OUTPUT_FILE"
fi

# 打包
echo -e "  ${YELLOW}→${NC} 打包中..."
cd "$PLUGIN_DIR"
zip -r "$OUTPUT_FILE" . -x "*.swp" "*.swo" "*~" ".DS_Store" "*.xpi"
cd "$PROJECT_DIR"

echo ""
echo -e "============================================"
echo -e "  ${GREEN}打包完成!${NC}"
echo -e "============================================"
echo -e "  输出: ${YELLOW}${OUTPUT_FILE}${NC}"
echo -e "  大小: $(du -h "$OUTPUT_FILE" | cut -f1)"
echo ""
echo -e "  安装方法:"
echo -e "    1. 打开 Zotero"
echo -e "    2. 工具 → 插件 → 齿轮图标 → Install Add-on From File"
echo -e "    3. 选择 ${YELLOW}$OUTPUT_FILE${NC}"
echo -e "    4. 重启 Zotero"
echo ""
echo -e "  验证安装:"
echo -e "    工具 → 插件 → 查看 Zotero AI Flow 是否已启用"
echo -e "    Zotero 启动后在工具 → 开发者 → Error Console 中查看日志"
echo ""
