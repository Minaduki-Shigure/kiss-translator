const key = "KISS-Translator_setting_v2";
const backupKey = key + "_backup_v3_before_v4";
const stored = await browser.storage.local.get([key, backupKey]);
const current = JSON.parse(stored[key] || "null");
const backup = JSON.parse(stored[backupKey] || "null");
const service = value => value?.transApis?.find(api => api.apiSlug === "safari-local-fixture");
const old = service(backup);
const next = service(current);
return {
  passed: backup?.version === 3 && current?.version === 5 &&
    old?.apiType === "Custom" && next?.apiType === "Custom" &&
    old.url === config.apiURL + "/translate" && next.url === old.url &&
    !old.sourceType && next.sourceType === "network" &&
    !old.vlmPromptSlug && typeof next.vlmPromptSlug === "string",
  previousVersion: backup?.version, currentVersion: current?.version,
  previousService: old?.apiSlug, currentService: next?.apiSlug,
  sameURL: Boolean(old?.url && next?.url === old.url), sourceType: next?.sourceType,
  vlmPromptSlug: next?.vlmPromptSlug,
};
