"use strict";

var ZoteroAIFlow;

function startup({ id, version, rootURI } = {}) {
  Services.scriptloader.loadSubScript(rootURI + "content/ai_flow.js");
  ZoteroAIFlow.startup({ id, version, rootURI });
}

function shutdown() {
  if (typeof ZoteroAIFlow !== "undefined") {
    ZoteroAIFlow.shutdown();
    ZoteroAIFlow = undefined;
  }
}

function install({ version } = {}) {
  Zotero.debug("[ZoteroAIFlow] Installed v" + version);
}

function uninstall({ version } = {}) {
  Zotero.debug("[ZoteroAIFlow] Uninstalled v" + version);
}
