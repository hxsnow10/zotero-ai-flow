// 配置对象
const config = {
  openaiBaseUrl: "https://api.openai.com/v1",
  modelName: "gpt-3.5-turbo",
  apiKey: process.env.OPENAI_API_KEY || "", // 从环境变量获取
  maxResults: 10, // 限制搜索结果数量
  temperature: 0.7,
};

// 验证配置
function validateConfig() {
  if (!config.apiKey) {
    throw new Error("未设置 API Key");
  }
  if (!config.openaiBaseUrl) {
    throw new Error("未设置 API URL");
  }
}

// 搜索文献
async function searchZotero(searchQuery) {
  const s = new Zotero.Search();
  s.addCondition("libraryID", "is", ZoteroPane.getSelectedLibraryID());
  s.addCondition("quicksearch-fields", "contains", searchQuery);
  // 增加全文搜索片段匹配  来解决细节问题
  // 增加notes作为输入

  const ids = await s.search();
  const items = await Zotero.Items.getAsync(ids);
  return items.slice(0, config.maxResults);
}

// 构建文献上下文
function buildContext(items) {
  return items
    .map((item) => {
      const title = item.getField("title");
      const creators = item
        .getCreators()
        .map((c) => c.firstName + " " + c.lastName)
        .join(", ");
      const year = item.getField("year");
      const abstract = item.getField("abstractNote");
      // 增加notes作为输入
      // const notes = item.getField('notes');

      return `标题: ${title}
作者: ${creators}
年份: ${year}
摘要: ${abstract}`;
    })
    .join("\n\n");
}

async function chatWithLLM(searchResults, query) {
  validateConfig();

  const context = buildContext(searchResults);
  const prompt = `基于以下Zotero文献信息回答问题:

${context}

用户问题: ${query}

请根据以上文献信息,简明扼要地回答问题。如果信息不足，请明确指出。`;

  try {
    const response = await fetch(`${config.openaiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.modelName,
        messages: [
          {
            role: "system",
            content: "你是一个学术助手，帮助用户理解和分析文献。",
          },
          { role: "user", content: prompt },
        ],
        temperature: config.temperature,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(
        `API请求失败: ${response.status} - ${errorData.error?.message || ""}`,
      );
    }

    const result = await response.json();
    return result.choices[0].message.content;
  } catch (error) {
    console.error("LLM交互错误:", error);
    throw error;
  }
}

async function searchAndChat(searchQuery, chatQuery) {
  try {
    // 搜索文献
    const items = await searchZotero(searchQuery);
    if (items.length === 0) {
      throw new Error("未找到相关文献");
    }

    // 与LLM对话
    const answer = await chatWithLLM(items, chatQuery);

    // 创建笔记保存结果
    const newNote = new Zotero.Item("note");
    newNote.setNote(`
<h1>文献问答</h1>
<p><strong>搜索关键词:</strong> ${searchQuery}</p>
<p><strong>问题:</strong> ${chatQuery}</p>
<p><strong>检索到的文献数:</strong> ${items.length}</p>
<p><strong>回答:</strong></p>
${answer}`);

    newNote.parentID = items[0].id;
    await newNote.saveTx();

    return {
      success: true,
      answer,
      itemCount: items.length,
    };
  } catch (error) {
    console.error("执行失败:", error);
    return {
      success: false,
      error: error.message,
    };
  }
}

// 导出函数
module.exports = {
  searchAndChat,
  config,
};

// 设置配置
config.apiKey = "your-api-key";

// 使用
const result = await searchAndChat("机器学习", "这些文献主要研究了哪些问题？");
if (result.success) {
  console.log(result.answer);
} else {
  console.error(result.error);
}
