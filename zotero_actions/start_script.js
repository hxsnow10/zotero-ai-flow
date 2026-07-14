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

// Zotero 插件偏好设置前缀（install.rdf 中 em:id 的 @ 替换为 .）
const PREFS_PREFIX = "extensions.zotero-ai-flow.xiahong.me";

/**
 * 从 Zotero 插件偏好（编辑 → 设置 → 插件设置）读取配置值。
 * 若偏好未设置则返回 fallback。
 */
function getPref(key, fallback) {
  try {
    var val = Zotero.Prefs.get(PREFS_PREFIX + "." + key);
    if (val !== undefined && val !== null && val !== "") return val;
  } catch (e) {}
  return fallback;
}

// 兜底路径（Zotero Prefs 和 config.json 均未设置时使用）
const SCRIPT_DIR_FALLBACK = "/home/xiahong/code/zotero-ai-flow/zotero_actions";
const CONFIG_PATH_FALLBACK = "/home/xiahong/code/zotero-ai-flow/config.json";

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

/************* Configurations End *************/

// 暴露清理函数到全局作用域，供插件 bootstrap.js 的 shutdown() 调用
// 当脚本在 Run JavaScript 中手动执行时也会自动启动
var __zaf_unregisterNotifiers;
var __zaf_notifierIDs;

// ========== 工具函数 ==========

function log() {
  if (!getPref("debug", true)) return;
  var msg = "[zotero-ai-flow]";
  for (var i = 0; i < arguments.length; i++) {
    msg += " " + arguments[i];
  }
  Zotero.debug(msg);
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
function _getConfigPath() {
  // 优先级：Zotero Prefs → config.json 的 zotero_events.script_dir → fallback
  var p = getPref("config_path", "");
  if (p) return p;
  // fallback: 尝试从 config.json 读，虽然这是鸡生蛋蛋问题（config 路径本身就在 config 里），
  // 但保留此逻辑以兼容旧版未设置 Prefs 的场景
  return CONFIG_PATH_FALLBACK;
}

function loadTriggerConfig() {
  try {
    var cfgPath = _getConfigPath();
    if (IOUtils.exists(cfgPath)) {
      var raw = Zotero.File.getContents(cfgPath);
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
function _getScriptDir() {
  // 优先级：Zotero Prefs → config.json zotero_events.script_dir → fallback
  var d = getPref("script_dir", "");
  if (d) return d;
  var eventsCfg = loadTriggerConfig();
  if (eventsCfg.script_dir) return eventsCfg.script_dir;
  return SCRIPT_DIR_FALLBACK;
}

async function runScript(scriptName, context) {
  var dir = _getScriptDir();
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
  // --- 手动触发（右键菜单）：直接执行指定脚本，不走 triggers 配置 ---
  if (eventName === "manual" && context.manualScript) {
    log("右键菜单触发:", context.manualScript);
    await runScript(context.manualScript, context);
    return;
  }

  // --- 原有逻辑：从 triggers 配置查找脚本列表 ---
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

// ========== 右键菜单注册 ==========

/**
 * 在 Zotero 条目树的右键菜单中注入「Zotero AI Flow」子菜单。
 * 仅支持 Zotero 7。
 */
function registerContextMenu() {
  var win = Zotero.getMainWindow();
  if (!win) {
    warn("registerContextMenu: 无法获取主窗口，重试中...");
    // Zotero 启动早期可能还没准备好窗口，延迟重试
    setTimeout(function () {
      registerContextMenu();
    }, 3000);
    return;
  }

  var doc = win.document;

  var itemMenu = doc.getElementById("zotero-item-menu");
  if (!itemMenu) {
    warn("registerContextMenu: 未找到条目右键菜单，延迟重试");
    setTimeout(function () {
      registerContextMenu();
    }, 5000);
    return;
  }

  // 防止重复注册
  var existing = doc.getElementById("zaf-context-menu");
  if (existing) {
    existing.parentNode.removeChild(existing);
  }

  // 创建「Zotero AI Flow」子菜单
  var submenu = doc.createElement("menu");
  submenu.setAttribute("label", "Zotero AI Flow");
  submenu.setAttribute("id", "zaf-context-menu");

  var popup = doc.createElement("menupopup");
  submenu.appendChild(popup);

  // 监听弹出，动态填充菜单项
  popup.addEventListener("popupshowing", function () {
    // 清空旧菜单项
    while (popup.firstChild) {
      popup.removeChild(popup.firstChild);
    }

    // 获取当前选中的条目
    var selectedItems = win.ZoteroPane.getSelectedItems();
    var hasItems = selectedItems && selectedItems.length > 0;

    // 从配置中读取手动触发菜单项
    var eventsCfg = loadTriggerConfig();
    var menus = [];
    if (eventsCfg.manual_triggers && eventsCfg.manual_triggers.menus) {
      menus = eventsCfg.manual_triggers.menus;
    }

    if (menus.length === 0) {
      var emptyItem = doc.createElement("menuitem");
      emptyItem.setAttribute("label", "（未配置 manual_triggers）");
      emptyItem.setAttribute("disabled", "true");
      popup.appendChild(emptyItem);
      return;
    }

    // 添加分隔线
    var sep = doc.createElement("menuseparator");
    popup.appendChild(sep);

    for (var i = 0; i < menus.length; i++) {
      var menuDef = menus[i];
      var menuitem = doc.createElement("menuitem");
      menuitem.setAttribute("label", menuDef.label);

      if (!hasItems) {
        menuitem.setAttribute("disabled", "true");
      } else {
        // 闭包捕获菜单项配置
        (function (scriptName, label) {
          menuitem.addEventListener("command", function () {
            var items = win.ZoteroPane.getSelectedItems();
            if (items && items.length > 0) {
              log("右键菜单执行:", label, "(", scriptName, ")");
              triggerScripts("manual", {
                item: items[0],
                items: items,
                triggerEvent: "manual",
                manualScript: scriptName,
              });
            }
          });
        })(menuDef.script, menuDef.label);
      }

      popup.appendChild(menuitem);
    }
  });

  // 插入到条目右键菜单末尾
  itemMenu.appendChild(submenu);
  log("已注册右键菜单: Zotero AI Flow (" + itemMenu.id + ")");
}

// ========== 启动入口 ==========

async function startup() {
  log("========== Zotero AI Flow 事件监控启动 ==========");

  var eventsCfg = loadTriggerConfig();
  log("脚本目录:", _getScriptDir());
  log("配置文件:", _getConfigPath());
  log("debug:", getPref("debug", true));
  log(
    "触发配置:",
    JSON.stringify(eventsCfg.triggers || DEFAULT_TRIGGER_CONFIG),
  );

  // 1. 注册事件监听
  registerNotifiers();

  // 2. 注册右键菜单
  registerContextMenu();

  // 3. 触发 ui_startup 事件
  triggerWithDebounce("ui_startup", { triggerEvent: "ui_startup" });

  log("========== 事件监控就绪 ==========");
  return "Zotero AI Flow 事件监控已启动";
}

// 执行启动
startup().catch(function (e) {
  warn("启动失败:", e.message);
});
