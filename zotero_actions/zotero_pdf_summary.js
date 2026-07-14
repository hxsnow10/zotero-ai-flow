/**
 * Generate paper summary using LLM
 * @author Qiuyang Zhang  xiahong
 * @usage https://github.com/cs-qyzhang/zotero-ai-summary
 */

// ============================================================================
// 总体逻辑：
// 1. 读取配置 & 加载 LLM prompt 模板（stuff / map / reduce）
// 2. 获取选中条目 → 优先查找 PDF 附件，找不到则回退到 HTML 网页快照
// 3. 读取附件内容：
//    - PDF  → 调用服务端 /parse_pdf 解析为文本分块（splits）
//    - HTML → 本地提取纯文本，按 chunkSize/chunkOverlap 手动分块
// 4. LLM 摘要：单分块用 "stuff" 模式，多分块用 "map-reduce" 模式
// 5. 摘要 markdown → 服务端 /md_to_html 转 HTML → 写入 Zotero 笔记
// ============================================================================

// TODO：生成摘要的时候，最好还能保留这个对话环境，方便后续的交互问答  pdfask
// 每次打开文本都生成一次吗？ 这还是得手动触发吧。有需要问答的时候，触发一次上传，然后交互即可。
// 记录时间
// 记得提取source_code等关键字段
/************* Configurations Start *************/

let dirname = "/home/xiahong/code/zotero-ai-summary";

async function load_file(pname) {
  try {
    let path = dirname + "/" + pname;
    // 使用 IOUtils 读取文件内容
    let content = await IOUtils.read(path);

    // 使用 TextDecoder 处理 Unicode 字符
    const decoder = new TextDecoder("utf-8");
    return decoder.decode(content);
  } catch (error) {
    throw new Error(`读取文件失败 ${pname}: ${error.message}`);
  }
}

let fileContent = await load_file("config.json");

const config = JSON.parse(fileContent);

// load prompt
function load_prompt(pname) {
  pname = "prompt/" + pname + "_prompt.txt";
  return load_file(pname);
}

// Prompt for "stuff" method, which is used when there is only one split
let stuff_prompt = await load_prompt("stuff");

// Prompt for "map-reduce" method, which is used when there are multiple splits
let map_prompt = await load_prompt("map");

// Prompt for "reduce" in "map-reduce" method
let reduce_prompt = await load_prompt("reduce");

/************* Configurations End *************/

let console = require("console");

function formatString(str, params) {
  return str.replace(/{([^{}]*)}/g, (match, key) => {
    return params[key] || match;
  });
}

function check_attachment(attachment) {
  return (
    attachment &&
    (!config.summary.only_link_file ||
      attachment.attachmentLinkMode ===
        Zotero.Attachments.LINK_MODE_LINKED_FILE)
  );
}

/**
 * 从 item 的所有附件中查找 PDF 附件
 */
function findPdfAttachment(item) {
  const attachmentIDs = item.getAttachments();
  for (const id of attachmentIDs) {
    const attachment = Zotero.Items.get(id);
    if (attachment.attachmentContentType === "application/pdf") {
      return attachment;
    }
  }
  return null;
}

/**
 * 从 item 的所有附件中查找 HTML / 网页快照附件
 */
function findHtmlAttachment(item) {
  const attachmentIDs = item.getAttachments();
  for (const id of attachmentIDs) {
    const attachment = Zotero.Items.get(id);
    const ct = attachment.attachmentContentType || "";
    if (ct.startsWith("text/html") || ct === "application/xhtml+xml") {
      return attachment;
    }
  }
  return null;
}

/**
 * 从 HTML 字符串中提取纯文本
 */
function extractTextFromHtml(html) {
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text;
}

if (!item) return;

async function generateSummary(item) {
  let progressWindow = undefined;
  let itemProgress = undefined;
  const window = require("window");
  // 记录开始时间
  const startTime = new Date();

  if (config.llm.openaiBaseUrl.endsWith("/")) {
    config.llm.openaiBaseUrl = config.llm.openaiBaseUrl.slice(0, -1);
  }
  progressWindow = new Zotero.ProgressWindow({
    closeOnClick: false,
  });
  progressWindow.addDescription(item.getField("title"));
  itemProgress = new progressWindow.ItemProgress();
  itemProgress.setItemTypeAndIcon("note");
  try {
    if (!item.isRegularItem() || !item.isTopLevelItem()) {
      progressWindow.startCloseTimer();
      return;
    }

    let title = item.getField("title");
    let link = item.getField("url") || "";

    // 提取条目元信息（摘要、作者、期刊、日期等），构建 XML 标签块
    let abstractNote = item.getField("abstractNote") || "";
    let publicationTitle = item.getField("publicationTitle") || "";
    let date = item.getField("date") || "";
    let creators = item.getCreators ? item.getCreators() : null;
    let authorsStr = "";
    if (creators && creators.length > 0) {
      authorsStr = creators
        .map((c) => (c.firstName || "") + " " + (c.lastName || ""))
        .join(", ")
        .trim();
    }

    let metaBlock = "";
    if (abstractNote) {
      // 清理 HTML 标签和实体得到纯文本摘要
      let cleanAbstract = abstractNote
        .replace(/<[^>]+>/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&nbsp;/g, " ")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x2F;/g, "/")
        .replace(/&#\d+;/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      metaBlock += "<摘要>\n" + cleanAbstract + "\n</摘要>\n";
    }
    if (authorsStr) metaBlock += "<作者>" + authorsStr + "</作者>\n";
    if (publicationTitle)
      metaBlock += "<期刊>" + publicationTitle + "</期刊>\n";
    if (date) metaBlock += "<日期>" + date + "</日期>\n";

    const shortTitle =
      title.length > 50 ? title.substring(0, 50) + "..." : title;

    let itemType = item.itemType;
    if (!config.summary.support_item_types.includes(itemType)) {
      progressWindow.startCloseTimer();
      return `No support itemType=${itemType}.`;
    }

    // Check if the summary already exists
    let noteIds = item.getNotes();
    let summary_exist = false;
    for (const id of noteIds) {
      let note = Zotero.Items.get(id);
      let content = note.getNote();
      if (content.search("<h2>AI Generated Summary") >= 0) {
        summary_exist = true;
        break;
      }
    }
    if (summary_exist) {
      itemProgress.setProgress(100);
      itemProgress.setText("Summary already exists.");
      progressWindow.startCloseTimer(1000);
      return;
    }

    // ===== 获取附件：优先 PDF，其次 HTML =====
    let sourceType = "pdf";
    let attachment = null;

    // 第一步：尝试获取 PDF
    attachment = await item.getBestAttachment();
    if (
      !check_attachment(attachment) ||
      attachment.attachmentContentType !== "application/pdf"
    ) {
      attachment = findPdfAttachment(item);
    }

    if (!attachment || !check_attachment(attachment)) {
      // 第二步：回退到 HTML
      attachment = findHtmlAttachment(item);
      if (attachment && check_attachment(attachment)) {
        sourceType = "html";
      } else {
        progressWindow.startCloseTimer();
        return "No PDF or HTML attachment found for the selected item.";
      }
    }

    itemProgress.setText(
      sourceType === "pdf" ? "Retrieving PDF..." : "Retrieving HTML...",
    );
    progressWindow.show();

    let filePath = await attachment.getFilePath();
    const basePath = filePath.replace(/^.*[\\/]/, "");

    // 读取文件
    let fileData = await IOUtils.read(filePath);
    if (fileData instanceof ArrayBuffer) {
      fileData = new Uint8Array(fileData);
    }

    let splits;

    if (sourceType === "pdf") {
      // === PDF 路径：调用 /parse_pdf 解析 ===
      itemProgress.setProgress(20);
      itemProgress.setText("Parsing PDF...");

      const formData = new window.FormData();
      formData.append("title", title);
      formData.append("link", link);
      formData.append("chunk_size", config.summary.chunkSize);
      formData.append("chunk_overlap", config.summary.chunkOverlap);
      formData.append(
        "pdf",
        new Blob([fileData], { type: "application/pdf" }),
        basePath,
      );

      const parseResponse = await fetch(`${config.server.url}/parse_pdf`, {
        method: "POST",
        body: formData,
      });
      if (!parseResponse.ok) {
        let message = undefined;
        try {
          const data = await parseResponse.json();
          message = data.detail || data.error?.message;
        } catch (error) {}
        throw new Error(
          `${config.server.url} HTTP Error: ${parseResponse.status} ${parseResponse.statusText}${message ? ` - ${message}` : ""}`,
        );
      }
      let parseResult;
      try {
        parseResult = await parseResponse.json();
        splits = parseResult.splits;
      } catch (error) {
        throw new Error(
          `Error when parsing json of ${config.server.url}/parse_pdf: ${error.message}`,
        );
      }
    } else {
      // === HTML 路径：直接提取文本，手动分块 ===
      itemProgress.setProgress(20);
      itemProgress.setText("Extracting text from HTML...");

      const decoder = new TextDecoder("utf-8");
      const htmlString = decoder.decode(fileData);
      const plainText = extractTextFromHtml(htmlString);

      if (!plainText || plainText.length < 50) {
        throw new Error("HTML content is too short or empty after extraction.");
      }

      const chunkSize = config.summary.chunkSize || 4000;
      const chunkOverlap = config.summary.chunkOverlap || 200;
      splits = [];
      let start = 0;
      let chunkIndex = 0;
      while (start < plainText.length) {
        const end = Math.min(start + chunkSize, plainText.length);
        splits.push({
          content: plainText.slice(start, end),
          metadata: { chunk: chunkIndex, source_type: "html" },
        });
        if (end >= plainText.length) break;
        start = end - chunkOverlap;
        chunkIndex++;
      }
    }

    // Step 2: Generate summary
    itemProgress.setProgress(40);
    itemProgress.setText("Generating summary...");
    const markdownSummary = await summarizeText(title, splits, metaBlock);
    if (!markdownSummary) {
      itemProgress.setText(`summary error`);
      progressWindow.startCloseTimer(5000);
      return false;
    }

    // Step 3: Convert to HTML
    itemProgress.setProgress(80);
    itemProgress.setText("Formatting summary To html...");
    const htmlFormData = new window.FormData();
    htmlFormData.append("title", title);
    htmlFormData.append("markdown", markdownSummary);
    htmlFormData.append("model_name", config.llm.modelName);

    const htmlResponse = await fetch(`${config.server.url}/md_to_html`, {
      method: "POST",
      body: htmlFormData,
    });
    if (!htmlResponse.ok) {
      let message = undefined;
      try {
        const data = await htmlResponse.json();
        message = data.detail || data.error?.message;
      } catch (error) {}
      throw new Error(
        `${config.server.url} HTTP Error: ${htmlResponse.status} ${htmlResponse.statusText}${message ? ` - ${message}` : ""}`,
      );
    }
    let htmlResult;
    try {
      htmlResult = await htmlResponse.json();
    } catch (error) {
      throw new Error(
        `Error when parsing json of ${config.server.url}/md_to_html: ${error.message}`,
      );
    }
    // 计算总耗时
    const endTime = new Date();
    const totalTime = (endTime - startTime) / 1000; // 转换为秒

    // 格式化耗时
    const minutes = Math.floor(totalTime / 60);
    const seconds = Math.floor(totalTime % 60);
    const timeStr =
      minutes > 0 ? `耗时：${minutes}分${seconds}秒` : `${seconds}秒`;

    // Create note with HTML content
    let newNote = new Zotero.Item("note");
    let htmlContent =
      `<h2>AI Generated Summary (${config.llm.modelName})</h2>` +
      htmlResult.html +
      timeStr;
    newNote.setNote(htmlContent);
    newNote.parentID = item.id;
    await newNote.saveTx();

    itemProgress.setProgress(100);
    itemProgress.setText("Summary generated successfully!");
    progressWindow.startCloseTimer(5000);
    return true;
  } catch (error) {
    itemProgress.setError();
    itemProgress.setText(`Error processing item: ${error.message}`);
    progressWindow.addDescription("");
    progressWindow.startCloseTimer(5000);
    return error.message;
  }
}

async function openaiRequest(message) {
  const response = await fetch(`${config.llm.openaiBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.llm.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.llm.modelName,
      messages: [
        {
          role: "user",
          content: message,
        },
      ],
      temperature: config.llm.temperature,
    }),
  });
  if (!response.ok) {
    let message = undefined;
    try {
      const data = await response.json();
      message = data.detail || data.error?.message;
    } catch (error) {}
    throw new Error(
      `${config.llm.openaiBaseUrl} HTTP Error: ${response.status} ${response.statusText}${message ? ` - ${message}` : ""}`,
    );
  }

  let result;
  try {
    result = await response.json();
  } catch (error) {
    throw new Error(
      `Error when parsing json of ${config.llm.openaiBaseUrl}/chat/completions: ${error.message}`,
    );
  }
  if (!result.choices) {
    throw new Error("LLM API call failed!");
  }
  return result.choices[0].message.content;
}

async function summarizeText(title, splits, metaBlock) {
  // 元信息作为独立块传给 prompt（不混入 chunk）
  let meta = metaBlock ? "论文元信息：\n" + metaBlock : "";

  // If only one split, use "stuff" method
  if (splits.length === 1) {
    const response = await openaiRequest(
      formatString(stuff_prompt, {
        title: title,
        text: splits[0].content,
        meta: meta,
      }),
    );
    return response;
  }
  // 如果split太多就停止
  if (splits.length >= config.summary.maxChunk) {
    return null;
  }
  // For multiple splits, use map-reduce method
  const summaries = await Promise.all(
    splits.map(async (split) => {
      const response = await openaiRequest(
        formatString(map_prompt, {
          title: title,
          text: split.content,
          meta: meta,
        }),
      );
      return response;
    }),
  );
  const combinedSummary = summaries.join("\n\n");
  const response = await openaiRequest(
    formatString(reduce_prompt, {
      title: title,
      text: combinedSummary,
      meta: meta,
    }),
  );
  return response;
}
// 注意到action插件对于item与items的处理逻辑，action插件让我们不要使用ZoteroPane获取items
// https://github.com/windingwind/zotero-actions-tags?tab=readme-ov-file#-advanced-usage
// 但这个逻辑很变得奇怪。我还是自己获取items吧。
// 添加并发处理多个选中项的函数
async function processSelectedItems(items) {
  if (!items || items.length === 0) {
    // window.alert("请先选择要处理的文献");
    return "items size = 0";
  }

  // 使用 Promise.all 并发处理所有选中的项目
  let processNum = 0;
  let error_info = "";
  try {
    await Promise.all(
      items.map(async (item) => {
        try {
          let stats = await generateSummary(item);
          if (stats == true) {
            processNum++;
          } else {
            console.error(
              `处理文献 "${item.getField("title")}" 时出错:`,
              stats.message,
            );
            error_info += stats.message + "\n";
          }
        } catch (error) {
          console.error(`处理文献 "${item.getField("title")}" 时出错:`, error);
        }
      }),
    );
  } catch (error) {
    console.error("批量处理文献时出错:", error);
  }

  //return  "finsh process: sucess_num = " + processNum + " / total_num = " + items.length+
  //        "\n" + error_info;
}

let nitems = Zotero.getMainWindow().ZoteroPane.getSelectedItems();

// 执行处理
if (item) {
  // Disable the action if it's triggered for a single item to avoid duplicate operations
  if (nitems.length == 1) return await processSelectedItems(nitems);
} else {
  return await processSelectedItems(nitems);
}
