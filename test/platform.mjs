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

// Windows spells the variable `Path` and looks it up case-insensitively, so a
// child handed a second `PATH` key may search either one. A test that cannot
// decide what a child can find proves nothing about what it did.
export const needsPathControl = WINDOWS
  ? { skip: "Windows resolves PATH case-insensitively, so a replaced one is not the control this needs" }
  : {};

// The inverse of the guards above, and the only one of its kind: a refusal that
// exists because of what Windows cannot do can only be proved on Windows.
export const needsWindows = WINDOWS
  ? {}
  : { skip: "the Windows refusal cannot fire on a platform where npm can be spawned" };

// `chmod` on Windows moves the read-only attribute and nothing else, so a file
// this test needs to be unreadable stays readable and the case proves the
// opposite of what it says.
export const needsPosixPermissions = WINDOWS
  ? { skip: "Windows chmod only toggles read-only, so a file cannot be made unreadable" }
  : {};

// A containment test joins with the platform separator, so a fixture spelled
// `/corpus` is a relative Windows path under whatever drive the run is on and
// is contained by nothing.
export const needsPosixSeparators = WINDOWS
  ? { skip: "Windows paths carry a drive letter and a backslash separator, so a POSIX fixture path is inside nothing" }
  : {};

// A fifo or a unix socket in a directory is a shape only POSIX can make.
export const needsPosixSpecialFiles = WINDOWS
  ? { skip: "Windows has no mkfifo and no filesystem-visible unix socket to test with" }
  : {};

// A directory mode of 000 is not a permission denial for a superuser, and CI
// commonly runs as one, so a test that needs the denial cannot prove anything
// where it does not happen.
export const needsUnreadableDirs = WINDOWS
  ? { skip: "Windows does not deny a directory by POSIX mode, so the fixture cannot exist" }
  : typeof process.getuid === "function" && process.getuid() === 0
    ? { skip: "root traverses a mode-000 directory, so the denial this needs cannot happen" }
    : {};

// Windows holds a lock on the directory a process is running in, so the state
// this needs, a live process whose own cwd has been removed, cannot be reached
// there at all.
export const needsRemovableCwd = WINDOWS
  ? { skip: "Windows locks a process's own directory, so it cannot be removed under it" }
  : {};
