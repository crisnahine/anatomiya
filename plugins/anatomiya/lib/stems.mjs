/**
 * A stem's words: delimiters and camel humps both split, and an acronym stays
 * one word. Splitting before every capital read `HTTPClient` as h,t,t,p,client
 * and `API` as a,p,i, so src/API.ts, APIClient.ts and HTTPClient.ts were not
 * the implementing module and `import API from "./API"` was not a wrapper. A
 * hump is a lower-case letter or digit before a capital, or a capital before a
 * capital that starts a lower-case word (`HTTP|Client`).
 */
export function stemWords(stem) {
  return stem
    .split(/[-_.]/)
    .flatMap((w) => w.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/))
    .map((w) => w.toLowerCase())
    .filter(Boolean);
}

export const CAPABILITY_WORDS = {
  logging: new Set(["log", "logger", "logging"]),
  network: new Set(["client", "http", "api", "request", "fetcher"]),
  env: new Set(["config", "env", "settings"]),
};

export const fileStem = (rel) => {
  const base = rel.slice(rel.lastIndexOf("/") + 1);
  const dot = base.indexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
};
