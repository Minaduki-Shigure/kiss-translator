import { persistSubtitlePosition, runSubtitle } from "./subtitle.js";
import { saveEdit } from "../libs/storage.js";
import { logger } from "../libs/log.js";
import { STOKEY_SETTING } from "../config/storage.js";
import { YouTubeInitializer } from "./YouTubeCaptionProvider.js";

jest.mock("../libs/storage.js", () => ({
  saveEdit: jest.fn(),
}));

jest.mock("../libs/log.js", () => ({
  LogLevel: {
    INFO: { value: "info" },
  },
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("../injectors/index.js", () => ({
  injectJs: jest.fn(),
  INJECTOR: { subtitle: "subtitle" },
}));

jest.mock("./YouTubeCaptionProvider.js", () => ({
  YouTubeInitializer: jest.fn(),
}));

describe("persistSubtitlePosition", () => {
  let setting;
  beforeEach(() => {
    jest.clearAllMocks();
    setting = {};
    saveEdit.mockImplementation(async (_key, update) => {
      setting = update(setting);
      return { value: setting, changed: true };
    });
  });

  test("merges the ratio without replacing unrelated settings", async () => {
    setting = {
      darkMode: "dark",
      subtitleSetting: {
        apiSlug: "microsoft",
        rememberPosition: true,
      },
    };

    await persistSubtitlePosition(0.3);

    expect(setting).toEqual({
      darkMode: "dark",
      subtitleSetting: {
        apiSlug: "microsoft",
        rememberPosition: true,
        positionRatio: 0.3,
      },
    });
    expect(saveEdit).toHaveBeenCalledWith(STOKEY_SETTING, expect.any(Function));
  });

  test("does not break subtitle rendering when storage fails", async () => {
    saveEdit.mockRejectedValueOnce(new Error("storage unavailable"));

    await expect(persistSubtitlePosition(0.3)).resolves.toBeUndefined();
    expect(setting).toEqual({});
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  test("keeps complete subtitle defaults when storage is initially empty", async () => {
    await persistSubtitlePosition(0.3);

    expect(setting).toEqual(
      expect.objectContaining({
        subtitleSetting: expect.objectContaining({
          enabled: true,
          positionRatio: 0.3,
        }),
      })
    );
  });

  test("keeps the merge as a pure intent until storage supplies the latest settings", async () => {
    saveEdit.mockResolvedValueOnce({ changed: true });
    await persistSubtitlePosition(0.4);
    const update = saveEdit.mock.calls[0][1];
    const latest = Object.freeze({
      darkMode: "dark",
      subtitleSetting: Object.freeze({
        rememberPosition: true,
        positionRatio: 0.2,
      }),
    });
    expect(update(latest)).toEqual({
      darkMode: "dark",
      subtitleSetting: { rememberPosition: true, positionRatio: 0.4 },
    });
    expect(latest.subtitleSetting.positionRatio).toBe(0.2);
  });
});

describe("runSubtitle", () => {
  const originalClient = process.env.REACT_APP_CLIENT;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (originalClient === undefined) delete process.env.REACT_APP_CLIENT;
    else process.env.REACT_APP_CLIENT = originalClient;
  });

  test.each([false, true])(
    "preserves an explicitly selected local-only API in Safari even when disabled=%s",
    (isDisabled) => {
      process.env.REACT_APP_CLIENT = "safari";
      const builtin = {
        apiSlug: "saved-local",
        apiType: "BuiltinAI",
        isDisabled,
      };
      const paid = {
        apiSlug: "paid-cloud",
        apiType: "OpenAI",
        isDisabled: false,
      };
      const setting = {
        subtitleSetting: { enabled: true, apiSlug: builtin.apiSlug },
        transApis: [paid, builtin],
      };

      runSubtitle({ href: "https://www.youtube.com/watch?v=video-1", setting });

      expect(YouTubeInitializer).toHaveBeenCalledWith(
        expect.objectContaining({
          apiSlug: builtin.apiSlug,
          apiSetting: builtin,
        })
      );
      expect(setting.subtitleSetting.apiSlug).toBe(builtin.apiSlug);
      expect(saveEdit).not.toHaveBeenCalled();
    }
  );

  test("excludes unavailable local AI from Safari's unconfigured subtitle defaults", () => {
    process.env.REACT_APP_CLIENT = "safari";
    const builtin = { apiSlug: "saved-local", apiType: "BuiltinAI" };
    const available = { apiSlug: "google", apiType: "Google" };

    runSubtitle({
      href: "https://www.youtube.com/watch?v=video-1",
      setting: {
        subtitleSetting: { enabled: true },
        transApis: [builtin, available],
      },
    });

    expect(YouTubeInitializer).toHaveBeenCalledWith(
      expect.objectContaining({
        apiSlug: available.apiSlug,
        apiSetting: available,
      })
    );
  });

  test("keeps the runtime API slug aligned with the first enabled service", () => {
    const disabledApi = {
      apiSlug: "disabled-api",
      apiName: "Disabled API",
      isDisabled: true,
    };
    const enabledApi = {
      apiSlug: "enabled-api",
      apiName: "Enabled API",
    };

    runSubtitle({
      href: "https://www.youtube.com/watch?v=video-1",
      setting: {
        subtitleSetting: {
          enabled: true,
          apiSlug: disabledApi.apiSlug,
        },
        transApis: [disabledApi, enabledApi],
      },
    });

    expect(YouTubeInitializer).toHaveBeenCalledWith(
      expect.objectContaining({
        apiSlug: enabledApi.apiSlug,
        apiSetting: enabledApi,
        transApis: [disabledApi, enabledApi],
      })
    );
  });
});
