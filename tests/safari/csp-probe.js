const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
const runMain = async (func) => (await browser.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", func }))[0]?.result;
if (config.stage === "before-removal") {
  const inlineBlocked = await runMain(() => {
    const script = document.createElement("script");
    script.textContent = "window.__kissCspInline = true";
    document.documentElement.append(script);
    script.remove();
    return window.__kissCspInline !== true;
  });
  const injectPackaged = async () => browser.scripting.executeScript({
    target: { tabId: tab.id }, world: "ISOLATED",
    func: async () => {
      for (const name of ["injector-shadowroot.js", "injector-subtitle.js"]) {
        await browser.runtime.sendMessage({ action: "inject_packaged_script", args: { name } });
      }
      return true;
    },
  });
  await runMain(() => {
    // This loopback fixture emulates only the local page-side caption protocol.
    history.replaceState(null, "", "/watch?v=local-fixture");
    window.__kissBeforeCaptionHooks = [window.fetch, XMLHttpRequest.prototype.open, XMLHttpRequest.prototype.send];
  });
  await injectPackaged();
  const hooks = await runMain(async () => {
    window.__kissSavedAttachShadow = Element.prototype.attachShadow;
    const before = window.__kissBeforeCaptionHooks;
    window.__kissSavedCaptionHooks = [window.fetch, XMLHttpRequest.prototype.open, XMLHttpRequest.prototype.send];
    const wrapped = window.__kissSavedCaptionHooks.every((fn, i) => typeof fn === "function" && fn !== before[i]);
    const bridge = window.__kissYoutubeCaptionBridge;
    const requestId = "local-caption-snapshot";
    const snapshot = await new Promise(resolve => {
      const finish = value => { clearTimeout(timer); window.removeEventListener("message", receive); resolve(value); };
      const receive = event => {
        const data = event.data;
        if (event.source === window && event.origin === location.origin &&
            data?.protocol === "kiss-youtube-captions-v1" && data.type === "response" && data.requestId === requestId)
          finish(data.videoId === "local-fixture" && Array.isArray(data.result?.captures));
      };
      const timer = setTimeout(() => finish(false), 1800);
      window.addEventListener("message", receive);
      window.postMessage({ protocol: "kiss-youtube-captions-v1", type: "request", action: "snapshot", videoId: "local-fixture", requestId }, location.origin);
    });
    return {
      shadow: Element.prototype.attachShadow.__kissTranslatorShadowHook === true,
      subtitle: typeof bridge?.dispose === "function" && wrapped && snapshot,
      wrapped, snapshot,
    };
  });
  await injectPackaged();
  const idempotent = await runMain(() => window.__kissSavedAttachShadow === Element.prototype.attachShadow &&
    [window.fetch, XMLHttpRequest.prototype.open, XMLHttpRequest.prototype.send].every((fn, i) => fn === window.__kissSavedCaptionHooks[i]));
  const denied = await browser.scripting.executeScript({ target: { tabId: tab.id }, world: "ISOLATED", func: async () => {
    try { return { response: await browser.runtime.sendMessage({ action: "inject_packaged_script", args: { name: "unlisted-injector.js" } }) ?? null }; }
    catch (error) { return { error: error.message }; }
  }});
  const unlistedDidNotRun = await runMain(() => window.__kissUnlistedInjectorExecuted !== true);
  const checks = [
    { name: "strict-csp-baseline", passed: inlineBlocked },
    { name: "packaged-main-injection-under-strict-csp", passed: hooks?.shadow && hooks?.subtitle, hooks },
    { name: "packaged-hooks-idempotent", passed: idempotent },
    { name: "packaged-injection-allowlist", passed: unlistedDidNotRun && denied[0]?.result?.response !== true, response: denied[0]?.result },
  ];
  let dnr;
  try {
    await browser.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [90002], addRules: [{
      id: 90002, priority: 1,
      action: { type: "modifyHeaders", responseHeaders: [{ header: "content-security-policy", operation: "remove" }] },
      condition: { urlFilter: new URL(config.fixtureURL).origin + "/csp", resourceTypes: ["main_frame"] },
    }] });
    dnr = { rulesAccepted: true };
  } catch (error) { dnr = { rulesAccepted: false, error: error.message }; }
  return { checks, dnr, passed: checks.every((check) => check.passed) };
}
const inlineAllowed = await runMain(() => {
  const script = document.createElement("script");
  script.textContent = "window.__kissCspAfterRemoval = true";
  document.documentElement.append(script);
  script.remove();
  return window.__kissCspAfterRemoval === true;
});
await browser.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [90002] });
return { cspResponseHeaderRemoved: inlineAllowed };
