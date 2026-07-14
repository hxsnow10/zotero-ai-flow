#!/bin/bash
# ============================================================
# Zotero AI Flow - XPI 打包脚本
# 不修改现有目录结构，打包时用临时 _build/ 目录组装。
# ============================================================
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$PROJECT_DIR/_build"
PLUGIN_DIR="$PROJECT_DIR/zotero_plugin"
ACTIONS_DIR="$PROJECT_DIR/zotero_actions"
OUTPUT_DIR="${1:-$PROJECT_DIR}"
OUTPUT_FILE="$OUTPUT_DIR/zotero-ai-flow.xpi"
RED='[0;31m'; GREEN='[0;32m'; YELLOW='[1;33m'; NC='[0m'

echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  Zotero AI Flow - XPI Builder${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""

[ -d "$BUILD_DIR" ] && rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/scripts" "$BUILD_DIR/defaults/preferences"

echo -e "  ${YELLOW}->${NC} 复制插件元数据..."
cp "$PLUGIN_DIR/install.rdf"       "$BUILD_DIR/"
cp "$PLUGIN_DIR/bootstrap.js"      "$BUILD_DIR/"
cp "$PLUGIN_DIR/defaults/preferences/zotero-ai-flow.js" "$BUILD_DIR/defaults/preferences/"

echo -e "  ${YELLOW}->${NC} 复制行为脚本..."
copied=0
for f in "$ACTIONS_DIR"/*.js; do
  [ -f "$f" ] || continue
  bn=$(basename "$f")
  cp "$f" "$BUILD_DIR/scripts/$bn"
  echo "          scripts/$bn"
  copied=$((copied + 1))
done
echo -e "  ${GREEN}OK${NC} 已复制 ${copied} 个脚本"

echo -e "  ${YELLOW}->${NC} 复制配置文件 (config_example.json -> config.json)..."
cp "$PROJECT_DIR/config_example.json" "$BUILD_DIR/config.json"

VERSION=$(grep -oP '<em:version>\K[^<]+' "$BUILD_DIR/install.rdf" 2>/dev/null || echo unknown)
echo -e "  ${YELLOW}->${NC} 插件版本: ${VERSION}"

[ -f "$OUTPUT_FILE" ] && rm -f "$OUTPUT_FILE"

echo -e "  ${YELLOW}->${NC} 打包中..."
cd "$BUILD_DIR"
zip -r "$OUTPUT_FILE" . -x "*.swp" "*.swo" "*~" ".DS_Store" > /dev/null
cd "$PROJECT_DIR"

rm -rf "$BUILD_DIR"

echo ""
echo -e "============================================"
echo -e "============================================"
echo -e "  输出: ${YELLOW}${OUTPUT_FILE}${NC}"
echo -e "  大小: $(du -h "$OUTPUT_FILE" | cut -f1)"
echo ""
echo -e "  安装后插件自动将脚本/config解压到 Zotero 配置目录"
echo ""
