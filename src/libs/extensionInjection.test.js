import { injectPackagedScript } from "./extensionInjection";
import { browser } from "./browser";

jest.mock("./browser", () => ({
  browser: { scripting: { executeScript: jest.fn(async () => []) } },
}));

beforeEach(() => jest.clearAllMocks());

test("injects the shipped caption hook in its requesting frame, not an active tab", async () => {
  await expect(
    injectPackagedScript(
      { name: "injector-subtitle.js" },
      { tab: { id: 17 }, frameId: 4 }
    )
  ).resolves.toBe(true);
  expect(browser.scripting.executeScript).toHaveBeenCalledWith({
    target: { tabId: 17, frameIds: [4] },
    files: ["injector-subtitle.js"],
    world: "MAIN",
  });
});

test.each(["https://example.com/script.js", "background.js", "../content.js"])(
  "rejects arbitrary injector %s without executing it",
  async (name) => {
    await expect(
      injectPackagedScript({ name }, { tab: { id: 1 }, frameId: 0 })
    ).rejects.toThrow("Unknown packaged injector");
    expect(browser.scripting.executeScript).not.toHaveBeenCalled();
  }
);

test.each([undefined, {}, { tab: { id: 2 } }])(
  "does not substitute a tab when the sender is not a content script",
  async (sender) => {
    await expect(
      injectPackagedScript({ name: "injector-shadowroot.js" }, sender)
    ).rejects.toThrow("content-script sender");
    expect(browser.scripting.executeScript).not.toHaveBeenCalled();
  }
);
