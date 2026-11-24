const releases = "https://github.com/Minaduki-Shigure/kiss-translator/releases";
const stableVersion =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-safari\.([1-9]\d*)$/;

export function parseSafariVersion(version) {
  if (typeof version !== "string" || version.length > 72) return null;
  const match = stableVersion.exec(version);
  if (!match || match[0] !== version) return null;
  const parts = match.slice(1).map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

export function isNewerSafariVersion(remote, installed) {
  const a = parseSafariVersion(remote);
  const b = parseSafariVersion(installed);
  if (!a || !b) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

export function safariReleaseURL(version) {
  return parseSafariVersion(version)
    ? `${releases}/tag/safari-${version}`
    : undefined;
}

export async function fetchLatestSafariVersion({ signal } = {}) {
  const response = await fetch(
    `${releases}/latest/download/safari-version.txt`,
    {
      signal,
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    }
  );
  if (!response.ok)
    throw new Error(`Safari version request failed: ${response.status}`);
  // Release assets may end in a single LF or CRLF. Ignore no other content.
  const version = (await response.text()).replace(/\r?\n$/, "");
  if (!parseSafariVersion(version))
    throw new Error("Invalid Safari release marker");
  return version;
}
