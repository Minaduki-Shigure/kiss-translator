const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const checks = [];
const check = (name, passed, detail = {}) => checks.push({ name, passed, ...detail });
const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
if (!tab?.id) throw new Error("The isolated fixture tab is not registered with the extension controller");
let rule;
for (let i = 0; i < 100; i++) {
  try {
    rule = await browser.tabs.sendMessage(tab.id, { action: "trans_getrule" });
    if (rule) break;
  } catch {}
  await sleep(100);
}
check("real-content-script-startup", Boolean(rule), { apiSlug: rule?.rule?.apiSlug, frameId: rule?.document?.frameId });

const injections = await browser.scripting.executeScript({
  target: { tabId: tab.id }, world: "ISOLATED",
  args: [config.apiURL],
  func: async (apiURL) => {
    const response = await browser.runtime.sendMessage({ action: "kiss_fetch", args: {
      input: apiURL + "/json", init: { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } },
      opts: { httpTimeout: 5 },
    }});
    const stream = await new Promise((resolve, reject) => {
      const deltas = [];
      const port = browser.runtime.connect({ name: "kiss_stream_fetch" });
      const timer = setTimeout(() => { port.disconnect(); reject(new Error("Stream port timed out")); }, 8000);
      port.onMessage.addListener((message) => {
        if (message.type === "delta") deltas.push(message.data);
        if (message.type === "done" || message.type === "error") {
          clearTimeout(timer); port.disconnect();
          if (message.type === "error") reject(new Error(message.error)); else resolve(deltas);
        }
      });
      port.postMessage({ action: "start", args: { input: apiURL + "/sse", init: {}, opts: { httpTimeout: 5 } } });
    });
    const stored = await browser.storage.local.get("__safari_probe");
    return { response, stream, stored: stored.__safari_probe };
  },
});
const communication = injections[0]?.result;
check("content-background-cross-origin-fetch", communication?.response?.marker === "local-api-response", { response: communication?.response });
check("content-background-sse-port", communication?.stream?.length === 2 && communication.stream[0].includes("first") && communication.stream[1].includes("second"), { stream: communication?.stream });
check("content-extension-storage-shared", communication?.stored?.marker === "native-storage-roundtrip");

await browser.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", func: () => { window.__kissNativeMain = "main-world-success"; } });
const main = await browser.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", func: () => window.__kissNativeMain });
check("main-world-injection", main[0]?.result === "main-world-success");

await browser.tabs.sendMessage(tab.id, { action: "toggle_translate", args: { enabled: true } });
let dom;
for (let i = 0; i < 100; i++) {
  const result = await browser.scripting.executeScript({ target: { tabId: tab.id }, func: () => ({ text: document.querySelector("#fixture")?.innerText, html: document.querySelector("#fixture")?.innerHTML }) });
  dom = result[0]?.result;
  if (dom?.text?.includes("安静的图书馆每天早晨开放。") && dom?.text?.includes("小实验帮助我们理解世界。")) break;
  await sleep(100);
}
check("real-content-dom-translation", dom?.text?.includes("安静的图书馆每天早晨开放。") && dom?.text?.includes("小实验帮助我们理解世界。"), { dom });

// Observe compatibility instead of treating known DNR limitations as core translation failures.
let dnr;
try {
  await browser.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [90001], addRules: [{
    id: 90001, priority: 1, action: { type: "modifyHeaders", requestHeaders: [{ header: "Origin", operation: "set", value: "https://safari-probe.invalid" }] },
    condition: { urlFilter: config.apiURL + "/origin", resourceTypes: ["xmlhttprequest"], excludedInitiatorDomains: ["example.invalid"] },
  }] });
  const observed = await browser.runtime.sendMessage({ action: "kiss_fetch", args: { input: config.apiURL + "/origin", init: { method: "POST", body: "{}" }, opts: { httpTimeout: 5 } } });
  dnr = { rulesAccepted: true, originObserved: observed.origin, originModified: observed.origin === "https://safari-probe.invalid" };
  await browser.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [90001] });
} catch (error) { dnr = { rulesAccepted: false, error: error.message }; }
return { checks, dnr, passed: checks.every((entry) => entry.passed) };
