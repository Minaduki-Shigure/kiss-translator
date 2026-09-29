jest.mock("./browser", () => ({
  browser: {
    i18n: {
      detectLanguage: jest.fn(),
    },
  },
}));

jest.mock("../apis", () => ({
  apiGoogleLangdetect: jest.fn(),
  apiBaiduLangdetect: jest.fn(),
  apiTencentLangdetect: jest.fn(),
  apiBuiltinAIDetect: jest.fn(),
}));

const { apiTencentLangdetect, apiBuiltinAIDetect } = require("../apis");
const { OPT_TRANS_TENCENT, OPT_TRANS_BUILTINAI } = require("../config");
const { browser } = require("./browser");
const { tryDetectLang } = require("./detect");

describe("tryDetectLang", () => {
  const originalClient = process.env.REACT_APP_CLIENT;

  beforeEach(() => {
    jest.clearAllMocks();
    browser.i18n.detectLanguage = jest.fn();
  });

  afterEach(() => {
    if (originalClient === undefined) delete process.env.REACT_APP_CLIENT;
    else process.env.REACT_APP_CLIENT = originalClient;
  });

  test.each([
    ["zh-Hant", "zh-TW"],
    ["zh-HK", "zh-TW"],
    ["en-US", "en"],
    ["pt-BR", "pt"],
  ])("normalizes browser result %s to %s", async (language, expected) => {
    browser.i18n.detectLanguage.mockResolvedValue({
      isReliable: true,
      languages: [{ language, percentage: 100 }],
    });

    await expect(tryDetectLang("sample text")).resolves.toBe(expected);
  });

  test("keeps Tencent's generic Chinese result as simplified Chinese", async () => {
    apiTencentLangdetect.mockResolvedValue("zh");

    await expect(
      tryDetectLang("中文测试文本", OPT_TRANS_TENCENT)
    ).resolves.toBe("zh-CN");
    expect(browser.i18n.detectLanguage).not.toHaveBeenCalled();
  });

  test("falls back to the browser when a provider result is unsupported", async () => {
    apiTencentLangdetect.mockResolvedValue("unknown-provider-code");
    browser.i18n.detectLanguage.mockResolvedValue({
      isReliable: true,
      languages: [{ language: "en-GB", percentage: 100 }],
    });

    await expect(
      tryDetectLang("English sample text", OPT_TRANS_TENCENT)
    ).resolves.toBe("en");
  });

  test("uses conservative local detection when Safari lacks the native API", async () => {
    browser.i18n.detectLanguage = undefined;

    await expect(tryDetectLang("这是中文测试文本")).resolves.toBe("zh-CN");
    await expect(tryDetectLang("これは日本語です")).resolves.toBe("ja");
    await expect(tryDetectLang("an ambiguous sample")).resolves.toBe("");
    await expect(tryDetectLang(undefined)).resolves.toBe("");
  });

  test("keeps a configured remote detector authoritative without a native API", async () => {
    browser.i18n.detectLanguage = undefined;
    apiTencentLangdetect.mockResolvedValue("fr");

    await expect(tryDetectLang("sample text", OPT_TRANS_TENCENT)).resolves.toBe(
      "fr"
    );
    expect(apiTencentLangdetect).toHaveBeenCalledWith("sample text");
  });

  test("falls back locally for an imported Safari BuiltinAI detector without invoking it", async () => {
    process.env.REACT_APP_CLIENT = "safari";
    browser.i18n.detectLanguage = undefined;

    await expect(
      tryDetectLang("這是中文測試", OPT_TRANS_BUILTINAI)
    ).resolves.toBe("zh-TW");
    expect(apiBuiltinAIDetect).not.toHaveBeenCalled();
  });

  test("keeps BuiltinAI detection available to Chrome", async () => {
    process.env.REACT_APP_CLIENT = "chrome";
    apiBuiltinAIDetect.mockResolvedValue("en");

    await expect(
      tryDetectLang("sample text", OPT_TRANS_BUILTINAI)
    ).resolves.toBe("en");
    expect(apiBuiltinAIDetect).toHaveBeenCalledWith("sample text");
  });
});
