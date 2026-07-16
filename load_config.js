/**
 * load_config.js — Shared config loader for Zotero AI Summary actions.
 *
 * Usage in any action script:
 *
 *   let dirname = "/home/xiahong/code/zotero-ai-summary";
 *   let _code = new TextDecoder("utf-8").decode(
 *     await IOUtils.read(dirname + "/load_config.js")
 *   );
 *   let _init = new Function(_code + "; return initConfig;")();
 *   const { config, load_file } = await _init(dirname);
 *
 * config.json  — committed to git (placeholder API keys, safe to share)
 * secrets.json — gitignored (real API keys, never committed)
 *
 * initConfig merges secrets.json over config.json automatically.
 */

async function initConfig(dirname) {
  async function load_file(pname) {
    try {
      let path = dirname + "/" + pname;
      let content = await IOUtils.read(path);
      const decoder = new TextDecoder("utf-8");
      return decoder.decode(content);
    } catch (error) {
      throw new Error(`读取文件失败 ${pname}: ${error.message}`);
    }
  }

  let fileContent = await load_file("config.json");
  const config = JSON.parse(fileContent);

  // Merge secrets.json (API keys, tokens — never committed)
  try {
    let secretsContent = await load_file("config_secret.json");
    const secrets = JSON.parse(secretsContent);
    if (secrets.llm) Object.assign(config.llm, secrets.llm);
    if (secrets.zotero) Object.assign(config.zotero, secrets.zotero);
    if (secrets.elasticsearch)
      Object.assign(config.elasticsearch, secrets.elasticsearch);
    if (secrets.server) Object.assign(config.server, secrets.server);
  } catch (_) {
    // secrets.json not found — using config.json values as-is
  }

  return { config, load_file };
}
