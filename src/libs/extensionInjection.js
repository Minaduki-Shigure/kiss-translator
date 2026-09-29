import { browser } from "./browser";

const PACKAGED_SCRIPTS = new Set([
  "injector-subtitle.js",
  "injector-shadowroot.js",
]);

// Only shipped scripts can cross into MAIN world, and only in the frame that
// requested them. The active tab may have changed while the message was sent.
export async function injectPackagedScript({ name } = {}, sender) {
  if (!PACKAGED_SCRIPTS.has(name)) {
    throw new Error("Unknown packaged injector");
  }
  const tabId = sender?.tab?.id;
  const frameId = sender?.frameId;
  if (!Number.isInteger(tabId) || !Number.isInteger(frameId)) {
    throw new Error("Packaged injectors require a content-script sender");
  }
  await browser.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    files: [name],
    world: "MAIN",
  });
  return true;
}
