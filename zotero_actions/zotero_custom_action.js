// 路由， 每个触发点配置 动作脚本路径list
// 有没有可能直接绕过zotero-actions

// A&T 路由执行脚本
if (!item) return "No item selected";

// 引入你的外部真实业务脚本 (假设存放于特定目录或通过网络请求获取)
var scriptUrl = "file:///C:/Users/YourName/ZoteroScripts/my_real_script.js";
var request = new XMLHttpRequest();
request.open('GET', scriptUrl, false);
request.send(null);

if (request.status === 200) {
    // 执行读取到的外部代码
    eval(request.responseText);
}
