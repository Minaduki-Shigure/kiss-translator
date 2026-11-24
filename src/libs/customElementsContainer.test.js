const originalClient = process.env.REACT_APP_CLIENT;
const nativeQueueMicrotask = global.queueMicrotask;
process.env.REACT_APP_CLIENT = "web";
afterAll(() => {
  if (originalClient === undefined) delete process.env.REACT_APP_CLIENT;
  else process.env.REACT_APP_CLIENT = originalClient;
});

let originalIntersectionObserver;
let originalCSSStyleSheet;
let originalGetComputedStyle;

beforeAll(() => {
  originalIntersectionObserver = global.IntersectionObserver;
  global.IntersectionObserver = class {
    constructor(callback) {
      this.callback = callback;
    }
    observe(target) {
      this.callback([{ target, isIntersecting: true }]);
    }
    unobserve() {}
    disconnect() {}
  };

  originalCSSStyleSheet = global.CSSStyleSheet;
  global.CSSStyleSheet = class {
    replaceSync() {}
  };

  originalGetComputedStyle = window.getComputedStyle;
  window.getComputedStyle = function (el) {
    const style = originalGetComputedStyle.call(window, el);
    // 模拟真实浏览器中自定义标签默认 display: inline 的表现
    if (el.tagName && el.tagName.toLowerCase().includes("-")) {
      return new Proxy(style, {
        get(target, prop) {
          if (prop === "display") return "inline";
          return target[prop];
        },
      });
    }
    return style;
  };
});

afterAll(() => {
  global.IntersectionObserver = originalIntersectionObserver;
  global.CSSStyleSheet = originalCSSStyleSheet;
  window.getComputedStyle = originalGetComputedStyle;
});

jest.mock("../apis", () => ({
  apiMicrosoftDict: jest.fn(),
  apiTranslate: jest.fn(),
  apiYoudaoDict: jest.fn(),
}));

jest.mock("./msg", () => ({
  sendBgMsg: jest.fn(),
}));

jest.mock("./detect", () => ({
  tryDetectLang: jest.fn().mockResolvedValue("en"),
}));

const { apiTranslate } = require("../apis");
const { DEFAULT_API_SETTING } = require("../config");
const { GLOBLA_RULE } = require("../config/rules");
const { Translator } = require("./translator");

const flushAsync = async () => {
  jest.runOnlyPendingTimers();
  for (let frame = 0; frame < 2; frame++) {
    for (let i = 0; i < 8; i++) await Promise.resolve();
    jest.advanceTimersByTime(16);
  }
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

const createApiSetting = (apiSlug) => ({
  ...DEFAULT_API_SETTING,
  apiSlug,
  apiName: apiSlug,
  isDisabled: false,
});

const createdTranslators = [];

function createTranslator(rule = {}) {
  const translator = new Translator({
    rule: {
      ...GLOBLA_RULE,
      transOpen: "true",
      rootsSelector: "body",
      ...rule,
    },
    setting: {
      transInterval: 0,
      rootMargin: 0,
      mouseHoverSetting: {},
      customStyles: [],
      transApis: [createApiSetting(DEFAULT_API_SETTING.apiSlug)],
    },
    favWords: [],
  });
  createdTranslators.push(translator);
  return translator;
}

afterEach(() => {
  createdTranslators.forEach((t) => t.stop());
  createdTranslators.length = 0;
  jest.clearAllMocks();
  jest.useRealTimers();
  document.body.innerHTML = "";
});

describe("通用组件化自定义标签容器与还原防泄漏测试（全局默认 autoScan: true，无专属规则）", () => {
  const posts = [
    "Hey all! Do you think there will be a pdf of the rules?",
    "The publisher usually shares the rules before release.",
  ];

  beforeEach(() => {
    jest.useFakeTimers();
    // 让 MutationObserver 与翻译器自身的 DOM 变更标记共享浏览器的微任务次序。
    global.queueMicrotask = nativeQueueMicrotask;
    // 行内自定义组件包裹多个帖子，帖子内部用块级节点分隔作者、菜单与正文。
    document.body.innerHTML = `
      <gg-thread>
        <gg-post>
          <div>Forum author</div>
          <div><button>User actions menu</button></div>
          <div><gg-markup-content>${posts[0]}</gg-markup-content></div>
        </gg-post>
        <gg-post>
          <div><gg-markup-content>${posts[1]}</gg-markup-content></div>
        </gg-post>
      </gg-thread>
    `;
  });

  test("1. 目标选取验证: 即使自定义组件默认 display 为 inline，包含块级子节点时不吞噬外层结构容器", () => {
    // 使用纯全局默认规则
    const translator = createTranslator({ transOpen: "false" });
    const targets = translator.previewRule().targets;

    // 找到所有包含主帖正文的 target
    const contentTargets = targets.filter((t) =>
      t.textContent.includes("Do you think there will be a pdf")
    );

    // 必须穿透定位至正文叶子组件，不把外层容器当叶子文本块
    expect(contentTargets.length).toBe(1);
    expect(contentTargets[0].tagName.toLowerCase()).toBe("gg-markup-content");
    expect(contentTargets[0].textContent).not.toContain("User actions menu");
    expect(contentTargets[0].textContent).not.toContain("Forum author");
  });

  test("2. 还原防泄漏验证: 关闭翻译或还原时，正文中绝无残留 loading 图标", async () => {
    // 模拟在途请求（保持 loading 状态）
    apiTranslate.mockImplementation(() => new Promise(() => {}));

    const translator = createTranslator({ transOnly: "true" });
    await flushAsync();

    const markupContent = document.querySelector("gg-markup-content");
    expect(
      markupContent.querySelector(`.${Translator.KISS_CLASS.warpper} svg`)
    ).not.toBeNull();

    // 触发还原
    translator.stop();
    await flushAsync();

    // 验证正文完全还原为纯净原文，没有任何残余 loading 或 kiss-warpper 容器
    const wrappers = markupContent.querySelectorAll(
      `.${Translator.KISS_CLASS.warpper}`
    );
    expect(wrappers.length).toBe(0);
    const residualSvgTags = markupContent.querySelectorAll("svg");
    expect(residualSvgTags.length).toBe(0);
    expect(markupContent.textContent).toBe(posts[0]);
  });

  test.each(["false", "true"])(
    "逐帖翻译并在各自的正文中显示结果 (transOnly: %s)",
    async (transOnly) => {
      apiTranslate.mockResolvedValue({ trText: "测试译文", isSame: false });
      createTranslator({ transOnly });
      await flushAsync();
      await flushAsync();

      const requests = apiTranslate.mock.calls.map(([request]) => request.text);
      const postRequests = requests.filter((text) =>
        posts.some((post) => text.includes(post))
      );
      expect(postRequests).toHaveLength(posts.length);
      expect(postRequests).toEqual(expect.arrayContaining(posts));

      const contents = document.querySelectorAll("gg-markup-content");
      expect(contents).toHaveLength(posts.length);
      contents.forEach((content, index) => {
        const translations = content.querySelectorAll(
          `.${Translator.KISS_CLASS.inner}`
        );
        expect(translations).toHaveLength(1);
        expect(translations[0].textContent).toBe("测试译文");
        expect(content.textContent.includes(posts[index])).toBe(
          transOnly === "false"
        );
      });
    }
  );
});
