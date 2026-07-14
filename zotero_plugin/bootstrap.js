/**
 * Zotero AI Flow Plugin - bootstrap.js
 *
 * 插件生命周期入口。
 * Zotero 启动时自动执行 startup()，加载 start_script.js 进行事件监控。
 * Zotero 关闭时执行 shutdown()，清理 Notifier 注册。
 */

const SCRIPT_PATH =
  "/root/autodl-tmp/zotero-ai-flow/zotero_actions/start_script.js";

// install.rdf 打包时写入，不需要实际 filesystem 上的路径
// 如果安装了插件，脚本文件会从 Zotero 的插件目录加载；
// 如果是从本地加载，直接使用绝对路径。

function install() {}

function uninstall() {}

async function startup({ id, version, resourceURI }) {
  Zotero.debug("[zotero-ai-flow] Plugin startup, loading start_script.js...");
  try {
    // 方式 1：通过 mozIJSSubScriptLoader 加载本地文件的 runScript
    // 注意：在 Zotero 6 中，resource 协议不一定能直接访问本地绝对路径
    // 所以直接用 Zotero.File.getContents + eval 来执行
    const fsPath = SCRIPT_PATH.replace("file://", "");
    const exists = await IOUtils.exists(fsPath);
    if (!exists) {
      Zotero.debug(
        "[zotero-ai-flow] WARN: start_script.js not found at " + fsPath,
      );
      return;
    }
    const raw = await IOUtils.read(fsPath);
    const decoder = new TextDecoder("utf-8");
    const code = decoder.decode(raw);
    // 在全局作用域执行
    // eslint-disable-next-line no-eval
    eval(code);
    Zotero.debug("[zotero-ai-flow] Plugin loaded successfully");
  } catch (e) {
    Zotero.debug("[zotero-ai-flow] Plugin startup error: " + e.message);
    Zotero.debug("[zotero-ai-flow] Stack: " + (e.stack || ""));
  }
}

function shutdown() {
  Zotero.debug("[zotero-ai-flow] Plugin shutdown, cleaning up...");
  try {
    // 调用 start_script.js 中暴露的清理函数
    if (typeof unregisterNotifiers === "function") {
      unregisterNotifiers();
    }
  } catch (e) {
    Zotero.debug("[zotero-ai-flow] Shutdown error: " + e.message);
  }
  // 清理自身全局变量
  // start_script.js 中定义的函数通过闭包可能无法直接访问，
  // 但 Notifier 在 Zotero 进程结束时无论如何都会被清理
  Zotero.debug("[zotero-ai-flow] Plugin shutdown complete");
}
