// Executed by WKWebView.callAsyncJavaScript in an actual extension page.
// Storage follows the application's JSON-string format, with no real credentials.
const key = "KISS-Translator_setting_v2";
const current = await browser.storage.local.get(key);
const setting = current[key] ? JSON.parse(current[key]) : {};
Object.assign(setting, {
  version: 3, uiLang: "en", checkUpdate: false, injectRules: false,
  subrulesList: [], csplist: "", orilist: "", contextMenuType: 0,
  transInterval: 0, langDetector: "-", preInit: false,
  transAllnow: true, skipLangs: [], blacklist: "", logLevel: 0,
  transApis: [{
    apiSlug: "safari-local-fixture", apiName: "Local fixture", apiType: "Custom",
    url: config.apiURL + "/translate", key: "", reqHook: "", resHook: "",
    placeholder: "{ }", placetag: "i", placetagFormat: "compact",
    systemPrompt: "", userPrompt: "", aiTerms: "", tone: "", model: "",
    useBatchFetch: false, useStream: false, transAllnow: true,
    fetchInterval: 0, fetchLimit: 4, httpTimeout: 5,
  }],
  tranboxSetting: { ...setting.tranboxSetting, transOpen: false },
  inputRule: { ...setting.inputRule, transOpen: false },
  subtitleSetting: { ...setting.subtitleSetting, enabled: false },
});
const rules = [{
  pattern: "*", enabled: true, selector: "#fixture p", rootsSelector: "#fixture",
  apiSlug: "safari-local-fixture", fromLang: "en", toLang: "zh-CN",
  transOpen: "false", transOnly: "false", transTag: "font", transTitle: "false",
  hasRichText: "false", autoScan: "false", hasShadowroot: "false", scanAll: "false",
  splitParagraph: "split_disable", highlightWords: "highlight_disable",
  textStyle: "none", originalTextStyle: "none", transOrder: "original-first",
}];
await browser.storage.local.set({
  [key]: JSON.stringify(setting),
  "KISS-Translator_rules_v2": JSON.stringify(rules),
  "KISS-Translator_sync": JSON.stringify({ syncUrl: "", syncKey: "", syncMeta: {} }),
  __safari_probe: { marker: "native-storage-roundtrip", unicode: "翻译" },
});
const stored = await browser.storage.local.get("__safari_probe");
return {
  passed: stored.__safari_probe.marker === "native-storage-roundtrip" && stored.__safari_probe.unicode === "翻译",
  browserAPI: typeof browser.runtime.sendMessage,
  apiURL: config.apiURL,
};
