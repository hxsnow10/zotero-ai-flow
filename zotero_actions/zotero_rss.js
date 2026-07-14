/**
 * @class       : zotero_rss
 * @author      : xiahong (xiahahaha01@gmail.com)
 * @created     : Sunday Jul 12, 2026 08:55:41 CST
 * @description : convert rss abstract to html attachment
 *
 * 功能：对于处于 RSS 订阅（Feeds）中的条目，如果还没有子文档，
 *       将 abstract 转化为 HTML 格式并存为当前条目的附件。
 *
 * 
 * /

/************* Configurations Start *************/

let console_test = false; // true: 用console调试运行 false: 后台运行
if (console_test) {
  item = Zotero.getMainWindow().ZoteroPane.getSelectedItems()[0];
}

let dirname = "/home/xiahong/code/zotero-ai-summary";

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

// 最多同时处理几篇文章，控制对图片 CDN 的并发请求量
const MAX_CONCURRENT_ITEMS = 3;

/************* Configurations End *************/
let console = null;
if (!console_test) {
  console = require("console");
}

/**
 * 从 abstract HTML 中提取「文章原文」链接
 * 匹配含 meta_primary 类或 href 为 mp.weixin.qq.com 的 <a> 标签
 */
function extractOriginalUrl(abstract) {
  if (!abstract) return null;

  // 匹配 <a class="meta_primary"...>文章原文</a> 或 mp.weixin.qq.com 链接
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

/**
 * 判断条目所属的 collection 层级中是否包含"新闻"
 * 从条目所在的 collection 出发向上追溯所有父级
 */
function inNewsCollection(item) {
  const itemCollections = item.getCollections();
  if (!itemCollections || itemCollections.length === 0) {
    return false;
  }

  for (let colID of itemCollections) {
    let col = Zotero.Collections.get(colID);
    while (col) {
      let colName = col.getName ? col.getName() : col.name || "";
      if (colName && colName.includes("新闻")) {
        return true;
      }
      // 向上追溯父 collection
      col = col.parentID ? Zotero.Collections.get(col.parentID) : null;
    }
  }
  return false;
}

/**
 * 检测 abstract 是否已经是 HTML 格式
 */
function isAlreadyHtml(content) {
  // 含常见 HTML 标签视为已格式化，而非纯文本
  return /<\s*(div|p|section|span|img|table|ul|ol|li|h[1-6]|br)\b/i.test(
    content,
  );
}

/**
 * 下载单张图片并转为 base64 data URI
 * 失败时回退为 https 协议的原始 URL
 */
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

/**
 * 将 HTML 中所有 img src 替换为 base64 data URI（异步下载每张图片）
 * 已含有 data: 协议的图片保持不变
 */
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

/**
 * 将 abstract 转为格式化的 HTML 文档（兼容纯文本与已含 HTML 两种情况）
 */
function abstractToHtml(abstract, title, sourceUrl) {
  let safeTitle = title
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  let bodyContent;

  if (isAlreadyHtml(abstract)) {
    // abstract 已经是 HTML → 直接作为 body 内容嵌入
    // 去除可能存在的外层 xmlns 包裹，避免嵌套 <html>
    bodyContent = abstract
      .replace(/<div\s+xmlns\s*=\s*["'][^"']*["'][^>]*>/i, "<div>")
      .replace(/<\/div>\s*<\/div>\s*$/g, "</div>")
      // 尝试去掉图片代理，提取真实 URL（jintiankansha.me/get?src=REAL_URL）
      .replace(
        /http:\/\/img2\.jintiankansha\.me\/get\?src=([^&"]+)(&[^"\s]*)?/gi,
        "$1",
      )
      // 去掉 abstract 原有的「文章原文」链接（我们会用更美观的按钮替代）
      .replace(
        /<br\s*\/?>\s*<a[^>]*class\s*=\s*["'][^"']*meta_primary[^"']*["'][^>]*>[^<]*文章原文[^<]*<\/a>\s*<br\s*\/?>/gi,
        "",
      )
      // 去掉追踪像素
      .replace(/<img[^>]*jintiankansha\.me\/rss_static[^>]*>/gi, "");
  } else {
    // 纯文本 → 转义 + 分段包裹 <p>
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

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="referrer" content="no-referrer">
<title>${safeTitle}</title>
<style>
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  line-height: 1.8;
  max-width: 800px;
  margin: 30px auto;
  padding: 0 24px;
  color: #333;
  background: #fafafa;
}
.container {
  background: #fff;
  border-radius: 8px;
  padding: 28px 32px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
}
h1 {
  font-size: 1.4em;
  color: #1a1a1a;
  border-bottom: 2px solid #e0e0e0;
  padding-bottom: 10px;
  margin-top: 0;
  margin-bottom: 20px;
}
p {
  margin: 0.9em 0;
  text-align: justify;
}
/* 对已含 HTML 的内容：保留原有样式同时确保宽度不溢出 */
.rich-content img {
  max-width: 100%;
  height: auto;
}
.rich-content img[src*="jintiankansha.me/get?src="] {
  /* 备用：尝试代理直链替换，部分图片服务器检查 referrer */
}
.rich-content section {
  max-width: 100%;
  overflow: hidden;
}
.rich-content * {
  max-width: 100%;
  box-sizing: border-box;
}
.source-link {
  margin-top: 24px;
  text-align: center;
}
.source-link a {
  display: inline-block;
  padding: 8px 24px;
  background: #07c160;
  color: #fff;
  text-decoration: none;
  border-radius: 6px;
  font-size: 0.95em;
  transition: background 0.2s;
}
.source-link a:hover {
  background: #06ad56;
}
.meta {
  font-size: 0.85em;
  color: #888;
  margin-top: 20px;
  border-top: 1px solid #eee;
  padding-top: 12px;
}
</style>
</head>
<body>
<div class="container">
<h1>📄 Abstract</h1>
<div class="rich-content">${bodyContent}</div>
${sourceUrl ? `<div class="source-link"><a href="${sourceUrl}" target="_blank" rel="noopener">📎 阅读原文</a></div>` : ""}
<div class="meta">Generated by zotero_rss action &middot; ${new Date().toISOString().slice(0, 10)}</div>
</div>
</body>
</html>`;
}

/**
 * 检查该条目是否已经有 abstract 附件（避免重复生成）
 */
function hasAbstractAttachment(item) {
  const attachmentIDs = item.getAttachments();
  if (!attachmentIDs) return false;

  let itemTitle = item.getField("title") || "Untitled";
  let expectedName = "[RSS-ABSTRACT]" + itemTitle + ".html";

  for (let id of attachmentIDs) {
    let att = Zotero.Items.get(id);
    if (!att) continue;
    let attTitle = att.getField("title") || "";
    // 用附件标题是否等于预期的 HTML 文件名来判断
    if (attTitle === expectedName) {
      return true;
    }
  }
  return false;
}

/**
 * 处理单个 RSS 条目：将 abstract 转为 HTML 附件
 */
async function processRssItem(item) {
  let progressWindow = undefined;
  let itemProgress = undefined;

  progressWindow = new Zotero.ProgressWindow({
    closeOnClick: false,
  });
  progressWindow.addDescription(item.getField("title"));
  itemProgress = new progressWindow.ItemProgress();
  itemProgress.setItemTypeAndIcon("snapshot");

  try {
    // 仅处理顶层条目
    if (!item.isRegularItem() || !item.isTopLevelItem()) {
      progressWindow.startCloseTimer();
      return;
    }

    // 检查是否属于 RSS 订阅
    if (!inNewsCollection(item)) {
      progressWindow.addDescription("Not in 新闻 collection, skipping...");
      progressWindow.startCloseTimer(3000);
      return;
    }

    // 检查是否已有 abstract 附件
    if (hasAbstractAttachment(item)) {
      progressWindow.addDescription(
        "Abstract attachment already exists, skipping...",
      );
      progressWindow.startCloseTimer(3000);
      return;
    }

    // 获取 abstract
    let abstract = item.getField("abstractNote");
    if (!abstract || !abstract.trim()) {
      progressWindow.addDescription("No abstract content found, skipping...");
      progressWindow.startCloseTimer(3000);
      return;
    }

    // 质量检查：仅当 abstract 含图片 + 含 HTML 要素 + 文本长度 >= 200 时才生成附件
    let hasImg = /<img\b/i.test(abstract);
    let hasHtml = isAlreadyHtml(abstract);
    let textLen = abstract.replace(/<[^>]+>/g, "").replace(/\s+/g, "").length;
    if (!hasImg || !hasHtml || textLen < 200) {
      let reasons = [];
      if (!hasImg) reasons.push("no images");
      if (!hasHtml) reasons.push("not HTML");
      if (textLen < 200) reasons.push(`text too short (${textLen} chars)`);
      progressWindow.addDescription(
        "Quality check failed (" + reasons.join(", ") + "), skipping...",
      );
      progressWindow.startCloseTimer(3000);
      return;
    }

    let title = item.getField("title") || "Untitled";

    itemProgress.setText("Converting abstract to HTML...");
    progressWindow.show();

    // 从 abstract 中提取原文链接
    let originalUrl = extractOriginalUrl(abstract);

    // 生成 HTML 内容
    let htmlContent = abstractToHtml(abstract, title, originalUrl || "");

    // 将远程图片转为 base64 内嵌（解决微信 CDN 图片无法加载的问题）
    itemProgress.setText("Downloading and embedding images...");
    progressWindow.show();
    htmlContent = await embedImagesAsBase64(htmlContent);

    itemProgress.setProgress(50);
    itemProgress.setText("Saving HTML attachment...");

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

    // 导入为 imported_file，再改为 imported_url 以支持远程图片渲染
    let att = await Zotero.Attachments.importFromFile({
      file: tmpPath,
      parentItemID: item.id,
    });
    if (att) {
      att.setField("title", "[RSS-ABSTRACT]" + title + ".html");
      // imported_url 模式允许 Zotero 以网页方式渲染，加载远程图片
      att.attachmentLinkMode = Zotero.Attachments.LINK_MODE_IMPORTED_URL;
      // 设置原始 URL，使 Zotero 以网页上下文打开（否则本地文件会阻止远程图片）
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

    itemProgress.setProgress(100);
    itemProgress.setText("Abstract HTML attachment created!");
    progressWindow.startCloseTimer(3000);
    return true;
  } catch (error) {
    if (itemProgress) {
      itemProgress.setError();
      itemProgress.setText(`Error: ${error.message}`);
    }
    if (progressWindow) {
      progressWindow.addDescription("");
      progressWindow.startCloseTimer(5000);
    }
    console &&
      console.error(
        `Error processing RSS item "${item.getField("title")}":`,
        error,
      );
    return error.message;
  }
}

/**
 * 并发处理多个选中的条目
 */
async function processSelectedItems(items) {
  if (!items || items.length === 0) {
    return "No items selected.";
  }

  let successCount = 0;
  let skipCount = 0;
  let errorInfo = "";

  // 分批并发处理，每批最多 MAX_CONCURRENT_ITEMS 篇
  for (let i = 0; i < items.length; i += MAX_CONCURRENT_ITEMS) {
    const batch = items.slice(i, i + MAX_CONCURRENT_ITEMS);
    await Promise.all(
      batch.map(async (singleItem) => {
        try {
          let result = await processRssItem(singleItem);
          if (result === true) {
            successCount++;
          } else if (result) {
            errorInfo += result + "\n";
          }
        } catch (error) {
          console &&
            console.error(
              `Error processing "${singleItem.getField("title")}":`,
              error,
            );
          errorInfo += error.message + "\n";
        }
      }),
    );
  }

  return (
    `Finished: ${successCount} success / ${items.length} total.\n` +
    (errorInfo ? `\nErrors:\n${errorInfo}` : "")
  );
}

// 获取选中条目并执行处理
let nitems = Zotero.getMainWindow().ZoteroPane.getSelectedItems();

if (item) {
  // 单个 item 触发时避免重复操作
  if (nitems.length == 1) {
    return await processSelectedItems(nitems);
  }
} else {
  return await processSelectedItems(nitems);
}
