import { resolveAiDictApiSetting } from "./aiDictionary";
import { PROMPT_CATEGORY_DICTIONARY } from "../config/prompt";
const api = {
  apiType: "OpenAI",
  apiSlug: "test",
  dictPrompt: "",
  dictUserPrompt: "{{text}}",
};
const resolve = (patch = {}) =>
  resolveAiDictApiSetting({
    aiDictApiSlug: "test",
    transApis: [api],
    ...patch,
  });
test("accepts either half and rejects blank, disabled and unsupported dictionaries", () => {
  expect(resolve()).toMatchObject({
    dictPrompt: "",
    dictUserPrompt: "{{text}}",
  });
  expect(
    resolve({
      transApis: [{ ...api, dictPrompt: "Rules", dictUserPrompt: "" }],
    })
  ).not.toBeNull();
  for (const updated of [
    { isDisabled: true },
    { apiType: "Google" },
    { enabledCapabilities: [] },
  ])
    expect(resolve({ transApis: [{ ...api, ...updated }] })).toBeNull();
});
test("global dictionary selection validates category and both halves", () => {
  const prompt = {
    slug: "custom",
    category: PROMPT_CATEGORY_DICTIONARY,
    systemPrompt: "",
    userPrompt: "{{text}}",
  };
  expect(
    resolve({ aiDictPromptSlug: prompt.slug, prompts: [prompt] })
  ).toMatchObject({ dictUserPrompt: "{{text}}" });
  for (const updated of [{ category: "summary prompt" }])
    expect(
      resolve({
        aiDictPromptSlug: prompt.slug,
        prompts: [{ ...prompt, ...updated }],
      })
    ).toBeNull();
});
test("plugin availability uses its selected pair without replacing explicit empties", () => {
  const plugin = {
    apiType: "Plugin",
    apiSlug: "test",
    provider: {
      apiVersion: 1,
      implementation: { kind: "script" },
      capabilities: { dictionary: { handler: "dictionary" } },
      defaultPrompts: {
        dictionary: [
          { id: "default", systemPrompt: "", userPrompt: "{{text}}" },
        ],
      },
    },
  };
  expect(resolve({ transApis: [plugin] })).toMatchObject({
    dictUserPrompt: "{{text}}",
  });
  expect(
    resolve({ transApis: [{ ...plugin, dictPrompt: "", dictUserPrompt: "" }] })
  ).toMatchObject({ dictUserPrompt: "{{text}}" });
  expect(
    resolve({
      transApis: [
        { ...plugin, provider: { ...plugin.provider, defaultPrompts: {} } },
      ],
    })
  ).toMatchObject({ dictUserPrompt: expect.stringContaining("{{text}}") });
  expect(plugin.dictUserPrompt).toBeUndefined();
});

test("Safari does not resolve an externally implemented saved dictionary or replace it with a cloud service", () => {
  const previous = process.env.REACT_APP_CLIENT;
  const saved = {
    ...api,
    provider: {
      apiVersion: 1,
      implementation: { kind: "script" },
      capabilities: { dictionary: { handler: "dictionary" } },
    },
  };
  const transApis = [saved, { ...api, apiSlug: "cloud" }];
  try {
    process.env.REACT_APP_CLIENT = "chrome";
    expect(resolve({ transApis })).toMatchObject({ apiSlug: "test" });
    process.env.REACT_APP_CLIENT = "safari";
    expect(resolve({ transApis })).toBeNull();
    expect(resolve({ transApis, aiDictApiSlug: "cloud" })).toMatchObject({
      apiSlug: "cloud",
    });
  } finally {
    if (previous === undefined) delete process.env.REACT_APP_CLIENT;
    else process.env.REACT_APP_CLIENT = previous;
  }
});
