// 每当打开zotero的时候，都会自动运行这个脚本
// 把所有的笔记都导出来，然后保存到一个目录里，方便后续跟笔记软件的同步
// 笔记的形式：item元信息+{连接-> note（包括自动生成的标注， AI生成的摘要等）}

// key of content, value of file name suffix

// ==================== 配置读取 ====================
// 沿用项目约定：从仓库根目录 config.json 读取部署相关配置
// config.json 缺失或字段缺失时，使用内置默认值兜底
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

// 配置必需字段逐一校验，缺失即抛错退出（不做默认值兜底）
function requireConfig(keys) {
  for (const key of keys) {
    if (!(key in exportConfig)) {
      throw new Error(`config.json 缺少 note_export.${key}，请检查配置后重试`);
    }
  }
}

let config;
try {
  config = JSON.parse(await load_file("config.json"));
} catch (error) {
  throw new Error(`读取 config.json 失败: ${error.message}`);
}
if (!config.note_export) {
  throw new Error("config.json 缺少 note_export 配置段");
}
const exportConfig = config.note_export;

requireConfig([
  "key_names",
  "notewrite_dir",
  "last_save_time_file",
  "min_length",
  "index_template_path",
]);

// 笔记类型识别规则
let keyNames = exportConfig.key_names;

let notewrite_dir = exportConfig.notewrite_dir;
let last_save_time_path =
  notewrite_dir + "/" + exportConfig.last_save_time_file;
let last_save_time = Zotero.File.getContents(last_save_time_path);
let ignore_last_save_time = exportConfig.ignore_last_save_time;

const min_length = exportConfig.min_length;
const min_time_gap = exportConfig.min_time_gap; // 默认30秒

function getYesterday() {
  // 获取当前日期
  const today = new Date();

  // 获取昨天的日期
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1); // 将日期减去 1 天

  // 格式化日期为 YYYY-MM-DD 格式
  const year = yesterday.getFullYear();
  const month = String(yesterday.getMonth() + 1).padStart(2, "0"); // 月份从 0 开始，需要加 1
  const day = String(yesterday.getDate()).padStart(2, "0");

  const formattedDate = `${year}-${month}-${day}`;
  return formattedDate;
}
// clean this 2 directory

// 主文件：每个 parent 一个 <标题>.md，含 parent 元信息 + 指向该 parent 所有 note 的链接
// 每次 writeNoteContent 时同步更新该 parent 对应的主文件

async function getAllNotes() {
  try {
    // 获取用户库所有条目
    const s = new Zotero.Search();
    s.addCondition("libraryID", "is", Zotero.Libraries.userLibraryID);
    s.addCondition("itemType", "is", "note");

    // 执行搜索
    const noteIds = await s.search();

    // 获取所有笔记对象
    const notes = await Zotero.Items.getAsync(noteIds);

    // 调试信息
    Zotero.debug(`找到 ${notes.length} 条笔记`);

    return notes;
  } catch (error) {
    Zotero.debug(`获取笔记失败: ${error.message}`);
    throw error;
  }
}

function isYesterday(dateString) {
  // 将时间字符串转换为 Date 对象
  const targetDate = new Date(dateString);

  // 获取当前日期
  const now = new Date();

  // 获取昨天的日期（当前日期减去1天）
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  // 获取昨天的起始时间（昨天00:00:00）和结束时间（昨天23:59:59）的时间戳
  const startOfYesterday = new Date(
    yesterday.getFullYear(),
    yesterday.getMonth(),
    yesterday.getDate(),
  );
  const endOfYesterday = new Date(
    yesterday.getFullYear(),
    yesterday.getMonth(),
    yesterday.getDate() + 1,
  );

  // 判断目标日期是否在昨天的范围内
  return targetDate >= startOfYesterday && targetDate < endOfYesterday;
}

// ==================== 主文件（元信息 + 指向 note 的链接） ====================

// 主文件头部模板路径（从 config 读取，必需）
// 部署时可将仓库 prompt/note_index_template.txt 复制到该路径
let index_template_path = exportConfig.index_template_path;

let index_template = null;

// 读取模板文件（从 config 指定路径），失败即抛错退出
function loadIndexTemplate() {
  if (index_template !== null) return index_template;
  index_template = Zotero.File.getContents(index_template_path);
  return index_template;
}

// 通用模板渲染：{key} 占位符替换，值为空时留空（行保留）
function renderTemplate(tpl, params) {
  return tpl.replace(/\{(\w+)\}/g, (m, key) => {
    const v = params[key];
    return v === undefined || v === null ? "" : String(v);
  });
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getSafeTitle(title, maxLength = 75) {
  const cleanedTitle = String(title || "untitled")
    .replace(/[\0\\/:*?"<>|]/g, "")
    .trim();
  return (cleanedTitle || "untitled").slice(0, maxLength);
}

// 获取 parentItem 的作者列表，拼接为 "姓 名, 姓 名, ..." 形式
// 超过 MAX_AUTHORS 个作者时截断，末尾追加 "et al."（模拟模板文件的行为）
const MAX_AUTHORS = 10;

function getCreatorsText(item) {
  if (!item) return "";
  const creators = item.getCreators ? item.getCreators() : [];
  const names = creators
    .map((c) => {
      const name =
        c.fieldMode === 1
          ? c.lastName || c.name || ""
          : [c.firstName, c.lastName].filter(Boolean).join(" ");
      return name.trim();
    })
    .filter(Boolean);
  if (names.length > MAX_AUTHORS) {
    return names.slice(0, MAX_AUTHORS).join(", ") + ", et al.";
  }
  return names.join(", ");
}

// 获取文献来源文本：期刊/论文集/大学/出版社等，取第一个非空字段
function getSourceText(item) {
  if (!item) return "";
  const fields = [
    "publicationTitle",
    "journalAbbreviation",
    "proceedingsTitle",
    "university",
    "publisher",
    "repository",
    "institution",
    "meetingName",
  ];
  for (const f of fields) {
    const v = item.getField(f);
    if (v) return v;
  }
  return "";
}

// 生成主文件头部：parent 的元信息（标题、作者、日期、网址、摘要），由模板渲染
function buildIndexHeader(note) {
  const parent = note.parentItem;
  const vol = parent ? parent.getField("volume") || "" : "";
  const iss = parent ? parent.getField("issue") || "" : "";
  const pp = parent ? parent.getField("pages") || "" : "";
  const volIssPages = [
    vol ? `vol. ${vol}` : "",
    iss ? `no. ${iss}` : "",
    pp ? `pp. ${pp}` : "",
  ]
    .filter(Boolean)
    .join(", ");
  const params = {
    title: parent ? parent.getField("title") : "untitled",
    authors: getCreatorsText(parent),
    year: parent ? parent.getField("year") || "" : "",
    date: parent ? parent.getField("date") || "" : "",
    source: getSourceText(parent),
    vol_issue_pages: volIssPages,
    doi: parent ? parent.getField("DOI") || "" : "",
    url: parent ? parent.getField("url") || "" : "",
    abstract: parent
      ? (parent.getField("abstractNote") || "").replace(/\n+/g, " ")
      : "",
  };
  return renderTemplate(loadIndexTemplate(), params);
}

// 生成指向单个 note 文件的链接行（末尾带 marker 用于去重）
function buildNoteLink(note, directory, noteFilePath) {
  const relPath = noteFilePath.startsWith(directory + "/")
    ? noteFilePath.slice(directory.length + 1)
    : noteFilePath;
  const fileName = relPath.split("/").pop();
  const linkTarget = relPath.replace(/ /g, "%20");
  return `- [${fileName}](${linkTarget}) <!-- zotero-note:${note.id} -->`;
}

// 更新主文件：<目录>/<标题>.md
// 读取 -> 移除该 note 的旧链接行 -> 追加新链接行，保证同一 parent 只维护一个主文件
async function updateIndexFile(note, note_type, directory, filePath) {
  const parentTitle = note.parentItem
    ? note.parentItem.getField("title")
    : "untitled";
  const safeTitle = getSafeTitle(parentTitle);
  const indexPath = `${directory}/${safeTitle}.md`;
  const marker = `<!-- zotero-note:${note.id} -->`;

  let existing = "";
  try {
    const data = await IOUtils.read(indexPath);
    existing = new TextDecoder("utf-8").decode(data);
  } catch (error) {
    // 主文件尚不存在，稍后创建
  }

  // 移除该 note 已有的旧链接行，避免重复
  const entryRegex = new RegExp(
    "^[^\n]*" + escapeRegExp(marker) + "[^\n]*\n?",
    "gm",
  );
  existing = existing.replace(entryRegex, "");

  // 首次创建时补充 parent 元信息头部
  if (existing.trim() === "") {
    existing = buildIndexHeader(note);
  }

  const linkLine = buildNoteLink(note, directory, filePath);
  const updated = existing.replace(/\n*$/, "\n\n") + linkLine + "\n";

  const encoder = new TextEncoder();
  await IOUtils.write(indexPath, encoder.encode(updated));
  Zotero.debug(`主文件已更新: ${indexPath}`);
}

// 通过 Better Notes 导出 Markdown，会触发 Zotero 导出窗口。
async function writeNoteContentWithExport(note, note_type, directory) {
  try {
    if (!note || !note.parentItem) {
      Zotero.debug(`跳过无 parentItem 的 note: ${note ? note.id : "unknown"}`);
      return null;
    }

    IOUtils.makeDirectory(directory);
    // 获取父项目标题作为文件名的一部分
    const parentTitle = note.parentItem.getField("title") || "untitled";
    // 清理文件名，移除非法字符
    const safeTitle = getSafeTitle(parentTitle);

    // 创建文件名：标题_日期_笔记ID
    const parentDate = (note.parentItem.getField("date") || "")
      .replace(/[\\/:*?"<>|]/g, "-")
      .trim();
    const fileName = getSafeTitle(`${safeTitle}_${parentDate}_${note_type}.md`);
    const filePath = `${directory}/${fileName}`;
    const filePathTmp = `${directory}/${fileName}_tmp.md`;

    await Zotero.BetterNotes.api.$export.saveMD(filePathTmp, note.id);
    // 如果有需要修改内容

    let content = Zotero.File.getContents(filePathTmp);
    content = content.replace(/<[^>]*span[^>]*>/gi, "");
    content = content.replace(/\\<[^>]*img[^>]*>/gi, "");
    content = content.replace(/<!--[\s\S]*?-->/g, "");
    content = content.replace(/🔤/g, "");

    // 写入文件
    const encoder = new TextEncoder();
    await IOUtils.write(filePath, encoder.encode(content));
    await IOUtils.remove(filePathTmp);

    // 更新主文件：元信息 + 指向 note 的链接
    await updateIndexFile(note, note_type, directory, filePath);

    Zotero.debug(`笔记已保存到: ${filePath}`);
    return filePath;
  } catch (error) {
    Zotero.debug(`写入笔记失败: ${error.message}`);
    throw error;
  }
}


// 使用示例
async function processNotes() {
  let all_export_notes = [];
  let new_export_notes = [];
  let lengths = [];
  let debugLines = [];

  let notes = await getAllNotes();
  // notes = notes.slice(0, 10);
  let status = "";
  let error_num = 0;
  for (const note of notes) {
    try {
      if (!note.parentItem) {
        Zotero.debug(`跳过无 parentItem 的 note: ${note.id}`);
        continue;
      }

      const content = note.getNote();
      const dateModified = note.dateModified;
      const parentTitle = note.parentItem.getField("title") || "untitled";

      let note_type = null;
      let matchedKey = null;
      for (const key in keyNames) {
        if (content.includes(key.trim())) {
          note_type = keyNames[key];
          matchedKey = key;
          break;
        }
      }

      const passLength = content.length > min_length;
      const shouldExport =
        dateModified > last_save_time ||
        exportConfig.ignore_last_save_time ||
        last_save_time == "";

      const debugLine =
        `[note_export] id=${note.id} title=${parentTitle} matchedKey=${matchedKey ?? "none"} noteType=${note_type ?? "none"} len=${content.length} min=${min_length} passLength=${passLength} dateModified=${dateModified} last_save_time=${last_save_time} shouldExport=${shouldExport}`;
      // Zotero.debug(debugLine);
      // debugLines.push(debugLine);

      lengths.push([parentTitle, content.length, note_type]);
      if (note_type != null) {
        if (content.length > min_length) {
          all_export_notes.push(note);
          if (shouldExport) {
            Zotero.debug(debugLine);
            new_export_notes.push(note);
            await writeNoteContentWithExport(
              note,
              note_type,
              notewrite_dir + "/" + getSafeTitle(parentTitle),
            );
          }
        }
      }
    } catch (error) {
      Zotero.debug(`处理笔记时出错: ${error.stack}`);
      error_num = error_num + 1;
      status = status + `\n处理笔记时出错:  ${error.lineNumber} 行, ${error.message}`;
    }
  }

  // Zotero.debug(`[note_export] 总调试：${debugLines.join(" | ")}`);
  return [status, all_export_notes, new_export_notes];
}

function checkDate() {

  if (last_save_time == null || last_save_time == "") {
    return true;
  }

  // 获取当前时间
  let now = new Date();

  // 将目标时间字符串转换为 Date 对象
  let targetDate = new Date(last_save_time);

  // 计算两个时间之间的差值（以毫秒为单位）
  let difference = Math.abs(targetDate - now);

  // 判断是否相差30秒以上
  if (difference >= 30) {
    return true;
  } else {
    return false;
  }
}

async function process() {
  // 距离上次相差30秒以上才会执行
  if (!checkDate() && !ignore_last_save_time) {
    return "距离上次保存不足30秒，跳过";
  }

  const now = new Date();
  let [status, all_export_notes, new_export_notes] = await processNotes();
  // result.sort((a,b)=>b[1]-a[1]);
  // 写入文件
  const encoder = new TextEncoder();
  if (status == "") {
    await IOUtils.write(last_save_time_path, encoder.encode(now.toISOString()));
  }
  return `[${now.toISOString()}] Status = ${status}, 一共 ${all_export_notes.length}个note,  本次更新${new_export_notes.length}个note`;
}

/*
if (typeof item == "undefined" || item == null) {
  return await process();
} else {
  return;
}
*/

// 1. 封装 sleep 函数
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

let log_path =
  notewrite_dir + "/" + "zotero_sync.log";
// 将 result 插入日志第一行（最新在上），并约束日志最多保留 MAX_LOG_LINES 行
const MAX_LOG_LINES = 1000;
async function appendLog(result) {
  const encoder = new TextEncoder();
  let logContent = "";
  try {
    const buf = await IOUtils.read(log_path);
    logContent = new TextDecoder("utf-8").decode(buf);
  } catch (error) {
    // 日志文件不存在，视为空文件继续
  }
  const newLines = [result, ...logContent.split("\n")].filter(
    (line) => line !== "",
  );
  const limited = newLines.slice(0, MAX_LOG_LINES);
  await IOUtils.write(log_path, encoder.encode(limited.join("\n") + "\n"));
}

// 2. 主循环（无限运行）
async function startLoop() {
  while (true) {
    const result = await process();      // 执行任务
    // 将本次执行结果追加到日志文件
    await appendLog(result);
    // 
    // 4. 无论刚才是否执行了 process，都等待 1 分钟（60000 毫秒）
    await sleep(60000);
  }
}

// 5. 启动循环
startLoop();