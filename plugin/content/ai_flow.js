"use strict";

/**
 * Main plugin object for Zotero AI Flow.
 * Handles preferences, menu registration, and AI operations.
 */
var ZoteroAIFlow = {
  rootURI: null,
  version: null,
  id: null,
  _addedElementIDs: [],

  PREF_PREFIX: "extensions.zotero-ai-flow.",

  getPref(key, defaultValue) {
    try {
      const val = Zotero.Prefs.get(this.PREF_PREFIX + key, true);
      return val !== undefined ? val : defaultValue;
    } catch (e) {
      return defaultValue;
    }
  },

  getConfig() {
    return {
      server: {
        url: this.getPref("server.url", "http://127.0.0.1:13210"),
        timeout: this.getPref("server.timeout", 30),
      },
      llm: {
        openaiBaseUrl: this.getPref("llm.openaiBaseUrl", ""),
        modelName: this.getPref("llm.modelName", ""),
        apiKey: this.getPref("llm.apiKey", ""),
        temperature: parseFloat(this.getPref("llm.temperature", "0.8")),
      },
      summary: {
        chunkSize: this.getPref("summary.chunkSize", 64000),
        chunkOverlap: this.getPref("summary.chunkOverlap", 1000),
        maxChunk: this.getPref("summary.maxChunk", 50),
        only_link_file: this.getPref("summary.onlyLinkFile", false),
        support_item_types: this.getPref(
          "summary.supportItemTypes",
          "preprint,journalArticle,magazineArticle,conferencePaper,manuscript,thesis",
        )
          .split(",")
          .map((s) => s.trim()),
      },
      qa: {
        saveColelctionKey: this.getPref("qa.saveCollectionKey", ""),
      },
    };
  },

  async loadPrompt(name) {
    const url = this.rootURI + "content/prompts/" + name + "_prompt.txt";
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`加载 Prompt '${name}' 失败: HTTP ${response.status}`);
    }
    return response.text();
  },

  startup({ id, version, rootURI }) {
    this.id = id;
    this.version = version;
    this.rootURI = rootURI;
    this._log("Startup v" + version);

    this._registerPrefs();

    Zotero.uiReadyPromise.then(() => {
      this._addMenuItems();
    });
  },

  shutdown() {
    this._log("Shutdown");
    const win = Zotero.getMainWindow();
    for (const elId of this._addedElementIDs) {
      win?.document?.getElementById(elId)?.remove();
    }
    this._addedElementIDs = [];
  },

  _log(msg) {
    Zotero.debug("[ZoteroAIFlow] " + msg);
  },

  _registerPrefs() {
    Zotero.PreferencePanes.register({
      pluginID: this.id,
      src: this.rootURI + "content/prefs.html",
      label: "Zotero AI Flow",
    });
  },

  _addMenuItems() {
    const win = Zotero.getMainWindow();
    if (!win?.document) return;

    const doc = win.document;
    const menu = doc.getElementById("zotero-itemmenu");
    if (!menu) return;

    const separator = doc.createXULElement("menuseparator");
    separator.id = "zotero-ai-flow-separator";
    menu.appendChild(separator);
    this._addedElementIDs.push(separator.id);

    const items = [
      {
        id: "zotero-ai-flow-cmd-summary",
        label: "AI 论文摘要 (AI Summary)",
        fn: () => this.cmdSummary(),
      },
      {
        id: "zotero-ai-flow-cmd-qa",
        label: "AI 问答 (AI Q&A)",
        fn: () => this.cmdQA(),
      },
      {
        id: "zotero-ai-flow-cmd-export",
        label: "导出笔记 (Export Notes)",
        fn: () => this.cmdExportNote(),
      },
    ];

    for (const { id, label, fn } of items) {
      const el = doc.createXULElement("menuitem");
      el.id = id;
      el.setAttribute("label", label);
      el.addEventListener("command", fn);
      menu.appendChild(el);
      this._addedElementIDs.push(id);
    }
  },

  // ─── Commands ─────────────────────────────────────────────────────────────

  async cmdSummary() {
    const items = Zotero.getMainWindow().ZoteroPane.getSelectedItems();
    if (!items?.length) {
      this._alert("请先选择要处理的文献。");
      return;
    }

    const config = this.getConfig();
    if (!config.llm.openaiBaseUrl || !config.llm.apiKey) {
      this._alert("请先在「偏好设置 → Zotero AI Flow」中填写 LLM API 配置。");
      return;
    }

    let prompts;
    try {
      const [stuffPrompt, mapPrompt, reducePrompt] = await Promise.all([
        this.loadPrompt("stuff"),
        this.loadPrompt("map"),
        this.loadPrompt("reduce"),
      ]);
      prompts = { stuffPrompt, mapPrompt, reducePrompt };
    } catch (e) {
      this._alert("加载 Prompt 失败：" + e.message);
      return;
    }

    await this._processSelectedItems(items, config, prompts);
  },

  async cmdQA() {
    this._alert(
      "AI 问答功能即将推出，敬请期待！\n\n当前可继续使用 zotero_qa.js 脚本。",
    );
  },

  async cmdExportNote() {
    this._alert(
      "笔记导出功能即将推出，敬请期待！\n\n当前可继续使用 zotero_export_note.js 脚本。",
    );
  },

  _alert(msg) {
    Zotero.alert(Zotero.getMainWindow(), "Zotero AI Flow", msg);
  },

  // ─── PDF Summary Logic ────────────────────────────────────────────────────

  async _processSelectedItems(items, config, prompts) {
    await Promise.all(
      items.map((item) => this._generateSummary(item, config, prompts)),
    );
  },

  async _generateSummary(
    item,
    config,
    { stuffPrompt, mapPrompt, reducePrompt },
  ) {
    const progressWindow = new Zotero.ProgressWindow({ closeOnClick: false });
    progressWindow.addDescription(item.getField("title"));
    const itemProgress = new progressWindow.ItemProgress();
    itemProgress.setItemTypeAndIcon("note");

    try {
      if (!item.isRegularItem() || !item.isTopLevelItem()) {
        progressWindow.startCloseTimer();
        return;
      }

      const itemType = item.itemType;
      if (!config.summary.support_item_types.includes(itemType)) {
        progressWindow.startCloseTimer();
        return;
      }

      // Skip if summary already exists
      for (const noteId of item.getNotes()) {
        const note = Zotero.Items.get(noteId);
        if (note.getNote().includes("<h2>AI Generated Summary")) {
          itemProgress.setProgress(100);
          itemProgress.setText("摘要已存在，跳过。");
          progressWindow.startCloseTimer(2000);
          return;
        }
      }

      // Wait for PDF attachment
      let pdfAttachment = await item.getBestAttachment();
      for (
        let i = 0;
        i < config.server.timeout &&
        !this._checkAttachment(pdfAttachment, config);
        i++
      ) {
        await new Promise((r) => setTimeout(r, 1000));
        pdfAttachment = await item.getBestAttachment();
      }
      if (!this._checkAttachment(pdfAttachment, config)) {
        itemProgress.setText("未找到 PDF 附件。");
        progressWindow.startCloseTimer(3000);
        return;
      }

      itemProgress.setText("正在获取 PDF...");
      progressWindow.show();

      const title = item.getField("title");
      const link = item.getField("url") || "";
      const pdfPath = await pdfAttachment.getFilePath();
      let fileData = await IOUtils.read(pdfPath);
      if (fileData instanceof ArrayBuffer) fileData = new Uint8Array(fileData);

      itemProgress.setProgress(20);
      itemProgress.setText("正在解析 PDF...");

      let serverUrl = config.server.url;
      if (serverUrl.endsWith("/")) serverUrl = serverUrl.slice(0, -1);

      const win = Zotero.getMainWindow();
      const formData = new win.FormData();
      formData.append("title", title);
      formData.append("link", link);
      formData.append("chunk_size", config.summary.chunkSize);
      formData.append("chunk_overlap", config.summary.chunkOverlap);
      formData.append(
        "pdf",
        new Blob([fileData], { type: "application/pdf" }),
        pdfPath.replace(/^.*[\\/]/, ""),
      );

      const parseResp = await fetch(`${serverUrl}/parse_pdf`, {
        method: "POST",
        body: formData,
      });
      if (!parseResp.ok) {
        throw new Error(
          `解析服务错误: ${parseResp.status} ${parseResp.statusText}`,
        );
      }
      const { splits } = await parseResp.json();

      itemProgress.setProgress(40);
      itemProgress.setText("正在生成摘要...");

      const markdownSummary = await this._summarizeText(title, splits, config, {
        stuffPrompt,
        mapPrompt,
        reducePrompt,
      });
      if (!markdownSummary) {
        itemProgress.setText("分片过多，已跳过摘要生成。");
        progressWindow.startCloseTimer(5000);
        return;
      }

      itemProgress.setProgress(80);
      itemProgress.setText("正在转换 Markdown 为 HTML...");

      const htmlFormData = new win.FormData();
      htmlFormData.append("title", title);
      htmlFormData.append("markdown", markdownSummary);
      htmlFormData.append("model_name", config.llm.modelName);

      const htmlResp = await fetch(`${serverUrl}/md_to_html`, {
        method: "POST",
        body: htmlFormData,
      });
      if (!htmlResp.ok) {
        throw new Error(
          `HTML 转换错误: ${htmlResp.status} ${htmlResp.statusText}`,
        );
      }
      const { html } = await htmlResp.json();

      const newNote = new Zotero.Item("note");
      newNote.setNote(
        `<h2>AI Generated Summary (${config.llm.modelName})</h2>${html}`,
      );
      newNote.parentID = item.id;
      await newNote.saveTx();

      itemProgress.setProgress(100);
      itemProgress.setText("摘要生成成功！");
      progressWindow.startCloseTimer(5000);
    } catch (error) {
      this._log("Error in _generateSummary: " + error.message);
      itemProgress.setError();
      itemProgress.setText("错误：" + error.message);
      progressWindow.startCloseTimer(8000);
    }
  },

  _checkAttachment(attachment, config) {
    return (
      attachment &&
      (!config.summary.only_link_file ||
        attachment.attachmentLinkMode ===
          Zotero.Attachments.LINK_MODE_LINKED_FILE)
    );
  },

  _formatString(str, params) {
    return str.replace(/{([^{}]*)}/g, (_, key) => params[key] ?? "");
  },

  async _openaiRequest(message, config) {
    let baseUrl = config.llm.openaiBaseUrl;
    if (baseUrl.endsWith("/")) baseUrl = baseUrl.slice(0, -1);

    const resp = await fetch(`${baseUrl}/chat/completions`, {
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
    if (!resp.ok) {
      throw new Error(`LLM API 错误: ${resp.status} ${resp.statusText}`);
    }
    const result = await resp.json();
    if (!result.choices) throw new Error("LLM API 未返回有效结果。");
    return result.choices[0].message.content;
  },

  async _summarizeText(
    title,
    splits,
    config,
    { stuffPrompt, mapPrompt, reducePrompt },
  ) {
    if (splits.length === 1) {
      return this._openaiRequest(
        this._formatString(stuffPrompt, { title, text: splits[0].content }),
        config,
      );
    }
    if (splits.length >= config.summary.maxChunk) return null;

    const summaries = await Promise.all(
      splits.map((split) =>
        this._openaiRequest(
          this._formatString(mapPrompt, { title, text: split.content }),
          config,
        ),
      ),
    );
    return this._openaiRequest(
      this._formatString(reducePrompt, { title, text: summaries.join("\n\n") }),
      config,
    );
  },
};
