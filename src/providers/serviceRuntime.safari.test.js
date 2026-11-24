import { invokeService } from "./serviceRuntime";
import { invokeInstance } from "./runtime";
import { invokeBridgedService } from "./bridgeInvocation";
import { createNativeRegistry } from "../builtin-plugins/runtime";

jest.mock("./runtime", () => ({ invokeInstance: jest.fn() }));
jest.mock("./bridgeInvocation", () => ({ invokeBridgedService: jest.fn() }));
jest.mock("../builtin-plugins/runtime", () => ({
  createNativeRegistry: jest.fn(),
}));
jest.mock("./transport", () => ({ createAssetStore: jest.fn(() => ({})) }));
jest.mock("../libs/diagnostics/transport", () => ({
  captureDiagnostic: jest.fn(),
}));

const previous = process.env.REACT_APP_CLIENT;
beforeEach(() => {
  process.env.REACT_APP_CLIENT = "safari";
});
afterEach(() => {
  if (previous === undefined) delete process.env.REACT_APP_CLIENT;
  else process.env.REACT_APP_CLIENT = previous;
});

test.each([
  [{ apiType: "BuiltinAI" }, "detectLanguage"],
  [{ apiType: "LocalAI" }, "recognizeText"],
  [
    {
      apiType: "Plugin",
      provider: { implementation: { kind: "declarative" } },
    },
    "translate",
  ],
])(
  "refuses direct dispatch for an unavailable %j without exposing the input",
  async (instance, capability) => {
    const assets = {};
    const call = invokeService(
      instance,
      capability,
      { text: "private input" },
      { assets }
    );
    await expect(call.result).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
    await call.finished;
    expect(call.assets).toBe(assets);
    expect(invokeInstance).not.toHaveBeenCalled();
    expect(invokeBridgedService).not.toHaveBeenCalled();
    expect(createNativeRegistry).not.toHaveBeenCalled();
  }
);
