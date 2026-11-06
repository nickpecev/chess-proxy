const SUFFIXES = ["chess.com", "chesscomfiles.com"];
const EXACT = new Set(["challenges.cloudflare.com"]);
const DEFAULT_HOSTS = new Set(["www.chess.com", "chess.com"]);

export function isAllowedHost(input) {
  if (typeof input !== "string") return false;
  const host = input.trim().toLowerCase().replace(/\.$/, "");
  if (host.length === 0 || host.length > 253) return false;
  if (!/^[a-z0-9.-]+$/.test(host)) return false;
  if (host.includes("..")) return false;
  const labels = host.split(".");
  if (
    labels.some(
      (label) =>
        label.length === 0 ||
        label.length > 63 ||
        label.startsWith("-") ||
        label.endsWith("-"),
    )
  ) {
    return false;
  }
  if (EXACT.has(host)) return true;
  return SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

export function isDefaultHost(input) {
  return DEFAULT_HOSTS.has(String(input || "").trim().toLowerCase().replace(/\.$/, ""));
}

export function clientAllowlist() {
  return {
    suffixes: SUFFIXES,
    exact: [...EXACT],
    defaults: [...DEFAULT_HOSTS],
    prefix: "/_c",
  };
}
