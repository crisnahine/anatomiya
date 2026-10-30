// The page's import map sends node:path here: paths.mjs imports it for a function the find demo never calls.
const throwing = () => {
  throw new Error("node:path is not available in a browser");
};
const standIn = new Proxy({}, { get: () => throwing });

export const posix = standIn;
export const win32 = standIn;
export const sep = "/";
