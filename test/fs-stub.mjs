/**
 * A `node:fs` export replaced for the length of one call, in this process and
 * in every module that imported it by name.
 */
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";

/** Runs `call` with `fs[name]` replaced by `stub`, which is handed the real one. */
export function stubbed(name, stub, call) {
  const real = fs[name];
  fs[name] = (...args) => stub(real, ...args);
  syncBuiltinESMExports();
  try {
    return call();
  } finally {
    fs[name] = real;
    syncBuiltinESMExports();
  }
}
