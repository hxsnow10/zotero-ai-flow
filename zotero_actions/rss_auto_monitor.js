/**
 * @class       : rss_auto_monitor
 * @author      : xiahong
 * @created     : Monday Jul 14, 2026
 * @description : 监听 Feeds（RSS 订阅）条目入库，自动触发 abstract → HTML 附件生成
 *
 * 安装方式（三选一）：
 *   1. zotero-startup-monkeypatch 插件：在插件设置中指定本文件路径
 *   2. 放到 Zotero 数据目录的 scripts/ 下，每次启动通过 startup 插件 require
 *   3. 测试：Zotero → 工具 → Developer → Run JavaScript，粘贴本文件内容执行
 *
 * 原理：Feeds 入库时 skipNotifier=true 跳过了 item add 事件，
 *       但条目加入 feed collection 时会触发 collection-item add 事件，
 *       本脚本通过监听该事件实现自动处理。
 */

// ==================== 配置 ====================

let dirname = "/home/xiahong/code/zotero-ai-summary";

// RSS feed 所在的 collection 名称关键词
const RSS_COLLECTION_KEYWORDS = ["新闻"];

// 条目入库后等待多久再处理（毫秒），给 Zotero 时间完成数据库写入
const PROCESS_DELAY_MS = 5000;

// 防抖：同一 item 在 X 毫秒内不会重复处理
const DEBOUNCE_MS = 120000;

// 最多同时处理几篇（控制图片 CDN 并发）
const MAX_CONCURRENT_ITEMS = 3;

// ==================== 初始化 ====================

const Zotero = require("Zotero");
const console = require("console");

async function load_file(pname) {
  try {
    let path = dirname + "/" + pname;
    let content = await IOUtils.read(path);
    const decoder = new TextDecoder("utf-8");
    return decoder.decode(content);
  } catch (error) {
    throw new Error(`读取文件失败 ${pname}: ${error.message}`);
  }
}

let fileContent = await load_file("config.json");
const config = JSON.parse(fileContent);

// ==================== 核心函数（取自 zotero_rss.js） ====================

function extractOriginalUrl(abstract) {
  if (!abstract) return null;

  const patterns = [
    /<a\s+[^>]*class\s*=\s*["'][^"']*meta_primary[^"']*["'][^>]*href\s*=\s*["']([^"']+)["'][^>]*>/i,
    /<a\s+[^>]*href\s*=\s*["'](https?:\/\/mp\.weixin\.qq\.com\/[^"']+)["'][^>]*>/i,
    /href\s*=\s*["'](https?:\/\/mp\.weixin\.qq\.com\/[^"']+)["']/i,
  ];

  for (const re of patterns) {
    const m = abstract.match(re);
    if (m && m[1]) return m[1];
  }
  return null;
}

function isAlreadyHtml(content) {
  return /<\s*(div|p|section|span|img|table|ul|ol|li|h[1-6]|br)\b/i.test(
    content,
  );
}

async function imageToBase64(url) {
  try {
    let httpsUrl = url.replace(/^http:\/\//i, "https://");
    const response = await fetch(httpsUrl, {
      headers: { Referer: "https://mp.weixin.qq.com/" },
    });
    if (!response.ok) return httpsUrl;

    const arrayBuffer = await response.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const chunkSize = 8192;
    let binary = "";
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.slice(i, i + chunkSize));
    }
    const base64 = btoa(binary);
    const contentType = response.headers.get("content-type") || "image/png";
    return `data:${contentType};base64,${base64}`;
  } catch (e) {
    return url.replace(/^http:\/\//i, "https://");
  }
}

async function embedImagesAsBase64(html) {
  const imgRegex = /<img\s+[^>]*src\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let result = html;
  const replacements = [];

  for (const m of html.matchAll(imgRegex)) {
    const fullTag = m[0];
    const srcUrl = m[1];
    if (srcUrl.startsWith("data:")) continue;
    replacements.push({ fullTag, srcUrl });
  }

  for (const { fullTag, srcUrl } of replacements) {
    const newSrc = await imageToBase64(srcUrl);
    const newTag = fullTag.replace(srcUrl, newSrc);
    result = result.replace(fullTag, newTag);
  }

  return result;
}

function abstractToHtml(abstract, title, sourceUrl) {
  let safeTitle = title
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  let bodyContent;

  if (isAlreadyHtml(abstract)) {
    bodyContent = abstract
      .replace(/<div\s+xmlns\s*=\s*["'][^"']*["'][^>]*>/i, "<div>")
      .replace(/<\/div>\s*<\/div>\s*$/g, "</div>")
      .replace(
        /http:\/\/img2\.jintiankansha\.me\/get\?src=([^&"]+)(&[^"\s]*)?/gi,
        "$1",
      )
      .replace(
        /<br\s*\/?>\s*<a[^>]*class\s*=\s*["'][^"']*meta_primary[^"']*["'][^>]*>[^<]*文章原文[^<]*<\/a>\s*<br\s*\/?>/gi,
        "",
      )
      .replace(/<img[^>]*jintiankansha\.me\/rss_static[^>]*>/gi, "");
  } else {
    let escaped = abstract
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    bodyContent = escaped
      .split("\n\n")
      .filter((p) => p.trim())
      .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
      .join("\n");
  }

  return (
    '<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n<meta name="referrer" content="no-referrer">\n<title>' +
    safeTitle +
    '</title>\n<style>\nbody {\n  font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif;\n  line-height: 1.8;\n  max-width: 800px;\n  margin: 30px auto;\n  padding: 0 24px;\n  color: #333;\n  background: #fafafa;\n}\n.container {\n  background: #fff;\n  border-radius: 8px;\n  padding: 28px 32px;\n  box-shadow: 0 1px 3px rgba(0,0,0,0.08);\n}\nh1 {\n  font-size: 1.4em;\n  color: #1a1a1a;\n  border-bottom: 2px solid #e0e0e0;\n  padding-bottom: 10px;\n  margin-top: 0;\n  margin-bottom: 20px;\n}\np {\n  margin: 0.9em 0;\n  text-align: justify;\n}\n.rich-content img {\n  max-width: 100%;\n  height: auto;\n}\n.rich-content * {\n  max-width: 100%;\n  box-sizing: border-box;\n}\n.source-link {\n  margin-top: 24px;\n  text-align: center;\n}\n.source-link a {\n  display: inline-block;\n  padding: 8px 24px;\n  background: #07c160;\n  color: #fff;\n  text-decoration: none;\n  border-radius: 6px;\n  font-size: 0.95em;\n  transition: background 0.2s;\n}\n.source-link a:hover {\n  background: #06ad56;\n}\n.meta {\n  font-size: 0.85em;\n  color: #888;\n  margin-top: 20px;\n  border-top: 1px solid #eee;\n  padding-top: 12px;\n}\n</style>\n</head>\n<body>\n<div class="container">\n<h1>📄 Abstract</h1>\n<div class="rich-content">' +
    bodyContent +
    "</div>\n" +
    (sourceUrl
      ? '<div class="source-link"><a href="' +
        sourceUrl +
        '" target="_blank" rel="noopener">📎 阅读原文</a></div>\n'
      : "") +
    '<div class="meta">Generated by rss_auto_monitor &middot; ' +
    new Date().toISOString().slice(0, 10) +
    "</div>\n</div>\n</body>\n</html>"
  );
}

function inRssCollection(item) {
  const itemCollections = item.getCollections();
  if (!itemCollections || itemCollections.length === 0) {
    return false;
  }

  for (let colID of itemCollections) {
    let col = Zotero.Collections.get(colID);
    while (col) {
      let colName = col.getName ? col.getName() : col.name || "";
      for (let kw of RSS_COLLECTION_KEYWORDS) {
        if (colName.includes(kw)) return true;
      }
      col = col.parentID ? Zotero.Collections.get(col.parentID) : null;
    }
  }
  return false;
}

function hasAbstractAttachment(item) {
  const attachmentIDs = item.getAttachments();
  if (!attachmentIDs) return false;

  let itemTitle = item.getField("title") || "Untitled";
  let expectedName = "[RSS-ABSTRACT]" + itemTitle + ".html";

  for (let id of attachmentIDs) {
    let att = Zotero.Items.get(id);
    if (!att) continue;
    let attTitle = att.getField("title") || "";
    if (attTitle === expectedName) {
      return true;
    }
  }
  return false;
}

// ==================== 单条目处理（后台版，无 ProgressWindow） ====================

async function processRssItemBackground(item) {
  try {
    // 仅处理顶层条目
    if (!item.isRegularItem() || !item.isTopLevelItem()) {
      return "not top-level item";
    }

    // 检查是否已有 abstract 附件
    if (hasAbstractAttachment(item)) {
      console.log(
        '[RSS Monitor] 已有 HTML 附件，跳过: "' + item.getField("title") + '"',
      );
      return "already exists";
    }

    // 获取 abstract
    let abstract = item.getField("abstractNote");
    if (!abstract || !abstract.trim()) {
      return "no abstract";
    }

    // 质量检查
    let hasImg = /<img\b/i.test(abstract);
    let hasHtml = isAlreadyHtml(abstract);
    let textLen = abstract.replace(/<[^>]+>/g, "").replace(/\s+/g, "").length;
    if (!hasImg || !hasHtml || textLen < 200) {
      let reasons = [];
      if (!hasImg) reasons.push("no images");
      if (!hasHtml) reasons.push("not HTML");
      if (textLen < 200) reasons.push("text too short (" + textLen + " chars)");
      return "quality check failed: " + reasons.join(", ");
    }

    let title = item.getField("title") || "Untitled";
    console.log('[RSS Monitor] 开始处理: "' + title + '"');

    // 从 abstract 中提取原文链接
    let originalUrl = extractOriginalUrl(abstract);

    // 生成 HTML 内容
    let htmlContent = abstractToHtml(abstract, title, originalUrl || "");

    // 将远程图片转为 base64 内嵌
    htmlContent = await embedImagesAsBase64(htmlContent);

    // 写入临时文件
    let safeFileName = title.replace(/[\\/:*?"<>|]/g, "_");
    if (!safeFileName.toLowerCase().endsWith(".html")) {
      safeFileName += ".html";
    }

    let tmpDir = Zotero.getTempDirectory();
    tmpDir.append(safeFileName);
    let tmpPath = tmpDir.path;

    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(htmlContent);
      await IOUtils.write(tmpPath, data);
    } catch (writeError) {
      await Zotero.File.putContentsAsync(tmpPath, htmlContent);
    }

    // 导入为附件
    let att = await Zotero.Attachments.importFromFile({
      file: tmpPath,
      parentItemID: item.id,
    });
    if (att) {
      att.setField("title", "[RSS-ABSTRACT]" + title + ".html");
      att.attachmentLinkMode = Zotero.Attachments.LINK_MODE_IMPORTED_URL;
      let itemUrl = item.getField("url");
      if (itemUrl) {
        att.setField("url", itemUrl);
      }
      await att.saveTx();
    }

    // 清理临时文件
    try {
      await IOUtils.remove(tmpPath);
    } catch (e) {
      /* ignore cleanup errors */
    }

    console.log('[RSS Monitor] ✅ 处理完成: "' + title + '"');
    return true;
  } catch (error) {
    console.error(
      '[RSS Monitor] ❌ 处理失败 "' + item.getField("title") + '":',
      error,
    );
    return error.message;
  }
}

// ==================== Notifier 监控 ====================

const _processedItems = new Map(); // itemID → timestamp
const _pendingTimers = new Map(); // itemID → setTimeout ID

/**
 * 延迟调度 RSS 处理（防抖 + 等待条目就绪）
 */
function scheduleRssProcessing(itemID) {
  // 防抖检查
  const lastProcessed = _processedItems.get(itemID);
  if (lastProcessed && Date.now() - lastProcessed < DEBOUNCE_MS) {
    return;
  }

  // 取消已有的 pending timer
  const existingTimer = _pendingTimers.get(itemID);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  // 延迟处理
  const timer = setTimeout(async () => {
    _pendingTimers.delete(itemID);
    _processedItems.set(itemID, Date.now());

    try {
      const item = await Zotero.Items.getAsync(itemID);
      if (!item || !item.isRegularItem()) return;

      // 延迟后二次确认 collection 归属
      if (!inRssCollection(item)) {
        return;
      }

      await processRssItemBackground(item);
    } catch (error) {
      console.error(
        "[RSS Monitor] 调度处理 item " + itemID + " 时出错:",
        error,
      );
    }
  }, PROCESS_DELAY_MS);

  _pendingTimers.set(itemID, timer);
}

// ==================== 注册 Notifier Observer ====================

const observerID = Zotero.Notifier.registerObserver(
  {
    notify: async function (event, type, ids, extraData) {
      // 策略 A：监听 collection-item add（Feeds 入库时条目加入 collection）
      if (event === "add" && type === "collection-item") {
        for (let id of ids) {
          if (typeof id !== "string") continue;
          const parts = id.split("-");
          if (parts.length < 2) continue;
          const itemID = parseInt(parts[parts.length - 1]);
          if (isNaN(itemID)) continue;
          scheduleRssProcessing(itemID);
        }
      }

      // 策略 B（备用）：如果某些版本仍触发 item add 事件
      if (event === "add" && type === "item") {
        for (let id of ids) {
          scheduleRssProcessing(id);
        }
      }
    },
  },
  ["collection-item", "item"],
);

// ==================== 启动日志 ====================

console.log("=".repeat(50));
console.log("[RSS Monitor] 🚀 已启动 Feeds 入库监控");
console.log(
  "[RSS Monitor]    监听 collection 关键词: " +
    RSS_COLLECTION_KEYWORDS.join(", "),
);
console.log(
  "[RSS Monitor]    延迟处理: " +
    PROCESS_DELAY_MS +
    "ms  防抖: " +
    DEBOUNCE_MS +
    "ms",
);
console.log("[RSS Monitor]    Observer ID: " + observerID);
console.log("=".repeat(50));
