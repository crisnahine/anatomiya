/**
 * Skips for invariants that cannot be set up on this platform.
 *
 * Windows forbids a newline in a filename outright, so the hostile-path
 * fixtures cannot be written there at all. The defence still matters on the
 * systems where the input is possible, and a test that cannot create its own
 * input proves nothing about the code either way.
 */
export const WINDOWS = process.platform === "win32";

export const needsPosixPaths = WINDOWS
  ? { skip: "Windows does not allow a newline in a filename, so the fixture cannot exist" }
  : {};

export const needsShebang = WINDOWS
  ? { skip: "Windows does not execute a shebang, so the stub interpreter cannot run" }
  : {};

// `chmod` on Windows moves the read-only attribute and nothing else, so a file
// this test needs to be unreadable stays readable and the case proves the
// opposite of what it says.
export const needsPosixPermissions = WINDOWS
  ? { skip: "Windows chmod only toggles read-only, so a file cannot be made unreadable" }
  : {};
