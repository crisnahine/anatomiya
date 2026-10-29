// node:path for the find demo in a browser, where the page's import map sends that specifier.
// find.mjs loads paths.mjs for its byCode comparator, and nothing the demo calls reaches node:path:
// a call that ever does throws here rather than answer wrong.
const absent = () => {
  throw new Error("node:path is not available in a browser");
};
const stand = new Proxy({}, { get: () => absent });

export const posix = stand;
export const win32 = stand;
export const sep = "/";
