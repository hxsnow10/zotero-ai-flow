
Automatically summarize academic papers and generate notes in Zotero using an LLM.

Workflow:When a new paper is added to Zotero, the zotero-actions-tags plugin triggers a JavaScript script to retrieve the PDF file path and paper title. It then sends the PDF to a server for analysis and segmentation. Next, the local system calls the LLM API to generate a summary of the paper. Once the summary is obtained, the generated markdown is sent to the server to be converted into HTML. Finally, the HTML summary is written into the paper's note.

Answer user questions using an LLM in Zotero.

When a user asks a question, the zotero-actions-tags plugin triggers the script. script searchs for relevant items in the Zotero library based on the question. The script then combines the information from the items (title, abstract, AI summary) with the prompt and sends it to the LLM server, retrieves the LLM answer, and writes it to the note.
TLDR: If you use [ZotMoov](https://github.com/wileyyugioh/zotmoov) or [ZotFile](https://github.com/jlegewie/zotfile) to save your papers on OneDrive or other synchronized drives, set `only_link_file` to `true`; configure `openaiBaseUrl`, `modelName`, and `apiKey` according to the LLM API you intend to use; adjust `chunkSize` to match the model's context length; translate `stuffPrompt`, `mapPrompt`, and `reducePrompt` into your preferred language, ensuring that the placeholders `{title}` and `{text}` remain unchanged.

- **`serverUrl`**: The server URL for parsing PDF files and converting the summarized markdown into HTML. Defaults to the author's public server. **If you need to summarize sensitive files, it's recommended to deploy your own server**; simply clone this repository and run `python server.py`.
- **`only_link_file`**: Use this in conjunction with [ZotMoov](https://github.com/wileyyugioh/zotmoov) or [ZotFile](https://github.com/jlegewie/zotfile). If you save PDF papers in Zotero as "Link to File" using these (or similar) plugins, set `only_link_file` to `true`; otherwise, set it to `false`.
- **`timeout`**: Also used with [ZotMoov](https://github.com/wileyyugioh/zotmoov) or [ZotFile](https://github.com/jlegewie/zotfile). This parameter specifies the maximum number of seconds to wait after adding a new paper before checking whether the PDF download is complete.
- **`openaiBaseUrl`**: The API endpoint compatible with OpenAI. The specific URL depends on the model provider you are using; by default, it is Qwen, see <https://www.aliyun.com/product/bailian>.
- **`modelName`**: The model name provided when calling the API.
- **`apiKey`**: The API key for the LLM.
- **`chunkSize`**: The model's context size. PDF documents that exceed the context window must be split into multiple segments and summarized using a map-reduce approach.
- **`chunkOverlap`**: The overlap size between segments when using the map-reduce approach.
- **`stuffPrompt`**: The prompt used when the entire PDF document fits within the model’s context window.
- **`mapPrompt`**: The prompt used during the map phase of the map-reduce approach.
- **`reducePrompt`**: The prompt used during the reduce phase of the map-reduce approach.