/**
 * Zotero AI Flow - start_script.js
 * 内置事件监控与脚本路由调度器
 *
 * 替代 zotero-actions-tags 的事件触发功能，直接监听 Zotero 内部事件，
 * 在以下触发点执行配置的行为脚本：
 *   - ui_startup : Zotero 界面启动时
 *   - item_open   : 文献条目打开时
 *   - item_close  : 文献条目关闭时
 *   - item_add    : 文献条目入库时
 *
 * 使用方式（二选一）：
 *   1. 安装插件：将 zotero_plugin/ 打包成 .xpi 安装到 Zotero，启动时自动加载
 *      bash scripts/build_xpi.sh && 拖入 Zotero → 工具 → 插件
 *   2. 手动加载：Zotero → 工具 → 开发者 → Run JavaScript 加载本脚本
 *
 * @author xiahong xiahahaha01@gmail.com
 */

/************* Configurations Start *************/

// 脚本根目录（存放各个行为脚本的目录）
const SCRIPT_DIR = "/home/xiahong/code/zotero-ai-flow/zotero_actions";

// 配置文件路径（与 parse_server.py 共用 config.json）
const CONFIG_PATH = "/home/xiahong/code/zotero-ai-flow/config.json";

// 默认触发配置（若 config.json 中无 zotero_events 字段则使用此默认值）
const DEFAULT_TRIGGER_CONFIG = {
  ui_startup: ["zotero_autoupdate_note.js"],
  item_open: ["zotero_pdf_summary.js"],
  item_close: [],
  item_add: ["zotero_rss.js"],
};

// 事件去抖间隔（毫秒），防止短时间内重复触发
const DEFAULT_DEBOUNCE_MS = {
  ui_startup: 0,
  item_open: 2000,
  item_close: 1000,
  item_add: 5000,
};

// 是否启用调试日志
const DEBUG = true;

/************* Configurations End *************/

// 暴露清理函数到全局作用域，供插件 bootstrap.js 的 shutdown() 调用
// 当脚本在 Run JavaScript 中手动执行时也会自动启动
var __zaf_unregisterNotifiers;
var __zaf_notifierIDs;

// ========== 工具函数 ==========

function log() {
  if (DEBUG) {
    var msg = "[zotero-ai-flow]";
    for (var i = 0; i < arguments.length; i++) {
      msg += " " + arguments[i];
    }
    Zotero.debug(msg);
  }
}

function warn() {
  var msg = "[zotero-ai-flow:WARN]";
  for (var i = 0; i < arguments.length; i++) {
    msg += " " + arguments[i];
  }
  Zotero.debug(msg);
}

/**
 * 从 config.json 读取触发配置
 */
function loadTriggerConfig() {
  try {
    if (IOUtils.exists(CONFIG_PATH)) {
      var raw = Zotero.File.getContents(CONFIG_PATH);
      var cfg = JSON.parse(raw);
      if (cfg.zotero_events && cfg.zotero_events.triggers) {
        log("已从 config.json 加载 zotero_events 配置");
        return cfg.zotero_events;
      }
    }
  } catch (e) {
    warn("读取 config.json 失败，使用默认配置:", e.message);
  }
  log("使用默认触发配置");
  return { triggers: DEFAULT_TRIGGER_CONFIG, debounce_ms: DEFAULT_DEBOUNCE_MS };
}

/**
 * 读取并执行指定脚本文件
 */
async function runScript(scriptName, context) {
  var eventsCfg = loadTriggerConfig();
  var dir = eventsCfg.script_dir || SCRIPT_DIR;
  var scriptPath = dir + "/" + scriptName;

  if (!(await IOUtils.exists(scriptPath))) {
    warn("脚本文件不存在:", scriptPath);
    return null;
  }

  log("执行脚本:", scriptName);

  try {
    var raw = await IOUtils.read(scriptPath);
    var decoder = new TextDecoder("utf-8");
    var scriptCode = decoder.decode(raw);

    // 将上下文对象挂到全局变量，供被调脚本使用
    // 被调脚本中直接使用 item / items / triggerEvent 全局变量
    __zaf_item = context.item || null;
    __zaf_items = context.items || null;
    __zaf_triggerEvent = context.triggerEvent || "";

    // 注入上下文变量声明 + 执行脚本
    var wrappedCode =
      "var item = __zaf_item;\n" +
      "var items = __zaf_items;\n" +
      "var triggerEvent = __zaf_triggerEvent;\n" +
      scriptCode;

    var result = eval(wrappedCode);

    // 清理
    __zaf_item = undefined;
    __zaf_items = undefined;
    __zaf_triggerEvent = undefined;

    log("脚本", scriptName, "执行完成");
    return result;
  } catch (e) {
    warn("脚本", scriptName, "执行出错:", e.message);
    __zaf_item = undefined;
    __zaf_items = undefined;
    __zaf_triggerEvent = undefined;
    return null;
  }
}

/**
 * 根据触发事件执行已配置的脚本列表
 */
async function triggerScripts(eventName, context) {
  var eventsCfg = loadTriggerConfig();
  var triggers = eventsCfg.triggers || DEFAULT_TRIGGER_CONFIG;
  var scripts = triggers[eventName];

  if (!scripts || scripts.length === 0) {
    log("事件", eventName, ": 无配置脚本，跳过");
    return;
  }

  log("事件", eventName, ": 将执行", scripts.length, "个脚本");

  for (var i = 0; i < scripts.length; i++) {
    await runScript(scripts[i], context);
  }
}

// ========== 去抖管理 ==========

var debounceTimers = {};
var pendingContexts = {};
var startupTriggered = false;

function triggerWithDebounce(eventName, context) {
  // ui_startup 只触发一次
  if (eventName === "ui_startup") {
    if (startupTriggered) return;
    startupTriggered = true;
  }

  var eventsCfg = loadTriggerConfig();
  var debounceCfg = eventsCfg.debounce_ms || DEFAULT_DEBOUNCE_MS;
  var delay =
    debounceCfg[eventName] !== undefined
      ? debounceCfg[eventName]
      : DEFAULT_DEBOUNCE_MS[eventName] || 0;

  // 合并上下文
  pendingContexts[eventName] = Object.assign(
    pendingContexts[eventName] || {},
    context || {},
  );

  if (delay === 0) {
    triggerScripts(eventName, pendingContexts[eventName]);
    delete pendingContexts[eventName];
    return;
  }

  if (debounceTimers[eventName]) {
    clearTimeout(debounceTimers[eventName]);
  }

  debounceTimers[eventName] = setTimeout(function () {
    triggerScripts(eventName, pendingContexts[eventName]);
    delete debounceTimers[eventName];
    delete pendingContexts[eventName];
  }, delay);
}

// ========== Zotero Notifier 事件监听 ==========

var notifierIDs = [];
__zaf_notifierIDs = notifierIDs;

function registerNotifiers() {
  unregisterNotifiers();

  // --- 监听 tab 事件（文献打开/关闭） ---
  var tabCallback = {
    notify: async function (event, type, ids, extraData) {
      try {
        if (event === "add") {
          log("Tab 打开: tabID=" + ids[0]);
          var items = Zotero.getMainWindow().ZoteroPane.getSelectedItems();
          if (items && items.length > 0) {
            var item = items[0];
            log("文献打开:", item.getField("title"));
            triggerWithDebounce("item_open", {
              item: item,
              items: items,
              triggerEvent: "item_open",
            });
          }
        } else if (event === "close") {
          log("Tab 关闭: tabID=" + ids[0]);
          triggerWithDebounce("item_close", {
            triggerEvent: "item_close",
            tabId: ids[0],
          });
        }
      } catch (e) {
        warn("tabCallback 异常:", e.message);
      }
    },
  };

  var tabNotifierID = Zotero.Notifier.registerObserver(tabCallback, ["tab"]);
  notifierIDs.push(tabNotifierID);
  log("已注册 tab 事件监听器 (item_open / item_close)");

  // --- 监听 item 事件（文献入库） ---
  var itemCallback = {
    notify: async function (event, type, ids, extraData) {
      try {
        if (type !== "item") return;
        if (event !== "add") return;

        for (var i = 0; i < ids.length; i++) {
          try {
            var itemId = ids[i];
            var item = await Zotero.Items.getAsync(itemId);
            if (!item) continue;
            // 只处理顶层条目（非笔记、非附件）
            if (item.isNote() || item.isAttachment()) continue;
            if (!item.isTopLevelItem()) continue;

            log("条目入库:", item.getField("title"), "(itemID=" + itemId + ")");
            triggerWithDebounce("item_add", {
              item: item,
              triggerEvent: "item_add",
            });
          } catch (ex) {
            warn("处理入库条目失败:", ex.message);
          }
        }
      } catch (e) {
        warn("itemCallback 异常:", e.message);
      }
    },
  };

  var itemNotifierID = Zotero.Notifier.registerObserver(itemCallback, ["item"]);
  notifierIDs.push(itemNotifierID);
  log("已注册 item 事件监听器 (item_add)");
}

function unregisterNotifiers() {
  for (var i = 0; i < notifierIDs.length; i++) {
    Zotero.Notifier.unregisterObserver(notifierIDs[i]);
  }
  notifierIDs = [];
}

// 暴露到全局作用域，供插件 shutdown 时调用
unregisterNotifiers = unregisterNotifiers; // 确保是全局变量
// ========== 启动入口 ==========

async function startup() {
  log("========== Zotero AI Flow 事件监控启动 ==========");

  var eventsCfg = loadTriggerConfig();
  log("脚本目录:", eventsCfg.script_dir || SCRIPT_DIR);
  log("配置文件:", CONFIG_PATH);
  log(
    "触发配置:",
    JSON.stringify(eventsCfg.triggers || DEFAULT_TRIGGER_CONFIG),
  );

  // 1. 注册事件监听
  registerNotifiers();

  // 2. 触发 ui_startup 事件
  triggerWithDebounce("ui_startup", { triggerEvent: "ui_startup" });

  log("========== 事件监控就绪 ==========");
  return "Zotero AI Flow 事件监控已启动";
}

// 执行启动
startup().catch(function (e) {
  warn("启动失败:", e.message);
});
