/**
 * @class       : zotero_week_summary
 * @author      : xiahong (xiahahaha01@gmail.com)
 * @created     : Saturday Jul 18, 2026 09:47:59 CST
 * @description : zotero_week_summary - 每周总结，统计本周的文献阅读情况，生成一份周报
 */

/* 每周总结，统计本周的文献阅读情况，生成一份周报。
 * 时间范围：最近的周一到周日
 * 退出逻辑：判定指定目录下是否存在 week_summary_{date-date}.md 文件，如果存在则退出
 * 搜索范围：搜索所有本周新加的文献，以及修改过的笔记
 * 处理逻辑：根据prompt/zotero_week_summary_prompt.txt中的提示，根据文献的元信息、LLM摘要笔记、阅读笔记，生成一份周报
 */

// ============================================================================
// 总体逻辑：
// 1. 读取配置 & 加载周报 prompt 模板
// 2. 计算本周一 ~ 本周日的日期范围
// 3. 检查输出目录下是否已存在本周周报，存在则跳过
// 4. 搜索本周新增的文献条目（按 dateAdded 筛选）
// 5. 搜索本周修改过的笔记，追溯到其父条目（捕获旧文献的本周阅读活动）
// 6. 合并去重，为每篇文献收集元信息、AI 摘要笔记和阅读笔记
// 7. 组装 prompt 调用 LLM 生成周报 markdown
// 8. 保存周报到指定目录
// ============================================================================

/************* Configurations Start *************/

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

// 加载 prompt（遵循项目约定，prompt 文件位于 prompt/ 目录，命名格式为 *_prompt.txt）
function load_prompt(pname) {
  pname = "prompt/" + pname + "_prompt.txt";
  return load_file(pname);
}

let week_summary_prompt = await load_prompt("zotero_week_summary");

// 周报输出目录：使用 config.work_dir，若未配置则回退到 dirname 下的 workspace
const outputDir = config.work_dir || dirname + "/workspace";

/************* Configurations End *************/

let console = require("console");

// ============================================================================
// 工具函数
// ============================================================================

function formatString(str, params) {
  return str.replace(/{([^{}]*)}/g, (match, key) => {
    return params[key] || match;
  });
}

/**
 * 格式化日期为 YYYY-MM-DD 字符串
 */
function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * 计算本周一 00:00:00 ~ 本周日 23:59:59
 * 周一为一周的开始（符合中国习惯）
 */
function getWeekRange() {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=周日, 1=周一, ..., 6=周六

  // 计算本周一的偏移
  const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

  const monday = new Date(now);
  monday.setDate(now.getDate() - mondayOffset);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  return { monday, sunday };
}

/**
 * 检查指定目录下是否已存在本周周报文件
 * @returns {{ exists: boolean, filePath: string, fileName: string }}
 */
function checkExisting(weekRange) {
  const startStr = formatDate(weekRange.monday);
  const endStr = formatDate(weekRange.sunday);
  const fileName = `week_summary_${startStr}_${endStr}.md`;
  const filePath = outputDir + "/" + fileName;

  try {
    const content = Zotero.File.getContents(filePath);
    if (content && content.length > 0) {
      return { exists: true, filePath, fileName };
    }
  } catch (e) {
    // 文件不存在，继续
  }
  return { exists: false, filePath, fileName };
}

// ============================================================================
// 搜索函数
// ============================================================================

/**
 * 搜索本周新增的文献条目（按 dateAdded 筛选）
 * 使用 Zotero.Search 搜索本周一以后添加的条目，再在 JS 侧过滤到本周范围内
 */
async function getItemsAddedThisWeek(weekRange) {
  const s = new Zotero.Search();
  s.libraryID = Zotero.Libraries.userLibraryID;

  const mondayStr = formatDate(weekRange.monday);
  s.addCondition("dateAdded", "isAfter", mondayStr);

  const ids = await s.search();
  const items = [];

  for (const id of ids) {
    const item = Zotero.Items.get(id);
    if (!item || !item.isRegularItem() || !item.isTopLevelItem()) continue;

    const addedDate = new Date(item.dateAdded);
    if (addedDate >= weekRange.monday && addedDate <= weekRange.sunday) {
      items.push(item);
    }
  }

  return items;
}

/**
 * 搜索本周修改过的笔记，返回这些笔记对应的父文献条目
 * 用于捕获「旧文献在本周被阅读/修改笔记」的情况
 */
async function getItemsWithNotesModifiedThisWeek(weekRange) {
  const s = new Zotero.Search();
  s.libraryID = Zotero.Libraries.userLibraryID;
  s.addCondition("itemType", "is", "note");

  const ids = await s.search();
  const parentIdSet = new Set();

  for (const id of ids) {
    const note = Zotero.Items.get(id);
    if (!note) continue;

    const modDate = new Date(note.dateModified);
    if (modDate >= weekRange.monday && modDate <= weekRange.sunday) {
      if (note.parentItemID) {
        parentIdSet.add(note.parentItemID);
      }
    }
  }

  const items = [];
  for (const pid of parentIdSet) {
    const item = Zotero.Items.get(pid);
    if (item && item.isRegularItem()) {
      items.push(item);
    }
  }

  return items;
}

// ============================================================================
// 信息收集函数
// ============================================================================

/**
 * 清理 HTML 标签和实体，得到纯文本
 */
function cleanHtml(html) {
  if (!html) return "";
  return html
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
}

/**
 * 收集单篇文献的完整信息：元信息 + AI 摘要笔记 + 阅读笔记
 */
function collectItemInfo(item) {
  const title = item.getField("title") || "(无标题)";
  const abstractNote = item.getField("abstractNote") || "";
  const publicationTitle = item.getField("publicationTitle") || "";
  const date = item.getField("date") || "";
  const url = item.getField("url") || "";
  const itemType = item.itemType || "";

  // 作者列表
  let authorsStr = "";
  const creators = item.getCreators ? item.getCreators() : null;
  if (creators && creators.length > 0) {
    authorsStr = creators
      .map((c) => (c.firstName || "") + " " + (c.lastName || ""))
      .join(", ")
      .trim();
  }

  const cleanAbstract = cleanHtml(abstractNote);

  // 收集笔记：区分 AI 摘要笔记和用户阅读笔记
  let aiSummaryNotes = [];
  let readingNotes = [];

  const noteIds = item.getNotes();
  for (const nid of noteIds) {
    const note = Zotero.Items.get(nid);
    if (!note) continue;

    const noteContent = note.getNote();
    if (!noteContent) continue;

    const cleanContent = cleanHtml(noteContent);
    if (cleanContent.length < 50) continue; // 跳过过短的笔记

    if (noteContent.includes("AI Generated Summary")) {
      aiSummaryNotes.push(cleanContent);
    } else if (noteContent.includes("Annotation")) {
      // 标注类笔记也算阅读笔记
      readingNotes.push(cleanContent);
    } else {
      readingNotes.push(cleanContent);
    }
  }

  return {
    title,
    authors: authorsStr,
    abstract: cleanAbstract,
    journal: publicationTitle,
    date,
    url,
    itemType,
    aiSummary: aiSummaryNotes.join("\n---\n"),
    readingNotes: readingNotes.join("\n---\n"),
    hasAiSummary: aiSummaryNotes.length > 0,
    hasReadingNotes: readingNotes.length > 0,
    isNewThisWeek: true, // 由调用方设置
    wasReadThisWeek: readingNotes.length > 0 || aiSummaryNotes.length > 0,
  };
}

/**
 * 将文献信息列表格式化为 LLM prompt 的输入文本
 */
function formatItemsForPrompt(itemsInfo, totalCount, newCount, readCount) {
  // 先输出统计摘要
  let text = `## 统计\n`;
  text += `- 本周文献总数：${totalCount} 篇\n`;
  text += `- 本周新增：${newCount} 篇\n`;
  text += `- 本周有阅读/笔记活动：${readCount} 篇\n\n`;

  // 分组输出
  // 1. 新增且有阅读的
  const newAndRead = itemsInfo.filter((i) => i.isNewThisWeek && i.wasReadThisWeek);
  // 2. 新增但未阅读的
  const newUnread = itemsInfo.filter((i) => i.isNewThisWeek && !i.wasReadThisWeek);
  // 3. 旧文献但本周有阅读
  const oldButRead = itemsInfo.filter((i) => !i.isNewThisWeek && i.wasReadThisWeek);

  if (newAndRead.length > 0) {
    text += `## 🆕📖 本周新增且已阅读（${newAndRead.length} 篇）\n\n`;
    text += formatItemsGroup(newAndRead);
  }

  if (newUnread.length > 0) {
    text += `## 🆕 本周新增未阅读（${newUnread.length} 篇）\n\n`;
    text += formatItemsGroup(newUnread);
  }

  if (oldButRead.length > 0) {
    text += `## 📖 旧文献本周阅读（${oldButRead.length} 篇）\n\n`;
    text += formatItemsGroup(oldButRead);
  }

  return text;
}

function formatItemsGroup(items) {
  let text = "";
  for (let i = 0; i < items.length; i++) {
    const info = items[i];
    text += `### 文献 ${i + 1}\n`;
    text += `- 标题: ${info.title}\n`;
    if (info.authors) text += `- 作者: ${info.authors}\n`;
    if (info.journal) text += `- 期刊: ${info.journal}\n`;
    if (info.date) text += `- 日期: ${info.date}\n`;
    if (info.url) text += `- 链接: ${info.url}\n`;
    if (info.abstract) {
      text += `- 摘要: ${info.abstract.substring(0, 500)}\n`;
    }
    if (info.aiSummary) {
      text += `- AI 摘要笔记:\n  ${info.aiSummary.substring(0, 2000).replace(/\\n/g, "\\n  ")}\n`;
    }
    if (info.readingNotes) {
      text += `- 阅读笔记:\n  ${info.readingNotes.substring(0, 2000).replace(/\\n/g, "\\n  ")}\n`;
    }
    text += "\n---\n\n";
  }
  return text;
}

// ============================================================================
// LLM 调用
// ============================================================================

async function openaiRequest(message) {
  const response = await fetch(`${config.llm.openaiBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.llm.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.llm.modelName,
      messages: [{ role: "user", content: message }],
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

// ============================================================================
// 主流程
// ============================================================================

async function generateWeekSummary() {
  const progressWindow = new Zotero.ProgressWindow({ closeOnClick: false });
  progressWindow.addDescription("生成本周阅读周报...");
  const itemProgress = new progressWindow.ItemProgress();
  itemProgress.setItemTypeAndIcon("note");
  progressWindow.show();

  try {
    // 1. 计算本周日期范围
    const weekRange = getWeekRange();
    const weekLabel = `${formatDate(weekRange.monday)} ~ ${formatDate(weekRange.sunday)}`;

    // 2. 检查是否已存在
    itemProgress.setProgress(5);
    itemProgress.setText("检查是否已生成本周周报...");
    const { exists, filePath } = checkExisting(weekRange);
    if (exists) {
      itemProgress.setProgress(100);
      itemProgress.setText(`本周周报已存在: ${filePath}`);
      progressWindow.startCloseTimer(3000);
      return `本周周报已生成，路径: ${filePath}`;
    }

    // 3. 搜索本周新增文献
    itemProgress.setProgress(10);
    itemProgress.setText("搜索本周新增文献...");
    const newItems = await getItemsAddedThisWeek(weekRange);

    // 4. 搜索本周笔记修改对应的文献（捕获旧文献阅读）
    itemProgress.setProgress(30);
    itemProgress.setText("搜索本周阅读/笔记活动...");
    const modifiedNoteItems =
      await getItemsWithNotesModifiedThisWeek(weekRange);

    // 5. 合并去重（新增文献优先标记为 isNew）
    const itemMap = new Map();
    for (const item of newItems) {
      itemMap.set(item.id, { item, isNew: true });
    }
    for (const item of modifiedNoteItems) {
      if (!itemMap.has(item.id)) {
        itemMap.set(item.id, { item, isNew: false });
      }
    }

    if (itemMap.size === 0) {
      itemProgress.setProgress(100);
      itemProgress.setText("本周无新增文献或阅读活动。");
      progressWindow.startCloseTimer(3000);
      return "本周无新增文献或阅读活动。";
    }

    // 6. 收集每篇文献的详细信息
    itemProgress.setProgress(45);
    itemProgress.setText(`收集 ${itemMap.size} 篇文献信息...`);

    const itemsInfo = [];
    for (const [id, { item, isNew }] of itemMap) {
      const info = collectItemInfo(item);
      info.isNewThisWeek = isNew;
      itemsInfo.push(info);
    }

    const newCount = itemsInfo.filter((i) => i.isNewThisWeek).length;
    const readCount = itemsInfo.filter((i) => i.wasReadThisWeek).length;

    // 7. 组装 prompt 并调用 LLM
    itemProgress.setProgress(60);
    itemProgress.setText(`正在生成周报（共 ${itemMap.size} 篇文献）...`);

    const itemsText = formatItemsForPrompt(
      itemsInfo,
      itemMap.size,
      newCount,
      readCount,
    );
    const prompt = formatString(week_summary_prompt, {
      week_range: weekLabel,
      total_count: String(itemMap.size),
      new_count: String(newCount),
      read_count: String(readCount),
      items_text: itemsText,
    });

    const report = await openaiRequest(prompt);

    if (!report || report.length < 50) {
      throw new Error("LLM 返回的周报内容过短，请检查 prompt 或 API");
    }

    // 8. 保存周报到指定目录
    itemProgress.setProgress(90);
    itemProgress.setText("保存周报...");

    // 确保输出目录存在
    try {
      IOUtils.makeDirectory(outputDir);
    } catch (e) {
      // 目录可能已存在，忽略错误
    }

    const encoder = new TextEncoder();
    await IOUtils.write(filePath, encoder.encode(report));

    itemProgress.setProgress(100);
    itemProgress.setText(`周报已保存: ${filePath}`);
    progressWindow.startCloseTimer(5000);

    return `周报生成成功，路径: ${filePath}`;
  } catch (error) {
    itemProgress.setError();
    itemProgress.setText(`生成周报失败: ${error.message}`);
    progressWindow.addDescription("");
    progressWindow.startCloseTimer(5000);
    return `Error: ${error.message}`;
  }
}

// ============================================================================
// 执行入口
// ============================================================================

// 该脚本通过 Zotero Actions 插件触发，无需选中条目即可运行
return await generateWeekSummary();
