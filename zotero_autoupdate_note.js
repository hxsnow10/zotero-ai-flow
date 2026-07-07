/**
 * A description of this script.
 * @author hxsnow10
 * @usage
 * @link https://github.com/windingwind/zotero-actions-tags/discussions/466
 */

const Zotero = require("Zotero");
const window = require("window");
const console = require("console");

let templateName = "[item]标记自动生成的层次笔记模板";
let update_all = true;

// 检查 PDF 标注
async function hasAnnotations(parentItem) {
  let dateModified = null;
  try {
    // 获取所有附件
    const attachments = parentItem.getAttachments();
    for (let attachmentId of attachments) {
      const attachment = await Zotero.Items.getAsync(attachmentId);
      // 检查是否为 PDF
      if (attachment.attachmentContentType === "application/pdf") {
        // 获取标注
        const annotations = attachment.getAnnotations();
        if (annotations && annotations.length > 0) {
          for (let annot of annotations) {
            if (!dateModified || annot.dateModified > dateModified) {
              dateModified = annot.dateModified;
            }
          }
          return [true, dateModified];
        }
      }
    }
    return [false, dateModified];
  } catch (error) {
    Zotero.debug(`检查PDF标注失败: ${error.message}`);
    return [false, dateModified];
  }
}

async function generateNote(item) {
  if (!Zotero.BetterNotes?.api.note?.insert) {
    return "[Action:Auto-Template] Better Notes for Zotero > 1.1.4-21 is not installed or disabled.";
  }

  if (!item) {
    return "[Action:Auto-Template] Target item is empty";
  }

  let [hasAnnots, lastAnnotModified] = await hasAnnotations(item);

  if (!hasAnnots) {
    return "[Action:Auto-Template] No annotations found in PDF";
  }

  // remove existing notes that were automatically created
  const noteIDs = item.getNotes();
  for (let id of noteIDs) {
    let note = Zotero.Items.get(id);
    let noteHTML = note.getNote();
    if (!noteHTML) {
      Zotero.Items.trashTx(id);
      continue;
    }
    if (noteHTML.includes(templateName)) {
      let noteLastModified = note.dateModified;

      if (!update_all && noteLastModified >= lastAnnotModified) {
        return `[Action:Auto-Template] Note is up to date, noteModify = ${noteLastModified}, annoModify  =${lastAnnotModified}`;
      }
      console.log("Removing old auto-created note", id, noteHTML);
      try {
        Zotero.Items.trashTx(id);
      } catch (error) {
        console.error(`Failed to remove old auto-created note ${id}:`, error);
      }
    }
  }

  let templateContent =
    Zotero.BetterNotes.api.template.getTemplateText(templateName);
  if (!templateContent) {
    return "[Action:Auto-Template] Template is invalid";
  }
  // TODO：怎么让这个return window显示几秒就自动消失呢

  // zotero item修改时间不会看annotation以及note的修改时间
  // 需要查看annoation的修改时间

  const parentItem = item;

  const noteItem = new Zotero.Item("note");
  noteItem.libraryID = parentItem.libraryID;
  noteItem.parentID = parentItem.id;
  await noteItem.saveTx();

  let html = "";
  if (templateName.toLowerCase().startsWith("[item]")) {
    html = await Zotero.BetterNotes.api.template.runItemTemplate(templateName, {
      itemIds: [parentItem.id],
      targetNoteId: noteItem.id,
    });
  } else {
    html = await Zotero.BetterNotes.api.template.runTextTemplate(templateName, {
      targetNoteId: noteItem.id,
    });
  }
  await Zotero.BetterNotes.api.note.insert(noteItem, html, -1);
  return true;
}

async function processSelectedItems(items) {
  // 获取所有选中的项目
  if (!items || items.length == 0) {
    window.alert("请先选择要处理的文献");
    return "items size = 0";
  }
  // 加个window显示进度
  progressWindow = new Zotero.ProgressWindow({
    closeOnClick: false,
  });
  progressWindow.addDescription("正在更新选中的文献的annotation-note...");
  itemProgress = new progressWindow.ItemProgress();
  itemProgress.setItemTypeAndIcon("note");
  progressWindow.show();
  // 使用 Promise.all 并发处理所有选中的项目
  let processNum = 0;
  let processSuccNum = 0;
  let error_info = {};
  try {
    function chunkArray(arr, k) {
      const result = [];
      for (let i = 0; i < arr.length; i += k) {
        result.push(arr.slice(i, i + k));
      }
      return result;
    }
    let itemList = chunkArray(items, 20);
    for (let item_list of itemList) {
      itemProgress.setProgress(parseInt((processNum / items.length) * 100));
      itemProgress.setText(
        `正在处理第 ${processNum + 1} / ${items.length} 个文献`,
      );
      await Promise.all(
        item_list.map(async (itemx) => {
          try {
            processNum++;
            let stats = await generateNote(itemx);
            if (stats == true) {
              processSuccNum++;
            } else {
              // console.error(`处理文献 "${item.getField('title')}" 时出错:`, stats);
              error_info[stats] += 1;
            }
          } catch (error) {
            console.error(
              `处理文献 "${item.getField("title")}" 时出错:`,
              error,
            );
          }
        }),
      );
    }
  } catch (error) {
    console.error("批量处理文献时出错:", error);
  }
  itemProgress.setProgress(100);
  itemProgress.setText(
    "finsh process: sucess_num = " +
      processSuccNum +
      " / total_num = " +
      items.length,
  );
  progressWindow.startCloseTimer(5000);
  return (
    "finsh process: sucess_num = " +
    processNum +
    " / total_num = " +
    items.length +
    "\n" +
    error_info
  );
}

let nitems = Zotero.getMainWindow().ZoteroPane.getSelectedItems();

// 执行处理
if (item) {
  // Disable the action if it's triggered for a single item to avoid duplicate operations
  // if (nitems.length==1) return await processSelectedItems(nitems);
  if (nitems.length == 1) return await generateNote(item);
} else {
  if (nitems.length > 1) return await processSelectedItems(nitems);
}
