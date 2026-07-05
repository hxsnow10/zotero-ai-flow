// Default preferences for Zotero AI Flow
pref("extensions.zotero-ai-flow.server.url", "http://127.0.0.1:13210");
pref("extensions.zotero-ai-flow.server.timeout", 30);
pref("extensions.zotero-ai-flow.llm.openaiBaseUrl", "");
pref("extensions.zotero-ai-flow.llm.modelName", "");
pref("extensions.zotero-ai-flow.llm.apiKey", "");
pref("extensions.zotero-ai-flow.llm.temperature", "0.8");
pref("extensions.zotero-ai-flow.summary.chunkSize", 64000);
pref("extensions.zotero-ai-flow.summary.chunkOverlap", 1000);
pref("extensions.zotero-ai-flow.summary.maxChunk", 50);
pref("extensions.zotero-ai-flow.summary.onlyLinkFile", false);
pref(
  "extensions.zotero-ai-flow.summary.supportItemTypes",
  "preprint,journalArticle,magazineArticle,conferencePaper,manuscript,thesis",
);
pref("extensions.zotero-ai-flow.qa.saveCollectionKey", "");
