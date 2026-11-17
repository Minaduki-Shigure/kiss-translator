import { isApiTypeSupported } from "../config/platformApiSupport";
import { supportsApiCapability } from "../config/serviceSelection";

export function getEnabledApis(transApis = []) {
  return transApis
    .map((api, index) => ({ api, index }))
    .filter(
      ({ api }) =>
        api?.apiSlug &&
        !api.isDisabled &&
        isApiTypeSupported(api) &&
        supportsApiCapability(api, "translate")
    )
    .sort((a, b) => {
      const orderA = Number(a.api.sortOrder) || 0;
      const orderB = Number(b.api.sortOrder) || 0;
      return orderA - orderB || a.index - b.index;
    })
    .map(({ api }) => api);
}

export function resolveApiSelection(transApis, apiSlug) {
  // Preserve an explicit, unavailable provider so the dispatcher explains the
  // limitation; falling back could send text meant for a local model remotely.
  const selected = transApis?.find((api) => api && api.apiSlug === apiSlug);
  if (selected && !isApiTypeSupported(selected)) return selected;
  const enabledApis = getEnabledApis(transApis);
  return enabledApis.find((api) => api.apiSlug === apiSlug) || enabledApis[0];
}

export function normalizeRuleApi(rule, transApis) {
  const api = resolveApiSelection(transApis, rule.apiSlug);
  return api && api.apiSlug !== rule.apiSlug
    ? { ...rule, apiSlug: api.apiSlug }
    : rule;
}
