/**
 * Generate summary of multi item using LLM
 * @author xiahong xiahahaha01@gmail.com
 * @usage https://github.com/hxsnow10/zotero-ai-summary
 */

// action-tags 在选中多个（包括一个的情况）下会先对[items=xxx,item=null]执行一次action
// 然后依次对[items=null, item=xxx]执行action
// 为了避免重复执行；而且我这个逻辑与items无关的。
// 不管是否有items被选中，都会出现且只出现一次item=null的情况，只有这时候才执行action

if (item!=null) return;

/************* Configurations Start *************/
let dirname = "/home/xiahong/code/zotero-ai-summary";

async function load_file(pname) {
    try {
        let path = dirname + "/" + pname;
        // 使用 IOUtils 读取文件内容
        let content = await IOUtils.read(path);
        
        // 使用 TextDecoder 处理 Unicode 字符
        const decoder = new TextDecoder('utf-8');
        return decoder.decode(content);
    } catch (error) {
        throw new Error(`读取文件失败 ${pname}: ${error.message}`);
    }
}

let fileContent = await load_file("config.json");
const config = JSON.parse(fileContent);

let window = require("window");
// 确保全局变量的声明
if (typeof window === 'undefined') {
    window = Zotero.getMainWindow();
}
let console = require("console");

// load prompt 
function load_prompt(pname){
    pname = "prompt/"+pname+"_prompt.txt";
    return load_file(pname);
}


// merge prompt
let qa_prompt = await load_prompt("qa");

/************* Configurations End *************/

/* 核心逻辑
1、获得问题、搜索关键词、最大结果数
2、搜索文献
3、考虑是否需要对单个文献生成摘要
4、根据问题类型与具体问题 决定prompt ，合并输入，交互LLM
5、保存结果
*/
class ZoteroLLMQA{
    constructor() {
        this.progressWindow = null;
        this.itemProgress = null;
        this.count = 0;
    }

    setProcess(percent, text) {
        this.itemProgress.setProgress(percent);
        this.itemProgress.setText(text);
    }

    // 主处理函数
    async getQuestionAnswer() {
        try {
            // 初始化进度窗口
            this.initProgressWindow();
            this.count+=1
            this.setProcess(0, `获取问题...${this.count}`);

            // 获取用户输入
            let query = await getQuestion();
            if (!query) {
                throw new Error("未输入问题");
            }

            this.setProcess(10, "搜索相关论文...");
            // 搜索文献
            let  items = await searchQuery(query);
            items = items.slice(0, 20);

            this.setProcess(30, "生成prompt...");
            // 根据问题类型与具体问题 决定prompt ，合并LLM输入
            const llmPrompt = await this.getPrompt(query, items);

            this.setProcess(40, "询问LLM...");
            // 生成结果
            const llmResult = await this.generateLLMResult(llmPrompt);
            
            this.setProcess(80, "保存结果...");
            // 保存结果
            await this.saveResult(query, items, llmResult);

            this.itemProgress.setProgress(100);
            this.itemProgress.setText("问答完成！");
            this.progressWindow.startCloseTimer(3000);

        } catch (error) {
            this.itemProgress.setError();
            this.itemProgress.setText(`错误: ${error.message}`);
            this.progressWindow.startCloseTimer(5000);
            throw error;
        }
    }

    // 初始化进度窗口
    initProgressWindow() {
        this.progressWindow = new Zotero.ProgressWindow({ 
            closeOnClick: false 
        });
        // this.progressWindow.addDescription(`正在处理 ${itemCount} 篇文献`);
        this.itemProgress = new this.progressWindow.ItemProgress();
        this.itemProgress.setItemTypeAndIcon("note");
        this.progressWindow.show();
    }



    // 生成prompt
    async getPrompt(query, items) {
        function getItemString(item){
            if (!item || !item.isRegularItem() || !item.isTopLevelItem()) {
                return "";
            }
            let title = item.getField('title');
            let abstract = item.getField('abstractNote');
            let year = item.getField('year');
            let name = item.getCreators()[0]?.lastName || '';
            let aiSummary = "";
            try{
                let notes = item.getNotes();
                for (const noteId of notes) {
                    const note = Zotero.Items.get(noteId);
                    const noteContent = note.getNote();
                    if (note.getNote().includes("AI Generated Summary")) {
                        aiSummary = noteContent;
                    }
                }
            }catch(e){
                console.error(e);
            }
            return `
            [title]:${title}\n
            [name]:${name}\n
            [abstarct]:${abstract}\n
            [year]:${year}\n
            [ai_note_abstract]:${aiSummary}`;
        }
        let papersSummary = items.map(item => getItemString(item)).join("\n\n");
        return formatString(qa_prompt, {
            "question": query, 
            "papers_summary": papersSummary
        });
    }

    // 获取现有摘要
    async getExistingSummary(item) {
        const noteIds = item.getNotes();
        for (const id of noteIds) {
            const note = Zotero.Items.get(id);
            const content = note.getNote();
            if (content.includes("<h2>AI Generated Summary")) {
                // 提取摘要内容
                const div = document.createElement('div');
                div.innerHTML = content;
                const summaryContent = div.querySelector('.summary-content');
                return summaryContent ? summaryContent.innerHTML : null;
            }
        }
        return null;
    }

    // 
    async generateLLMResult(message) {
        const response = await openaiRequest(
            message
        );
        return response;
    }

    // 保存结果
    async saveResult(query, items, result) {
        this.itemProgress.setText("保存结果...");
        this.itemProgress.setProgress(90);

        const newNote = new Zotero.Item(`note`);
        let resulthtml = await markdownToHtml(result);
        const html = `
            <h1>QA LLM: ${query} (${config.llm.modelName})</h1>
            <div class="papers-info">
                <p>包含文献数: ${items.length}</p>
                <p>生成时间: ${new Date().toLocaleString()}</p>
            </div>
            <div class="merged-summary">
                ${resulthtml}
            </div>
        `;
        // TODO: 增加耗时信息

        newNote.setNote(html);
        await newNote.saveTx();

        // 添加到集合
        const collectionKey = config.qa.saveCollectionKey; 
        const collection = Zotero.Collections.getByLibraryAndKey(
            Zotero.Libraries.userLibraryID,
            collectionKey
        );
        if (collection) {

            await Zotero.DB.executeTransaction(async () => {
                try {
                    
                    // 确保笔记存在且已保存
                    const noteExists = await Zotero.Items.get(newNote.id);
                    if (!noteExists) {
                        throw new Error("笔记不存在或未正确保存");
                    }

                    // 添加到集合
                    collection.addItem(newNote.id);
                    await collection.saveTx();
                    // 似乎这个wait还是异步的，后面还是检测不到 虽然成功了
                } catch (e) {
                    Zotero.debug(`添加到集合失败: ${e.message}`);
                    throw e;
                }
            });
        }
    }
}

function formatString(str, params) {
    return str.replace(/{([^{}]*)}/g, (match, key) => {
        return params[key] || match;
    });
}

// 基本搜索示例
async function searchQuery(searchQuery) {
    // 创建搜索对象

    // 获取 ZoteroPane
    const ZoteroPane = Zotero.getMainWindow().ZoteroPane;
    if (!ZoteroPane) {
        throw new Error("无法获取 ZoteroPane");
    }
    const s = new Zotero.Search();

    // 设置搜索范围（当前选中的库）
    s.addCondition('libraryID', 'is', ZoteroPane.getSelectedLibraryID());
    
    // 添加搜索条件
    s.addCondition('quicksearch-fields', 'contains', searchQuery);
    
    // 执行搜索（返回 Promise）
    const ids = await s.search();
    
    // 获取搜索结果项目
    const items = await Zotero.Items.getAsync(ids);
    
    return items;
}

// 获取用户输入
async function getQuestion() {
    let searchTerm = window.prompt("输入问题");
    return searchTerm;
}

async function openaiRequest(message) {
    const response = await fetch(`${config.llm.openaiBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${config.llm.apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: config.llm.modelName,
            messages: [{
                role: 'user',
                content: message
            }],
            temperature: config.llm.temperature
        })
    });
    if (!response.ok) {
        let message = undefined;
        try {
            const data = await response.json();
            message = data.detail || data.error?.message;
        } catch (error) {}
        throw new Error(`${config.llm.openaiBaseUrl} HTTP Error: ${response.status} ${response.statusText}${message ? ` - ${message}` : ''}`);
    }

    let result;
    try {
        result = await response.json();
    } catch (error) {
        throw new Error(`Error when parsing json of ${config.llm.openaiBaseUrl}/chat/completions: ${error.message}`);
    }
    if (!result.choices) {
        throw new Error("LLM API call failed!");
    }
    return result.choices[0].message.content;
}

async function markdownToHtml(markdown) {
    const htmlFormData = new window.FormData();
    htmlFormData.append('title', "");
    htmlFormData.append('markdown', markdown);
    htmlFormData.append('model_name', config.llm.modelName);

    const htmlResponse = await fetch(`${config.server.url}/md_to_html`, {
        method: "POST",
        body: htmlFormData
    });
    if (!htmlResponse.ok) {
        let message = undefined;
        try {
            const data = await htmlResponse.json();
            message = data.detail || data.error?.message;
        } catch (error) {}
        throw new Error(`${config.server.url} HTTP Error: ${htmlResponse.status} ${htmlResponse.statusText}${message ? ` - ${message}` : ''}`);
    }
    let htmlResult;
    try {
        htmlResult = await htmlResponse.json();
    } catch (error) {
        throw new Error(`Error when parsing json of ${config.server.url}/md_to_html: ${error.message}`);
    }
    return htmlResult.html;
}

// 仅在item=null的情况下执行，避免重复执行
if (item==null){
    const LLMQA = new ZoteroLLMQA();
    return await LLMQA.getQuestionAnswer();
}