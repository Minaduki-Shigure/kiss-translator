import browser from "webextension-polyfill";
import { requestStream } from "./requestStream";

jest.mock("webextension-polyfill", () => ({
  runtime: { connect: jest.fn() },
}));
jest.mock("./client", () => ({ isExt: true, isGm: false }));
jest.mock("./browser", () => ({ isBg: () => false }));
jest.mock("@streamparser/json", () => ({ JSONParser: jest.fn() }));
jest.mock("./storage", () => ({
  getSettingWithDefault: jest.fn(async () => ({ httpTimeout: 1000 })),
}));

describe("extension stream lifecycle", () => {
  let port;
  let onMessage;
  let onDisconnect;

  beforeEach(() => {
    delete browser.runtime.lastError;
    port = {
      onMessage: { addListener: (listener) => (onMessage = listener) },
      onDisconnect: { addListener: (listener) => (onDisconnect = listener) },
      postMessage: jest.fn(),
      disconnect: jest.fn(() => onDisconnect()),
    };
    browser.runtime.connect.mockReturnValue(port);
  });

  const start = async (opts = {}) => {
    const iterator = requestStream("https://example.test/stream", {}, opts);
    const pending = iterator.next();
    // resolveHttpTimeout is asynchronous even with an explicit timeout.
    for (let i = 0; i < 10 && !port.postMessage.mock.calls.length; i += 1) {
      await Promise.resolve();
    }
    return { iterator, pending };
  };

  test("rejects a quiet background disconnect instead of waiting forever", async () => {
    const { pending } = await start();
    onDisconnect();
    await expect(pending).rejects.toThrow("closed before completion");
    expect(port.disconnect).toHaveBeenCalled();
  });

  test("retains the browser error on premature disconnect", async () => {
    const { pending } = await start();
    browser.runtime.lastError = { message: "Background context invalidated" };
    onDisconnect();
    await expect(pending).rejects.toThrow("Background context invalidated");
  });

  test("drains buffered deltas and completes normally before disconnection", async () => {
    const { iterator, pending } = await start();
    onMessage({ type: "delta", data: "one" });
    onMessage({ type: "delta", data: "two" });
    onMessage({ type: "done" });
    onDisconnect();
    await expect(pending).resolves.toEqual({ value: "one", done: false });
    await expect(iterator.next()).resolves.toEqual({
      value: "two",
      done: false,
    });
    await expect(iterator.next()).resolves.toEqual({ done: true });
  });

  test("keeps an explicit server error when the port also disconnects", async () => {
    const { pending } = await start();
    onMessage({ type: "error", error: "Translation service unavailable" });
    onDisconnect();
    await expect(pending).rejects.toThrow("Translation service unavailable");
  });

  test("propagates cancellation and disconnects the background request", async () => {
    const controller = new AbortController();
    const { pending } = await start({ signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(port.disconnect).toHaveBeenCalled();
    expect(port.postMessage.mock.calls[0][0].args.opts.signal).toBeUndefined();
  });

  test("disconnects when the consumer stops early", async () => {
    const { iterator, pending } = await start();
    onMessage({ type: "delta", data: "one" });
    await pending;
    await iterator.return();
    expect(port.disconnect).toHaveBeenCalledTimes(1);
  });

  test("cleans up when posting to the background throws", async () => {
    port.postMessage.mockImplementation(() => {
      throw new Error("Port closed during startup");
    });
    await expect(
      requestStream("https://example.test/stream", {}).next()
    ).rejects.toThrow("Port closed during startup");
    expect(port.disconnect).toHaveBeenCalledTimes(1);
  });
});
