// 每当打开zotero的时候，都会自动运行这个脚本
// 把所有的笔记都导出来，然后保存到一个目录里，方便后续跟笔记软件的同步
// 笔记的形式：item元信息+{连接-> note（包括自动生成的标注， AI生成的摘要等）}

// key of content, value of file name suffix
let keyNames = {
  "[item]标记自动生成的层次笔记模板": "Annotation",
  "AI Generated Summary": "AI-Summary",
};

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
  "all_dir_name",
  "new_dir_name",
  "min_length",
  "index_template_path",
  "ignore_last_save_time",
]);

// 笔记类型识别规则
keyNames = exportConfig.key_names;

let notewrite_dir = exportConfig.notewrite_dir;
let last_save_time_path =
  notewrite_dir + "/" + exportConfig.last_save_time_file;
let last_save_time = Zotero.File.getContents(last_save_time_path);

let ignore_last_save_time = exportConfig.ignore_last_save_time;
const min_length = exportConfig.min_length;

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

let all_note_dir = notewrite_dir + "/" + exportConfig.all_dir_name;
let new_note_dir = notewrite_dir + "/" + exportConfig.new_dir_name;

// 主文件：每个 parent 一个 <标题>.md，含 parent 元信息 + 指向该 parent 所有 note 的链接
// 每次 writeNoteContent 时同步更新该 parent 对应的主文件

//IOUtils.remove(all_note_dir,{recursive: true});
//IOUtils.remove(new_note_dir);
IOUtils.makeDirectory(all_note_dir);
IOUtils.makeDirectory(new_note_dir);

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
  const safeTitle = parentTitle.replace(/[\0\/]/g, "");
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

async function writeNoteContent(note, note_type, directory) {
  try {
    IOUtils.makeDirectory(directory);
    // 获取父项目标题作为文件名的一部分
    const parentTitle = note.parentItem
      ? note.parentItem.getField("title")
      : "untitled";
    // 清理文件名，移除非法字符
    const safeTitle = parentTitle.replace(/[\0\/]/g, "");

    // 创建文件名：标题_日期_笔记ID
    const fileName = `${safeTitle}_${note.parentItem.getField("date")}_${note_type}.md`;
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

  const notes = await getAllNotes();

  for (const note of notes) {
    try {
      // 获取笔记内容
      const content = note.getNote();
      // 获取修改时间
      const dateModified = note.dateModified;
      // 获取父条目（如果有）
      const parentItem = note.parentItem;
      let note_type = null;
      for (const key in keyNames) {
        if (content.includes(key.trim())) {
          note_type = keyNames[key];
          break;
        }
      }
      const parentTitle = note.parentItem
        ? note.parentItem.getField("title")
        : "untitled";
      lengths.push([parentTitle, content.length, note_type]);
      if (note_type != null) {
        if (content.length > min_length) {
          if (ignore_last_save_time) {
            all_export_notes.push(note);
            await writeNoteContent(
              note,
              note_type,
              all_note_dir + "/" + parentTitle,
            );
          }
          // await writeNoteContent(note, note_type, all_note_dir+"/"+parentTitle);
          if (dateModified > last_save_time || ignore_last_save_time) {
            // 保存目录的逻辑：  可以就保存到一个目录里，然后整体打包导入wolai，导入后这些都移除，
            // 下次保存就是那些增量的，导入就少了
            new_export_notes.push(note);
            await writeNoteContent(
              note,
              note_type,
              new_note_dir + "/" + parentTitle,
            );
            await writeNoteContent(
              note,
              note_type,
              all_note_dir + "/" + parentTitle,
            );
          }
        }
      }
    } catch (error) {
      Zotero.debug(`处理笔记时出错: ${error.message}`);
    }
  }

  return [all_export_notes, new_export_notes];
}

function checkDate() {
  // 获取当前时间
  let now = new Date();

  // 将目标时间字符串转换为 Date 对象
  let targetDate = new Date(last_save_time);

  // 计算两个时间之间的差值（以毫秒为单位）
  let difference = Math.abs(targetDate - now);

  // 将差值转换为天数
  let daysDifference = difference / (1000 * 60 * 60 * 24);

  // 判断是否相差7天以上
  if (daysDifference >= 7) {
    return true;
  } else {
    return false;
  }
}

async function process() {
  // 距离上次相差7天以上才会执行
  // if (!checkDate() && !ignore_last_save_time) {
  //   return "距离上次保存不足7天，跳过";
  // }

  let [all_export_notes, new_export_notes] = await processNotes();
  // result.sort((a,b)=>b[1]-a[1]);

  // 写入文件
  const now = new Date();
  const encoder = new TextEncoder();
  await IOUtils.write(last_save_time_path, encoder.encode(now.toISOString()));
  return "一共导出 ${all_export_note}个note->all, ${new_export_notes}个note->new";
}

if (typeof item == "undefined" || item == null) {
  return await process();
} else {
  return;
}
