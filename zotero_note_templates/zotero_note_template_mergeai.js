// @author zhikaiyici,xiahong
// @link [PUBLISH PAGE URL](https://github.com/windingwind/zotero-better-notes/discussions/1202)
// 本script相对于原版，主要考虑合并ai-generate-summary的逻辑
${ await(async() => {
    // 辅助函数：检测字符串是否包含中文字符
    const containsChinese = (text) => /[\u4e00-\u9fa5]/.test(text);

    // 检查标题是否为中文
    let isChineseTitle = containsChinese(topItem.getField("title"));

    let label_color = "#e56eee";
    // 获取作者显示内容
    let creators = topItem.getCreators();
    let authorDisplay = ["", ""];
    if (isChineseTitle) {
        // 中文标题：显示第一作者全名，格式为“姓名”
        if (creators.length > 0) {
            let firstAuthor = creators[0];
            let fullName = firstAuthor.lastName + firstAuthor.firstName;
            if (creators.length > 1) {
                authorDisplay[0] = fullName + "等";
            }
            else {
                authorDisplay[0] = fullName;
            }
            // 正文中显示前10位作者，多于10位加等
            if (creators.length > 10) {
                authorDisplay[1] = creators.splice(0, 10).map((v) => v.firstName + v.lastName).join("; ");
                authorDisplay[1] = authorDisplay + "等";
            }
            else {
                authorDisplay[1] = creators.map((v) => v.firstName + v.lastName).join("; ");
            }
        }
    }
    else {
        // 非中文标题：显示第一作者姓氏并附加“et al.”
        if (creators.length > 0) {
            let firstAuthorLastName = creators[0].lastName;
                if (creators.length > 1) {
                    authorDisplay[0] = `${firstAuthorLastName} et al.`;
                }
                else {
                    authorDisplay[0] = creators[0].lastName + " " + creators[0].firstName;
                }
                // 正文中显示前10位作者，多于10位加et al.
                if (creators.length > 10) {
                    authorDisplay[1] = creators.splice(0, 10).map((v) => v.firstName + " " + v.lastName).join("; ");
                    authorDisplay[1] = authorDisplay[1] + "; et al.";
                }
                else {
                    authorDisplay[1] = creators.map((v) => v.firstName + " " + v.lastName).join("; ");
                }
            }
    }

    const processAnnotations = (grouped, parentLevel) => {
        let result = "";
        let i = 0;
        // 遍历每个组
        for (const label in grouped) {
            if (label != "Unlabeled") {
                i++;
                const group = grouped[label];
                const heading = `<h${group.level}>${label}</h${group.level}>`;
                result += heading; // + "\n";
                // 添加内容
                group.content.forEach(content => {
                    result += content; // + "\n";
                });
                // 递归处理子标签
                result += processAnnotations(group.childLabels, parentLevel + i + ".");
            }
        }
        for (const label in grouped) {
            if (label === "Unlabeled") {
                i++;
                const group = grouped[label];
                const heading = `<h${group.level}>${label}</h${group.level}>`;
                result += heading; // + "\n";
                // 添加内容
                group.content.forEach(content => {
                    result += content; // + "\n";
                });
                break;
            }
        }
        return result;
    }

    function get_label_level(label){

		let count = (label.match(/\./g) || []).length;
        return count+1;
    }

    let myAnnotations = "";
    const attachments = Zotero.Items.get(topItem.getAttachments()).filter((i) => i.isPDFAttachment() || i.isSnapshotAttachment() || i.isEPUBAttachment());
    let annotatedAttachment = 0;
    for (let attachment of attachments) {
        if (attachment.getAnnotations().length > 0)
            annotatedAttachment++; 
    }
	let last_label = "";
	let last_level = 1;
	let label = "";
	let level = 1;
    const groupedAnnotations = {};

    function processHtmlHeader(line){
        let label = "";
        let level = 1;
        let match = line.match(/<h(\d)>(.*)<\/h(\d)>/);
        if (match){
            label = match[1].trim();
            level = parseInt(match[0]);
        }
        return [label, level];
    }
    // 遍历note
    const notes = topItem.getNotes();
    for (let noteid of notes) {
        let note = Zotero.Items.get(noteid);
        const content = note.getNote();
        if (!content.includes("AI Generated Summary")) continue;
        let label = "";
        let level = 1;
        let labelContent = "";
        for (let line of content.split("\n")) {
            if (line.includes("<h")){
                [label, level] = processHtmlHeader(line);

            }
			if (!groupedAnnotations[label]){
                    groupedAnnotations[label] = {
                        level: level,
                        content: [""],
                        childLabels: {}
                    };
                }
            groupedAnnotations[label].content[0] += line+"\n";
        }
    }

    // 遍历pdf类型附件
    for (let attachment of attachments) {
        let annots = attachment.getAnnotations() || "";
        let attachmentTitle = `<i>📄For Document: <a href="zotero://open-pdf/0_${attachment.key}">${attachment.getField("title")}</a></i>`;     
        for (let annoItem of annots) {
            label = last_label;
            level = last_level;
            let myAnnotation = { labels: "", content: "" };
            let myComment = annoItem.annotationComment;
			// if (!annoItem.annotationComment.trim() && !annoItem.annotationText.trim()) continue;
            // get label
            if (annoItem.annotationColor == label_color){
                label = annoItem.annotationText;
                level = get_label_level(label) || level;
				myAnnotation.content = "";
                //myAnnotation.content = "\n------Annotations------:\n";
            } else {
                // get content
                if (["note", "text", "highlight", "underline"].includes(annoItem.annotationType)) {
                    if(["highlight", "underline"].includes(annoItem.annotationType) && myComment){
                        annoItem.annotationComment = "";
					}
					//const res = Zotero.EditorInstanceUtilities.serializeAnnotations([{
                    //    ...(await Zotero.Annotations.toJSON(annoItem)), ...{ attachmentItemID: annoItem.parentID }
                    //}]);
                    if (["note", "text"].includes(annoItem.annotationType)) {
                        //myAnnotation.content += res.html.replace("[" + myAnnotation.labels.join('][') + "]", "");
                    }
                    else {
						if (annoItem.annotationText){
                        	myAnnotation.content += "<blockquote>"+ annoItem.annotationText + "</blockquote>";
                        	// 上面如果使用注释掉的res.html则可以让笔记导向原本地址，但同时也会让笔记变得很大，以及导出后导入不够简单
							myAnnotation.content += "";
						}

                    }
					if (myComment){
                        annoItem.annotationComment = myComment;
                	}
					if (myComment && myAnnotation.content){
						myAnnotation.content += myComment;
					}
                }
                else {
					let html = await Zotero.BetterNotes.api.convert.annotations2html([annoItem], { noteItem: targetNoteItem, ignoreComment: true ,skipCitations : true}) ;
                    //if (["image", "ink"].includes(annoItem.annotationType)) {
					if (html){
						html = html.replace(/<[^>]*span[^>]*>/gi, '');
						html = html.replace(/<[^>]*simg[^>]*>/gi, '');
                    myAnnotation.content += "<blockquote>" + html + "</blockquote>";
                    //}
					if (myComment){
                		annoItem.annotationComment = myComment;
            		}
					if (myComment && myAnnotation.content){
						myAnnotation.content += myComment;
					}
					}
                }

            }
			let currentLevel = groupedAnnotations;
			// 如果当前标签在结果中不存在，则初始化
			if (!currentLevel[label]) {
				currentLevel[label] = {
					level: level+1, // 一级标题为h2，二级标题为h3，依此类推
					content: [],
					childLabels: {} // 存储子标签
				};
				if (annotatedAttachment > 1 && !currentLevel[label].content.includes(attachmentTitle))
					currentLevel[label].content.push(attachmentTitle);
			}
			// 添加内容
            if (myAnnotation.content){
				myAnnotation.content = myAnnotation.content.replace(/<[^>]*span[^>]*>/gi, '');
				myAnnotation.content = myAnnotation.content.replace(/<[^>]*simg[^>]*>/gi, '');
			    currentLevel[label].content.push(myAnnotation.content);
            }
			last_label = label;
			last_level = level;

        }
    }
    myAnnotations += processAnnotations(groupedAnnotations, "") ? processAnnotations(groupedAnnotations, "") : "";

    // 非期刊条目显示论文集、大学、出版社、仓库...
    let otherName = topItem.getField("proceedingsTitle")
        + topItem.getField("university") + topItem.getField("publisher")
        + topItem.getField("repository") + topItem.getField("institution")
        + topItem.getField("meetingName");
    let publicationName = topItem.getField("publicationTitle") + otherName;
    let sourceName = topItem.getField("journalAbbreviation") + otherName;
    let res = `
        <h1> Auto: ${topItem.getField('title')} (${topItem.getField("year")}, ${sourceName}, ${authorDisplay[0]})</h1>
        <!--<hr/>-->
        <p><tr><td>
            Author: ${authorDisplay[1]}
        </td></tr></p>

        <p><tr><td>Source:
            ${(topItem.getField("volume") + topItem.getField("issue") + topItem.getField("pages")) ? 
            (publicationName + " (" + 
            (topItem.getField("volume") ? "volume: " + topItem.getField("volume") + ", " : '') + 
            (topItem.getField("issue") ? "issue: " + topItem.getField("issue") + ", " : '') + 
            (topItem.getField("pages") ? "pages: " + topItem.getField("pages") : '') + ")") : publicationName}
            ${(() => {
                if (Zotero.ZoteroStyle) {
                    let space = " ";
                    return Array.prototype.map.call(
                        Zotero.ZoteroStyle.api.renderCell(topItem, "publicationTags").childNodes,
                        e => {
                            e.innerText = space + e.innerText + space;
                            return e.outerHTML
                        }
                    ).join(space);
                }
            })()}
        </td></tr></p>

        <p><tr><td>
            ${(() => {
                const doi = topItem.getField("DOI");
                if (doi) {
                    return `DOI: </strong>
                    <a href="https://doi.org/${topItem.getField('DOI')}">${topItem.getField('DOI')}</a>`;
                } else {
                    return `URL: </strong> 
                    <a href="${topItem.getField('url')}">${topItem.getField('url')}</a>`;
                }
           })()}
        </td></tr></p>

        <p><tr><td>
            Date:  ${topItem.getField('date')}
        </td></tr></p>

        <!-- 本地链接 -->
        <p><tr><td>
            ${(() => {
                const attachments = Zotero.Items.get(topItem.getAttachments());
                if (attachments && attachments.length > 1) {
                    return `Full Text: 
                    <a href=zotero://open-pdf/0_${Zotero.Items.get(topItem.getAttachments()).filter((i) => i.isPDFAttachment())[0].key}>
                    ${Zotero.Items.get(topItem.getAttachments()).filter((i) => i.isPDFAttachment())[0].getFilename()}</a>`;
                } else {
                    if (attachments && attachments.length > 0) {
                        return `Full Text:  
                        <a href="zotero://open-pdf/0_${attachments[0].key}">${attachments[0].getFilename()}</a>`;
                    }
                    else {
                        return `Full Text: `;
                    }
                }
            })()}
        </td></tr></p>

        <!-- 摘要 -->
        <p><tr><td>
            Abstract:  <i>${topItem.getField('abstractNote')}</i>
        </td></tr></p>
        <!--<hr/>-->

        <!-- 生成标签笔记 -->
        ${myAnnotations}
         <br>
		build from template: [item]标记自动生成的层次笔记模板
    `;
    return res;        
})()}