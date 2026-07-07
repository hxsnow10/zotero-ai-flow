// 以下代码可以在 Zotero-ad hoc js 中运行，用于显示一个对话框并获取用户输入
async function showPromptDialog(promptText = "请输入搜索关键词：") {
  // 确保 Zotero 和其他组件被正确初始化
  if (typeof Zotero === "undefined") {
    Zotero = Components.classes["@zotero.org/Zotero;1"].getService(
      Components.interfaces.nsISupports,
    ).wrappedJSObject;
  }

  // 使用 window.alert 作为备选方案
  try {
    let input = window.prompt(promptText);
    return input || null;
  } catch (error) {
    console.error("对话框显示失败：", error);
    return null;
  }
}

// 执行主函数
//if (typeof window !== 'undefined') {
//    window.setTimeout(main, 1000); // 延迟执行以确保组件加载完成
//}

let re = showPromptDialog();
return re;

async function showMultipleInputDialog() {
  // 确保 Zotero 初始化
  if (typeof Zotero === "undefined") {
    Zotero = Components.classes["@zotero.org/Zotero;1"].getService(
      Components.interfaces.nsISupports,
    ).wrappedJSObject;
  }

  try {
    // 获取提示服务
    let prompts = Components.classes[
      "@mozilla.org/embedcomp/prompt-service;1"
    ].getService(Components.interfaces.nsIPromptService);

    // 准备输入变量
    let searchTerm = { value: "" };
    let question = { value: "" };
    let maxResults = { value: "5" }; // 默认值为5

    // 创建输入字段标签
    let inputLabels = ["搜索关键词:", "问题:", "最大结果数:"];
    let inputFields = [searchTerm, question, maxResults];

    // 显示多输入框对话框
    let result = prompts.promptMulti(
      Zotero.getMainWindow(), // 父窗口
      "文献搜索与分析", // 标题
      "请输入以下信息：", // 提示信息
      inputLabels.length, // 输入框数量
      inputLabels, // 标签数组
      inputFields, // 输入值数组
      null, // 复选框信息（可选）
      {}, // 参数对象
    );

    // 检查用户是否点击了确定
    if (result) {
      return {
        searchTerm: searchTerm.value,
        question: question.value,
        maxResults: parseInt(maxResults.value) || 5,
      };
    }

    return null;
  } catch (error) {
    console.error("显示多输入框对话框失败：", error);
    return null;
  }
}

async function showMultipleInputDialog2() {
  if (typeof Zotero === "undefined") {
    Zotero = Components.classes["@zotero.org/Zotero;1"].getService(
      Components.interfaces.nsISupports,
    ).wrappedJSObject;
  }

  let params = { result: null };

  try {
    // 获取主窗口
    let win = Zotero.getMainWindow();
    if (!win) {
      throw new Error("无法获取 Zotero 主窗口");
    }

    // 打开自定义对话框
    await win.openDialog(
      "data:application/vnd.mozilla.xul+xml;charset=utf-8," +
        encodeURIComponent(`<?xml version="1.0"?>
            <?xml-stylesheet href="chrome://global/skin/" type="text/css"?>
            <dialog id="multiInput" 
                    title="文献搜索与分析"
                    buttons="accept,cancel"
                    width="400"
                    height="300"
                    xmlns="http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul"
                    onload="onLoad();"
                    ondialogaccept="return onAccept();">
                
                <vbox flex="1">
                    <groupbox>
                        <caption label="请输入搜索信息"/>
                        <grid>
                            <columns>
                                <column flex="1"/>
                                <column flex="2"/>
                            </columns>
                            <rows>
                                <row align="center">
                                    <label value="搜索关键词:"/>
                                    <textbox id="searchTerm"/>
                                </row>
                                <row align="center">
                                    <label value="问题:"/>
                                    <textbox id="question" multiline="true" rows="3"/>
                                </row>
                                <row align="center">
                                    <label value="最大结果数:"/>
                                    <textbox id="maxResults" value="5" type="number"/>
                                </row>
                            </rows>
                        </grid>
                    </groupbox>
                </vbox>

                <script>
                    function onLoad() {
                        document.getElementById('searchTerm').focus();
                    }
                    
                    function onAccept() {
                        let params = window.arguments[0];
                        params.result = {
                            searchTerm: document.getElementById('searchTerm').value,
                            question: document.getElementById('question').value,
                            maxResults: parseInt(document.getElementById('maxResults').value) || 5
                        };
                        return true;
                    }
                </script>
            </dialog>`),
      "searchDialog",
      "chrome,dialog,modal,centerscreen,resizable=yes",
      params,
    );

    // 检查结果
    if (!params.result) {
      return {
        success: false,
        error: "用户取消或未输入数据",
      };
    }

    return {
      success: true,
      data: params.result,
    };
  } catch (error) {
    Zotero.debug(`显示对话框失败: ${error.message}`);
    return {
      success: false,
      error: error.message,
    };
  }
}

// 使用示例
async function main() {
  const result = await showMultipleInputDialog2();
  if (result.success) {
    const inputs = result.data;
    window.alert(
      `您输入的内容：\n` +
        `搜索关键词: ${inputs.searchTerm}\n` +
        `问题: ${inputs.question}\n` +
        `最大结果数: ${inputs.maxResults}`,
    );
    return inputs;
  } else {
    Zotero.debug(`错误: ${result.error}`);
    return null;
  }
}

// 执行主函数并返回结果
let result = await main();
return result;
