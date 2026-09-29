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
  await injectPackaged();
  const hooks = await runMain(() => {
    window.__kissSavedAttachShadow = Element.prototype.attachShadow;
    window.__kissSavedXHROpen = XMLHttpRequest.prototype.open;
    return {
      shadow: Element.prototype.attachShadow.__kissTranslatorShadowHook === true,
      subtitle: XMLHttpRequest.prototype.open.__kissTranslatorCaptionHook === true,
    };
  });
  await injectPackaged();
  const idempotent = await runMain(() => window.__kissSavedAttachShadow === Element.prototype.attachShadow && window.__kissSavedXHROpen === XMLHttpRequest.prototype.open);
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
