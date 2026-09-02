/**
 * Skips for invariants that cannot be set up on this platform.
 *
 * Windows forbids a newline in a filename outright, so the hostile-path
 * fixtures cannot be written there at all. The defence still matters on the
 * systems where the input is possible, and a test that cannot create its own
 * input proves nothing about the code either way.
 */
import { tmpdir } from "node:os";
import { join } from "node:path";

const WINDOWS = process.platform === "win32";

/**
 * Skips this run could have avoided, by the name of the guard that took them.
 *
 * A guard the platform refuses says nothing new: the case can never run there.
 * One this run's own configuration refuses is coverage lost with nothing said,
 * and a green suite then reads as though the case ran. Naming them lets a test
 * refuse the silence.
 */
export const AVOIDABLE = new Map();

function avoidable(guard, reason) {
  AVOIDABLE.set(guard, reason);
  return { skip: reason };
}

// `os.tmpdir()` reads TMPDIR only where POSIX spells it that way, so a case
// that hands a child a different temp directory has nothing to hand on Windows.
export const needsTmpdirVariable = WINDOWS
  ? { skip: "Windows reads TEMP and TMP rather than TMPDIR, so this is not the control the case needs" }
  : {};

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

/**
 * Whether a socket can be bound under a temp directory of this machine's.
 *
 * `sun_path` is 104 bytes on macOS and 108 on Linux, and the cap is on the
 * whole path: under a long `TMPDIR` every `mkdtemp` directory truncates to one
 * socket path and the second bind answers EADDRINUSE. The length is the run's
 * to choose, so it is avoidable rather than a fact about the platform.
 */
const SOCKET_PATH_MOST = 100;
const socketPathBytes = Buffer.byteLength(join(tmpdir(), "anatomiya-write-XXXXXX", ".claude", "rules", "sock.md"));
export const needsBindableSocketPath = WINDOWS
  ? { skip: "Windows has no filesystem-visible unix socket to bind under a temp directory" }
  : socketPathBytes > SOCKET_PATH_MOST
    ? avoidable(
        "needsBindableSocketPath",
        `a socket path under ${tmpdir()} takes ${socketPathBytes} bytes, past the ${SOCKET_PATH_MOST} a unix socket allows: run with TMPDIR set to a shorter directory`
      )
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

// Windows creates a symlink only for an administrator or with developer mode
// on, so a test whose fixture is a symlink cannot build its own input there.
export const needsSymlinks = WINDOWS
  ? { skip: "Windows needs a privilege this run may not have to create a symlink" }
  : {};

// npm ships on Windows as `npm.cmd` with no `npm.exe`, a spawn resolves an
// extension-less name against `.com` and `.exe` only, and running a batch file
// needs the shell nothing here spawns. The gate these cases drive runs on the
// Linux job, so what is lost here is coverage rather than the check.
export const needsSpawnableNpm = WINDOWS
  ? { skip: "npm on Windows is a batch file, and running one needs a shell no command here may spawn" }
  : {};
