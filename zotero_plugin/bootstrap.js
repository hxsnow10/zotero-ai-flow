/**
 * Zotero AI Flow Plugin - bootstrap.js
 *
 * 插件生命周期入口。
 *
 * 首次启动自动:
 *   1. 在 Zotero 配置目录下创建 zotero-ai-flow/ 工作区
 *   2. 将 XPI 内置 scripts/*.js 解压到工作区
 *   3. 将 XPI 内置 config.json 复制到工作区（仅首次，不覆盖已存在文件）
 *   4. 设置插件偏好: script_dir / config_path / debug
 *
 * 每次启动:
 *   从工作区加载 start_script.js，启动事件监控。
 *
 * 配置修改:
 *   编辑 -> 设置 -> 插件设置 -> Zotero AI Flow
 *   或 about:config -> extensions.zotero-ai-flow.xiahong.me
 */

const PREFS_PREFIX = "extensions.zotero-ai-flow.xiahong.me";
const EXT_ID = "zotero-ai-flow@xiahong.me";

// ====================== 工具函数 ======================

/** 获取 Zotero 配置文件根目录 */
function getProfileDir() {
  try {
    return Components.classes["@mozilla.org/file/directory_service;1"]
      .getService(Components.interfaces.nsIProperties)
      .get("ProfD", Components.interfaces.nsIFile).path;
  } catch (e) {
    return Zotero.getProfileDirectory();
  }
}

/** 获取 XPI 解压后的根目录 */
function getExtensionRoot() {
  try {
    var profD = Components.classes["@mozilla.org/file/directory_service;1"]
      .getService(Components.interfaces.nsIProperties)
      .get("ProfD", Components.interfaces.nsIFile);
    var extDir = profD.clone();
    extDir.append("extensions");
    extDir.append(EXT_ID);
    if (extDir.exists() && extDir.isDirectory()) {
      return extDir.path;
    }
  } catch (e) {}
  return null;
}

/**
 * 将 XPI 内置文件复制到工作区。
 * 脚本始终覆盖（保证最新），config.json 仅首次创建。
 */
async function extractBundledFiles(extRoot, workspaceDir) {
  var { IOUtils } = ChromeUtils.import("resource:///modules/IOUtils.jsm");

  await IOUtils.makeDirectory(workspaceDir, { createAncestors: true });

  // 1. 复制所有脚本（始终覆盖）
  var scriptsDir = extRoot + "/scripts";
  if (await IOUtils.exists(scriptsDir)) {
    var entries = await IOUtils.getChildren(scriptsDir);
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      var name = entry.split("/").pop();
      if (name.endsWith(".js")) {
        try {
          await IOUtils.copy(entry, workspaceDir + "/" + name);
          Zotero.debug("[zotero-ai-flow] copy: " + name);
        } catch (e) {
          Zotero.debug("[zotero-ai-flow] copy fail: " + name + " " + e.message);
        }
      }
    }
  }

  // 2. config.json：仅目标不存在时复制
  var srcCfg = extRoot + "/config.json";
  var dstCfg = workspaceDir + "/config.json";
  if (await IOUtils.exists(srcCfg)) {
    if (!(await IOUtils.exists(dstCfg))) {
      try {
        await IOUtils.copy(srcCfg, dstCfg);
        Zotero.debug("[zotero-ai-flow] created config.json (first time)");
      } catch (e) {
        Zotero.debug("[zotero-ai-flow] config.json fail: " + e.message);
      }
    } else {
      Zotero.debug("[zotero-ai-flow] config.json exists, skip overwrite");
    }
  }
}

/** 确保插件偏好正确指向工作区 */
function ensurePrefs(workspaceDir) {
  Zotero.Prefs.set(PREFS_PREFIX + ".script_dir", workspaceDir);
  Zotero.Prefs.set(
    PREFS_PREFIX + ".config_path",
    workspaceDir + "/config.json",
  );
  Zotero.debug("[zotero-ai-flow] prefs set: script_dir=" + workspaceDir);
}

/** 从 Prefs 读取脚本目录（带 fallback） */
function getScriptDir() {
  try {
    var d = Zotero.Prefs.get(PREFS_PREFIX + ".script_dir");
    if (d) return d;
  } catch (e) {}
  return getProfileDir() + "/zotero-ai-flow";
}

// ====================== 生命周期 ======================

function install() {
  Zotero.debug("[zotero-ai-flow] installed");
}

function uninstall() {
  Zotero.debug("[zotero-ai-flow] uninstalled");
}

async function startup() {
  Zotero.debug("[zotero-ai-flow] === startup ===");
  try {
    var workspaceDir = getProfileDir() + "/zotero-ai-flow";

    // 从 XPI 提取内置文件
    var extRoot = getExtensionRoot();
    if (extRoot) {
      await extractBundledFiles(extRoot, workspaceDir);
    } else {
      Zotero.debug(
        "[zotero-ai-flow] WARN: ext root not found, using existing workspace",
      );
    }

    // 确保偏好设置
    ensurePrefs(workspaceDir);

    // 加载 start_script.js
    var scriptPath = workspaceDir + "/start_script.js";
    var { IOUtils } = ChromeUtils.import("resource:///modules/IOUtils.jsm");
    if (!(await IOUtils.exists(scriptPath))) {
      Zotero.debug("[zotero-ai-flow] ERROR: not found: " + scriptPath);
      return;
    }

    var raw = await IOUtils.read(scriptPath);
    var code = new TextDecoder("utf-8").decode(raw);
    eval(code);
    Zotero.debug("[zotero-ai-flow] === loaded ===");
  } catch (e) {
    Zotero.debug("[zotero-ai-flow] startup error: " + e.message);
    Zotero.debug("[zotero-ai-flow] " + (e.stack || ""));
  }
}

function shutdown() {
  Zotero.debug("[zotero-ai-flow] shutdown...");
  try {
    if (typeof unregisterNotifiers === "function") {
      unregisterNotifiers();
    }
  } catch (e) {
    Zotero.debug("[zotero-ai-flow] shutdown error: " + e.message);
  }
  Zotero.debug("[zotero-ai-flow] shutdown done");
}
