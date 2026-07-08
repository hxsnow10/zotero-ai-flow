// 基本搜索示例
async function searchItems(searchQuery) {
  // 创建搜索对象
  const s = new Zotero.Search();

  // 设置搜索范围（当前选中的库）
  s.addCondition("libraryID", "is", ZoteroPane.getSelectedLibraryID());

  // 添加搜索条件
  s.addCondition("quicksearch-fields", "contains", searchQuery);

  // 执行搜索（返回 Promise）
  const ids = await s.search();

  // 获取搜索结果项目
  const items = await Zotero.Items.getAsync(ids);

  // 打印结果
  for (const item of items) {
    console.log(`标题: ${item.getField("title")}`);
    console.log(
      `作者: ${item
        .getCreators()
        .map((c) => c.firstName + " " + c.lastName)
        .join(", ")}`,
    );
    console.log(`年份: ${item.getField("year")}`);
    console.log("---");
  }
  return items;
}

// 使用示例
let items = await searchItems("deepseek");

// zotero测试过可行
