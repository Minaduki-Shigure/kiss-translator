import { serviceInvocationOptions } from "./timeout";
import { invokeService, unavailableServiceInvocation } from "./serviceRuntime";
import { isApiTypeSupported } from "../config/platformApiSupport";
import { invokeBridgedService } from "./bridgeInvocation";
import { invokeBackgroundPlugin } from "./backgroundInvocation";
import { isExt } from "../libs/client";
import { isBg } from "../libs/browser";

/** Background external calls connect directly to the host; pages use the privileged relay. */
export function invokeScene(api, capability, input, options = {}) {
  options = serviceInvocationOptions(api, options);
  if (!isApiTypeSupported(api))
    return unavailableServiceInvocation(api, options);
  if (!api.provider || api.provider.implementation?.kind === "native")
    return invokeService(api, capability, input, options);
  if (isExt && isBg())
    return invokeBackgroundPlugin(api, capability, input, options);
  return invokeBridgedService(api.apiSlug, capability, input, options);
}
