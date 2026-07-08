const item = Zotero.getActiveZoteroPane().getSelectedItems()[0];
const attachments = item.getAttachments();
let dateModified = null;
for (let attachmentId of attachments) {
  const attachment = await Zotero.Items.getAsync(attachmentId);
  const annotations = attachment.getAnnotations();
  for (let annot of annotations) {
    if (!dateModified || annot.dateModified > dateModified) {
      dateModified = annot.dateModified;
    }
  }
}

annote = {
  key: "C56AZL8M",
  version: 31880,
  itemType: "annotation",
  parentItem: "N2FFBKCU",
  annotationType: "highlight",
  annotationAuthorName: "",
  annotationText: "Abstract",
  annotationComment: "抽象",
  annotationColor: "#e56eee",
  annotationPageLabel: "1",
  annotationSortIndex: "00000|000298|00188",
  annotationPosition:
    '{"pageIndex":0,"rects":[[68.125,596.203,100.573,603.715]]}',
  tags: [],
  relations: {},
  dateAdded: "2025-03-05T09:38:48Z",
  dateModified: "2025-03-05T09:38:49Z",
};
