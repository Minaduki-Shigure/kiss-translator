import { CLIENT_SAFARI } from "./client";
import { OPT_TRANS_BUILTINAI, OPT_TRANS_LOCALAI } from "./apiConstants";

// The Safari build does not ship a local inference runtime or an external
// service-plugin host. Preserve imported settings; do not substitute remote APIs.
export function isApiTypeSupported(api) {
  if (process.env.REACT_APP_CLIENT !== CLIENT_SAFARI) return true;
  const type = typeof api === "string" ? api : api?.apiType;
  const kind =
    typeof api === "object" ? api?.provider?.implementation?.kind : undefined;
  return (
    ![OPT_TRANS_BUILTINAI, OPT_TRANS_LOCALAI, "Plugin"].includes(type) &&
    (!kind || kind === "native")
  );
}
