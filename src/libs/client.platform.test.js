// Load the real build-time client classification: mocking isExt here would miss
// Safari silently taking the web storage and page-fetch paths.
jest.mock("./browser", () => ({
  browser: {
    storage: {
      local: { get: jest.fn(), set: jest.fn(), remove: jest.fn() },
    },
    runtime: { sendMessage: jest.fn() },
  },
  isBg: jest.fn(),
}));

const originalClient = process.env.REACT_APP_CLIENT;

afterEach(() => {
  if (originalClient === undefined) delete process.env.REACT_APP_CLIENT;
  else process.env.REACT_APP_CLIENT = originalClient;
  jest.restoreAllMocks();
});

describe.each(["safari", "chrome", "firefox"])(
  "%s extension routing",
  (client) => {
    let browser;
    let isBg;
    let storage;
    let stored;

    beforeEach(() => {
      jest.resetModules();
      process.env.REACT_APP_CLIENT = client;
      ({ browser, isBg } = require("./browser"));
      isBg.mockReturnValue(true);
      stored = {};
      browser.storage.local.get.mockImplementation(async (keys) =>
        Object.fromEntries(keys.map((key) => [key, stored[key]]))
      );
      browser.storage.local.set.mockImplementation(async (values) => {
        Object.assign(stored, values);
      });
      browser.storage.local.remove.mockImplementation(async (keys) => {
        keys.forEach((key) => delete stored[key]);
      });
      ({ storage } = require("./storage"));
    });

    test("persists and removes settings through extension storage", async () => {
      const webSet = jest.spyOn(Storage.prototype, "setItem");
      const webGet = jest.spyOn(Storage.prototype, "getItem");
      const webRemove = jest.spyOn(Storage.prototype, "removeItem");
      const value = {
        uiLang: "zh",
        customEndpoint: "https://example.test/api",
      };

      await storage.setObj("platform-test", value);
      await expect(storage.getObj("platform-test")).resolves.toEqual(value);
      expect(browser.storage.local.set).toHaveBeenCalledWith({
        "platform-test": JSON.stringify(value),
      });
      await storage.del("platform-test");
      await expect(storage.getObj("platform-test")).resolves.toBeNull();
      expect(browser.storage.local.remove).toHaveBeenCalledWith([
        "platform-test",
      ]);
      expect(webSet).not.toHaveBeenCalled();
      expect(webGet).not.toHaveBeenCalled();
      expect(webRemove).not.toHaveBeenCalled();
    });

    test("proxies a content request to the background and preserves its response", async () => {
      isBg.mockReturnValue(false);
      const { fnPolyfill } = require("./request");
      const { MSG_FETCH } = require("../config");
      const nativeRequest = jest.fn();
      const response = { translatedText: "翻译成功" };
      browser.runtime.sendMessage.mockResolvedValue(response);
      const request = {
        input: "https://example.test/translate",
        init: { method: "POST", body: "source text" },
        opts: { expect: "json" },
      };

      await expect(
        fnPolyfill({ fn: nativeRequest, ...request })
      ).resolves.toEqual(response);
      expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
        action: MSG_FETCH,
        args: { ...request, opts: { expect: "json", signal: undefined } },
      });
      expect(nativeRequest).not.toHaveBeenCalled();
    });

    test("executes the actual request locally in the background", async () => {
      const { fnPolyfill } = require("./request");
      const nativeRequest = jest.fn().mockResolvedValue("translated");
      const request = { input: "https://example.test/translate", opts: {} };

      await expect(fnPolyfill({ fn: nativeRequest, ...request })).resolves.toBe(
        "translated"
      );
      expect(nativeRequest).toHaveBeenCalledWith(request);
      expect(browser.runtime.sendMessage).not.toHaveBeenCalled();
    });
  }
);

test.each([
  ["safari", true],
  ["chrome", false],
  ["firefox", false],
])(
  "%s defaults BuiltinAI disabled=%s without changing other engines",
  (client, disabled) => {
    jest.resetModules();
    process.env.REACT_APP_CLIENT = client;
    const {
      DEFAULT_API_LIST,
      OPT_TRANS_BUILTINAI,
      OPT_TRANS_MICROSOFT,
    } = require("../config");

    expect(
      DEFAULT_API_LIST.find((api) => api.apiType === OPT_TRANS_BUILTINAI)
        .isDisabled
    ).toBe(disabled);
    expect(
      DEFAULT_API_LIST.find((api) => api.apiType === OPT_TRANS_MICROSOFT)
        .isDisabled
    ).toBe(false);
  }
);
