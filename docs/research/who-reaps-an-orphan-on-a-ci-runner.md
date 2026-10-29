# Who reaps an orphan on a CI runner: systemd as PID 1, unless the closed agent above the runner is a subreaper

Research notes, October 2026. The test "a shard whose thread dies while a forked writer fills the paused
stdout lets the scan's process exit" (`test/ruby.test.mjs`) starts a `/bin/sh` stand-in for Ruby that
forks `yes` as a background writer. When the shard's thread exits, `killAndReap` in
`plugins/anatomiya/lib/ruby.mjs` destroys the stand-in's three pipes and then sends the stand-in
SIGKILL. The test then polled `kill(pid, 0)` for up to 5 seconds and wanted ESRCH for the writer. It
failed twice on the `ubuntu-latest` node 22 leg with the writer still answering. The working idea was
that the writer died of SIGPIPE and then stayed a zombie, because whatever adopted it did not reap it
in time. The test now reads the writer's state instead (the last section says how).

**Unconfirmed, and unlikely if PID 1 is the adopter.** The kernel gives an orphan to the nearest living
ancestor that called `PR_SET_CHILD_SUBREAPER`, and to PID 1 when there is none. No open-source program
between the writer and PID 1 makes that call: Node, bash, the runner and its .NET runtime were checked.
PID 1 on the hosted VM is systemd 259. It reaps every dead child, adopted ones included, on the next
pass of its event loop, and no timer or rate limit sits on that path. The blind spot is the
closed-source Hosted Compute Agent that starts the runner: no public source says whether it is a
subreaper. And `kill(pid, 0)` succeeds on a zombie and on a live process alike, so the failure cannot
say which of the two it saw.

Every claim below carries its source, in four kinds: **source**, code read at a named tag or commit;
**doc**, a man page, a standard or a first-party page, quoted, with its URL; **log**, this repository's
own CI job logs, read with `gh run view --job <id> --log`; **report**, a user's account in a public
issue, which is not a primary source and is marked wherever it is used.

The two failing jobs ran image `ubuntu-26.04` version 20261025.179.1, runner 2.338.0, Hosted Compute
Agent 20261021.618 and node 22.23.4 (**log**, the "Set up job" header and the setup-node output of
[job 123339242080](https://github.com/crisnahine/anatomiya/actions/runs/40841661903/job/123339242080)
and [job 123047536756](https://github.com/crisnahine/anatomiya/actions/runs/40753899145/job/123047536756)).
That image version has no tag of its own. The image readme at the tags on either side,
[ubuntu26/20261023.163](https://github.com/actions/runner-images/blob/c3c3ced4790b41080f2d1255ad684ab15d8ac660/images/ubuntu/Ubuntu2604-Readme.md)
and [ubuntu26/20261026.180](https://github.com/actions/runner-images/blob/e2ea192b4e85841e1fa6923606fa284af50dd7b6/images/ubuntu/Ubuntu2604-Readme.md),
lists kernel `7.0.0-1017-azure` at both and systemd `259.5-0ubuntu3.4` and `259.9-0ubuntu0.1`
(**source**). The systemd functions quoted below are identical at upstream v259.5 and v259.9
(**source**, compared). Upstream tags were read, not Ubuntu's patched packages.

## Summary

| Question | Answer | Source |
|---|---|---|
| Where an orphan goes | another live thread of the dead parent, else the nearest living ancestor subreaper in the same PID namespace, else that namespace's PID 1 | doc, source |
| Is anything between the writer and PID 1 a subreaper | nothing open-source; the Hosted Compute Agent cannot be read | source, log, report |
| Who is PID 1 | systemd 259, on a VM of its own | doc, source |
| How fast systemd reaps | on its next event-loop pass after the SIGCHLD; no delay or rate limit in the code, and no documented bound | source, doc |
| Does `kill(pid, 0)` see a zombie | yes, until it is reaped, and a live process too | doc, source |
| How long the test took when it passed | 121 to 439 ms in 13 passing legs, reap included | log |

## 1. Where the kernel sends an orphan

**doc**. [PR_SET_CHILD_SUBREAPER(2const)](https://man7.org/linux/man-pages/man2/PR_SET_CHILD_SUBREAPER.2const.html),
man-pages 6.19:

> A subreaper fulfills the role of init(1) for its descendant processes. When a process becomes
> orphaned (i.e., its immediate parent terminates), then that process will be reparented to the
> nearest still living ancestor subreaper.

and

> The setting of the "child subreaper" attribute is not inherited by children created by fork(2) and
> clone(2). The setting is preserved across execve(2).

**source**. `find_new_reaper` in [kernel/exit.c at v7.0](https://github.com/torvalds/linux/blob/v7.0/kernel/exit.c)
gives the order:

```c
/*
 * When we die, we re-parent all our children, and try to:
 * 1. give them to another thread in our thread group, if such a member exists
 * 2. give it to the first ancestor process which prctl'd itself as a
 *    child_subreaper for its children (like a service manager)
 * 3. give it to the init process (PID 1) in our pid namespace
 */
```

The ancestor walk starts at the dead parent's own parent, runs only when
`father->signal->has_child_subreaper` is set, and stops at the edge of the PID namespace. The stand-in
is a one-thread shell, so step 1 never applies. Whether the stand-in is itself a subreaper does not
matter either, because it is the process that died.

**source**. `reparent_leader` in the same file covers a writer that is already dead when the stand-in
dies: "If it has exited notify the new parent about this child's death." The adopter gets a SIGCHLD at
once for a zombie it inherits, and at the writer's exit for a live one.

**doc**. [wait(2)](https://man7.org/linux/man-pages/man2/wait.2.html), NOTES:

> If a parent process terminates, then its "zombie" children (if any) are adopted by init(1), (or by
> the nearest "subreaper" process as defined through the use of the prctl(2) PR_SET_CHILD_SUBREAPER
> operation); init(1) automatically performs a wait to remove the zombies.

## 2. What sits between the writer and PID 1

### The VM and its init

**doc**. [GitHub-hosted runners](https://docs.github.com/en/actions/concepts/runners/github-hosted-runners):
"With the exception of single-CPU runners, each GitHub-hosted runner is a new virtual machine (VM)
hosted by GitHub." The test job in `.github/workflows/ci.yml` names no `container:`, so its steps run on
that VM.

**source**. The image build stops and disables units with `systemctl`
([configure-apt.sh](https://github.com/actions/runner-images/blob/e2ea192b4e85841e1fa6923606fa284af50dd7b6/images/ubuntu/scripts/build/configure-apt.sh)),
and the readme lists the systemd version. PID 1 on the VM is systemd.

### The chain

From the writer up, as this repository and the runner start them:

1. the `/bin/sh` stand-in that `stubRuby` writes in `test/ruby.test.mjs`, the process that is
   SIGKILLed;
2. the scan's `node`, started by the test's `execFileSync`;
3. the test file's `node`, because `node --test` runs each file in a child process by default
   ([Node 22 CLI](https://nodejs.org/docs/latest-v22.x/api/cli.html), `--experimental-test-isolation`:
   "The default isolation mode is 'process'.");
4. `node --test`, run by the "Run the suite" step;
5. the step's `bash`, started by the worker's step host through `ProcessInvoker` and
   `System.Diagnostics.Process`
   ([StepHost.cs](https://github.com/actions/runner/blob/v2.338.0/src/Runner.Worker/Handlers/StepHost.cs),
   [ProcessInvoker.cs](https://github.com/actions/runner/blob/v2.338.0/src/Runner.Sdk/ProcessInvoker.cs),
   both at v2.338.0);
6. `Runner.Worker`, started by `Runner.Listener` through the same invoker
   ([JobDispatcher.cs at v2.338.0](https://github.com/actions/runner/blob/v2.338.0/src/Runner.Listener/JobDispatcher.cs));
7. `Runner.Listener`, started by the Hosted Compute Agent (below);
8. PID 1.

### No open-source link in the chain calls PR_SET_CHILD_SUBREAPER

**source**. actions/runner at [v2.338.0](https://github.com/actions/runner/tree/v2.338.0):
`git grep -i -E "prctl|subreaper|waitpid|PR_SET_|zombie"` over `src` finds one line, a comment about a
"zombie worker" that means a worker process that will not exit. The only `libc` imports are `kill`, in
[ProcessInvoker.cs](https://github.com/actions/runner/blob/v2.338.0/src/Runner.Sdk/ProcessInvoker.cs),
and `socket`, in
[VSockSecretNotifier.cs](https://github.com/actions/runner/blob/v2.338.0/src/Runner.Common/VSockSecretNotifier.cs).

**source**. The runner targets `net8.0` with SDK 8.0.425
([global.json](https://github.com/actions/runner/blob/v2.338.0/src/global.json)). .NET 8's process
and signal shims,
[pal_process.c](https://github.com/dotnet/runtime/blob/80c68f487bfc00665064c792f7ac9644b28bfe45/src/native/libs/System.Native/pal_process.c)
and [pal_signal.c](https://github.com/dotnet/runtime/blob/80c68f487bfc00665064c792f7ac9644b28bfe45/src/native/libs/System.Native/pal_signal.c)
on `release/8.0`, call no `prctl` at all.

**source**. bash at savannah commit
[9c465866](https://git.savannah.gnu.org/cgit/bash.git/tree/?id=9c465866b7d849378369ef700cbe2965aa9691e3)
(5.3 patch 20; the image ships 5.3.9) holds no `prctl` and no `subreaper` anywhere in its tree.

**source**. A GitHub code search of the default branches finds no `SUBREAPER` in
[nodejs/node](https://github.com/search?q=repo%3Anodejs%2Fnode+SUBREAPER&type=code) or
[libuv/libuv](https://github.com/search?q=repo%3Alibuv%2Flibuv+SUBREAPER&type=code). The same search
finds `prctl` in 8 nodejs/node files, `uv_spawn` in 23 libuv files and `PR_SET_CHILD_SUBREAPER` in
systemd's `process-util.c`, so the empty answers do not come from unindexed repositories. A search is
weaker than a read: it shows the name is absent from the indexed branch, not from the node 22.23.4
build itself.

### The agent that starts the runner is closed

**log**. Both failing jobs open with "Runner Image Provisioner", "Hosted Compute Agent", "Version:
20261021.618" in their "Set up job" header.

**source**. On Ubuntu 24.04 the image tells needrestart never to restart a service whose name starts
`runner-provisioner`. Its
[configure-system.sh](https://github.com/actions/runner-images/blob/e2ea192b4e85841e1fa6923606fa284af50dd7b6/images/ubuntu/scripts/build/configure-system.sh)
says "Prevent needrestart from restarting the provisioner service." and adds the entry
`qr(^runner-provisioner) => 0` to needrestart's config. That is the shape of an `override_rc` entry,
which upstream documents as "Override service default selection (hash of regex)"
([needrestart.conf](https://github.com/liske/needrestart/blob/7d57c2ce5348a6a59e2da00beab9d635d4bdea7d/ex/needrestart.conf)).
The rule runs only under `is_ubuntu24`, so the image source does not name the service on 26.04. The
change, [PR #9979](https://github.com/actions/runner-images/pull/9979), fixed
[issue #9937](https://github.com/actions/runner-images/issues/9937).

**report**. The job log pasted in issue #9937 shows `systemctl restart packagekit.service
php8.3-fpm.service runner-provisioner.service ...` and then "Error: The operation was canceled." So
on 24.04 the runner lived inside a systemd system service, and restarting that service ended the job.

**report**. [Issue #14789](https://github.com/actions/runner-images/issues/14789), a user's snapshot
from inside a job on an Ubuntu 24.04 larger runner in September 2026, lists `hosted-compute-agent`
among the system services and gives the runner tree as hca, then `Runner.Listener`, then
`Runner.Worker`.

A repository search finds no public source for the agent. So whether it calls
`PR_SET_CHILD_SUBREAPER`, and how it treats children it did not start, cannot be read.

### A user manager would be a subreaper, but nothing puts it in the chain

**source**. Every systemd manager that is not PID 1 makes itself a subreaper. `initialize_runtime` in
[main.c at v259.9](https://github.com/systemd/systemd/blob/v259.9/src/core/main.c) calls
`make_reaper_process(true)` for the system and the user scope alike, and
[process-util.c](https://github.com/systemd/systemd/blob/v259.9/src/basic/process-util.c) turns that
into the prctl unless the caller is PID 1:

```c
int make_reaper_process(bool b) {

        if (getpid_cached() == 1) {
                ...
                return 0;
        }
        ...
        if (prctl(PR_SET_CHILD_SUBREAPER, (unsigned long) b, 0UL, 0UL, 0UL) < 0)
                return -errno;
```

**source**, **doc**. The image ships
[systemd-linger.sh](https://github.com/actions/runner-images/blob/e2ea192b4e85841e1fa6923606fa284af50dd7b6/images/ubuntu/assets/post-gen/systemd-linger.sh),
which runs `loginctl enable-linger` for the last user in `/etc/passwd`. [loginctl(1)](https://www.freedesktop.org/software/systemd/man/latest/loginctl.html)
says lingering means "a user manager is spawned for the user at boot and kept around after logouts".
The image docs present the post-generation scripts as a step to run after deploying a VM
([create-image-and-azure-resources.md](https://github.com/actions/runner-images/blob/e2ea192b4e85841e1fa6923606fa284af50dd7b6/docs/create-image-and-azure-resources.md));
whether GitHub's own fleet runs them is not stated. Such a manager is a separate tree under PID 1. It
adopts the writer only if the runner runs inside it, and the evidence above, all of it from 24.04,
puts the runner under a system service.

## 3. How fast systemd reaps

**source**. `manager_setup_signals` in
[manager.c at v259.9](https://github.com/systemd/systemd/blob/v259.9/src/core/manager.c) keeps the
default action for SIGCHLD, blocks it, and reads it from a `signalfd`:

```c
        static const struct sigaction sa = {
                .sa_handler = SIG_DFL,
                .sa_flags = SA_NOCLDSTOP|SA_RESTART,
        };
```

**source**. The kernel skips the zombie state only when the parent's SIGCHLD is `SIG_IGN` or carries
`SA_NOCLDWAIT` (`do_notify_parent` in
[kernel/signal.c at v7.0](https://github.com/torvalds/linux/blob/v7.0/kernel/signal.c)). systemd sets
neither, so a child it adopted stays a zombie until systemd waits on it.

**source**. A SIGCHLD makes `manager_dispatch_signal_fd` turn on the `manager-sigchld` defer source.
`manager_dispatch_sigchld` then peeks at one dead child without reaping it, looks for the units that
own it, and reaps it:

```c
        if (waitid(P_ALL, 0, &si, WEXITED|WNOHANG|WNOWAIT) < 0) {
        ...
                else if (n_array == 0)
                        log_debug("Got SIGCHLD for process " PID_FMT " we weren't interested in, ignoring.", si.si_pid);
        ...
        /* And now, we actually reap the zombie. */
        if (waitid(P_PID, si.si_pid, &si, WEXITED) < 0) {
```

An adopted orphan is the "we weren't interested in" case: no unit claims it, and it is reaped all the
same. The source reaps one child per pass and stays on until the peek finds none.
`manager_setup_sigchld_event_source` creates it as a defer source, gives it a priority and a
description, and leaves it off; nothing sets a timer or a rate limit on it. Its priority is
`SD_EVENT_PRIORITY_NORMAL-4`
([manager.h](https://github.com/systemd/systemd/blob/v259.9/src/core/manager.h)). The D-Bus
connections attach at `EVENT_PRIORITY_IPC`
([dbus.c](https://github.com/systemd/systemd/blob/v259.9/src/core/dbus.c)), which is
`SD_EVENT_PRIORITY_NORMAL`.

**doc**. [sd_event_source_set_priority(3)](https://www.freedesktop.org/software/systemd/man/latest/sd_event_source_set_priority.html):
"Event sources with smaller priority values are dispatched first." So a pending reap goes ahead of
D-Bus work.

**doc**. The systemd pages read for this note,
[systemd(1)](https://www.freedesktop.org/software/systemd/man/latest/systemd.html),
user@.service(5), systemd.service(5), systemd.kill(5) and loginctl(1), say nothing about reaping, and
wait(2) says only that init "automatically performs a wait". No source read gives a time bound. A
zombie waits for PID 1's event loop to come round, and a PID 1 that is blocked or short of CPU makes it
wait longer.

**log**. In the passing legs read, all on the failing jobs' agent and 11 of 13 on their image, the
whole test took 121 to 345 ms in the 6 node 22 legs and 175 to 439 ms in the 7 node 24 legs. Whatever
reaped the writer in those runs had done it by then.

## 4. What `kill(pid, 0)` sees

**doc**. [kill(2)](https://man7.org/linux/man-pages/man2/kill.2.html): "If sig is 0, then no signal
is sent, but existence and permission checks are still performed; this can be used to check for the
existence of a process ID or process group ID that the caller is permitted to signal."

**doc**. [POSIX.1-2024, kill()](https://pubs.opengroup.org/onlinepubs/9799919799/functions/kill.html),
RATIONALE:

> Since the definition of process lifetime in this volume of POSIX.1-2024 covers zombie processes, the
> [ESRCH] error as described is inappropriate in this case and implementations that give this error do
> not conform. This means that an application cannot have a parent process check for termination of a
> particular child by sending it the null signal with kill(), but must instead use waitpid() or
> waitid().

**source**. Linux does the same. `kill_pid_info_type` in
[kernel/signal.c](https://github.com/torvalds/linux/blob/v7.0/kernel/signal.c) finds the task with
`pid_task(pid, PIDTYPE_PID)`, and `group_send_sig_info` runs only the permission check for signal 0
(`if (!ret && sig)`). The PID is detached in `__unhash_process`
([kernel/exit.c](https://github.com/torvalds/linux/blob/v7.0/kernel/exit.c)), which runs from
`release_task`, at reap. So `kill(pid, 0)` succeeds on a live writer and on a dead, unreaped one. The
test's own `exists` helper says so: "only a reaped child is gone".

**doc**. [proc_pid_stat(5)](https://man7.org/linux/man-pages/man5/proc_pid_stat.5.html) tells them
apart: field 3, the state, is `Z` for a zombie, and field 4 is the parent's PID.

## 5. When the adopter matters at all

**source**, this repository. When a shard's thread exits, the parent runs `killAndReap` on each child
it started for that thread (`plugins/anatomiya/lib/ruby.mjs`). It destroys the child's pipes and only
then sends SIGKILL (`signalChild` in `plugins/anatomiya/lib/child.mjs`, to the stand-in's PID alone).
That leaves a race no source settles. If the writer dies first, the stand-in is still in `wait` and may
reap it itself, and no adopter is involved. If the SIGKILL lands first, or the stand-in dies before it
reaps, the writer goes to the adopter, alive or as a zombie, and the adopter gets the SIGCHLD
(section 1).

**log**. 15 ubuntu legs from 8 runs on 2026-10-28 and 2026-10-29 were read. The test failed in 2 of 8
node 22 legs and 0 of 7 node 24 legs. Both failures and five of the six passing node 22 legs ran the
same image (20261025.179.1), agent (20261021.618) and node (22.23.4). The failures took 5,744 and
5,813 ms, so roughly 0.7 to 0.8 s went by before the 5 s poll began. That is longer than any whole
passing run, so those two runs were already slow before the reap could matter. `node --test` runs up to
`os.availableParallelism() - 1` files at once
([Node 22 CLI](https://nodejs.org/docs/latest-v22.x/api/cli.html), `--test-concurrency`), and a
standard Linux runner for a public repository has 4 CPUs
([runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)), so
other test files share the VM while this one runs.

**log**, **source**. The runner's own job-end sweep adds nothing. Each log ends with "Cleaning up
orphan processes" and no "Terminate orphan process" line. That sweep matches leftovers by
`RUNNER_TRACKING_ID` and kills them
([JobExtension.cs at v2.338.0](https://github.com/actions/runner/blob/v2.338.0/src/Runner.Worker/JobExtension.cs)),
and the test's `finally` had already sent the writer SIGKILL.

## What this means for the test

On `ubuntu-latest` the orphaned writer goes to systemd as PID 1, unless the closed-source Hosted
Compute Agent above the runner made itself a subreaper; no open-source program in between does.
systemd reaps an adopted child on its next event-loop pass with no deliberate delay, and in the passing
runs the whole test, reap included, took under half a second. So the sources do not predict a
5-second zombie, but they cannot rule one out: a stalled PID 1 or an agent that reaps late would both
produce it, and `kill(pid, 0)` cannot tell either case from a writer that never died.

- The test asked for more than its message said. ESRCH means reaped, and the reaper is not the test's
  to control. A writer in state `Z` has already died on the closed pipe, so the test now reads the
  state with `ps -o stat=` and counts `Z` as dead, which takes the adopter out of the test. `ps` is
  used in place of `/proc/<pid>/stat` because the test runs on macOS too, and there a pid `ps` cannot
  find exits 1 with nothing on stderr, as it does on Linux.
- A failure now names the state in its message. Any state but `Z` means the writer was alive, and
  the working idea is wrong. Who adopted it matters only for a zombie, which no longer fails.

## What could not be established

- Whether the Hosted Compute Agent calls `PR_SET_CHILD_SUBREAPER`, and whether it reaps children it
  did not start. No public source was found, and the image source names its service only for 24.04.
- The runner's process tree on 26.04. The only tree seen is a user's report from 24.04.
- That a job's PID namespace is the VM's own. The job names no container, and the same report saw
  system services from inside a job, but no source states it.
- Whether PID 1 stalled during the two failures. The job logs carry no timing for it.
- How often the stand-in wins the race and reaps the writer itself.
- Whether the writer had died at all. The path from the closed pipe to its SIGPIPE was not traced.
- Ubuntu's patches to kernel `7.0.0-1017-azure` and to systemd 259. The upstream tags were read.

## Reproduce

```sh
# The runner at the version CI ran: one comment, and no prctl, subreaper or waitpid, in src
git clone -q --depth 1 https://github.com/actions/runner && cd runner
git fetch -q --depth 1 origin tag v2.338.0
git grep -i -E "prctl|subreaper|waitpid|PR_SET_|zombie" v2.338.0 -- src

# systemd's reaping path
gh api "repos/systemd/systemd/contents/src/core/manager.c?ref=v259.9" \
  -H "Accept: application/vnd.github.raw" | grep "waitid\|weren't interested"

# The test's result and duration in one CI leg
gh run view --job 123339242080 --log | grep -A3 "forked writer fills"
```

## Sources

Linux and POSIX:

- man-pages 6.19 at man7.org, read on 2026-10-29:
  [PR_SET_CHILD_SUBREAPER(2const)](https://man7.org/linux/man-pages/man2/PR_SET_CHILD_SUBREAPER.2const.html),
  [wait(2)](https://man7.org/linux/man-pages/man2/wait.2.html),
  [kill(2)](https://man7.org/linux/man-pages/man2/kill.2.html),
  [proc_pid_stat(5)](https://man7.org/linux/man-pages/man5/proc_pid_stat.5.html)
- The Open Group, [POSIX.1-2024 kill()](https://pubs.opengroup.org/onlinepubs/9799919799/functions/kill.html),
  RATIONALE
- Linux v7.0: [kernel/exit.c](https://github.com/torvalds/linux/blob/v7.0/kernel/exit.c)
  (`find_new_reaper`, `reparent_leader`, `__unhash_process`) and
  [kernel/signal.c](https://github.com/torvalds/linux/blob/v7.0/kernel/signal.c)
  (`do_notify_parent`, `kill_pid_info_type`, `group_send_sig_info`)

systemd:

- v259.9: [src/core/main.c](https://github.com/systemd/systemd/blob/v259.9/src/core/main.c)
  (`initialize_runtime`), [src/basic/process-util.c](https://github.com/systemd/systemd/blob/v259.9/src/basic/process-util.c)
  (`make_reaper_process`), [src/core/manager.c](https://github.com/systemd/systemd/blob/v259.9/src/core/manager.c)
  (`manager_setup_signals`, `manager_setup_sigchld_event_source`, `manager_dispatch_signal_fd`,
  `manager_dispatch_sigchld`), [src/core/manager.h](https://github.com/systemd/systemd/blob/v259.9/src/core/manager.h)
  (event priorities), [src/core/dbus.c](https://github.com/systemd/systemd/blob/v259.9/src/core/dbus.c)
  (`sd_bus_attach_event`); the reaping functions compared unchanged at v259.5
- the pages for systemd 262 at freedesktop.org, read on 2026-10-29:
  [systemd(1)](https://www.freedesktop.org/software/systemd/man/latest/systemd.html),
  [loginctl(1)](https://www.freedesktop.org/software/systemd/man/latest/loginctl.html),
  [sd_event_source_set_priority(3)](https://www.freedesktop.org/software/systemd/man/latest/sd_event_source_set_priority.html),
  [user@.service(5)](https://www.freedesktop.org/software/systemd/man/latest/user@.service.html),
  [systemd.service(5)](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html),
  [systemd.kill(5)](https://www.freedesktop.org/software/systemd/man/latest/systemd.kill.html)

GitHub Actions:

- actions/runner v2.338.0:
  [JobExtension.cs](https://github.com/actions/runner/blob/v2.338.0/src/Runner.Worker/JobExtension.cs),
  [ProcessInvoker.cs](https://github.com/actions/runner/blob/v2.338.0/src/Runner.Sdk/ProcessInvoker.cs),
  [StepHost.cs](https://github.com/actions/runner/blob/v2.338.0/src/Runner.Worker/Handlers/StepHost.cs),
  [JobDispatcher.cs](https://github.com/actions/runner/blob/v2.338.0/src/Runner.Listener/JobDispatcher.cs),
  [VSockSecretNotifier.cs](https://github.com/actions/runner/blob/v2.338.0/src/Runner.Common/VSockSecretNotifier.cs),
  [global.json](https://github.com/actions/runner/blob/v2.338.0/src/global.json)
- actions/runner-images at ubuntu26/20261026.180, commit e2ea192b:
  [configure-system.sh](https://github.com/actions/runner-images/blob/e2ea192b4e85841e1fa6923606fa284af50dd7b6/images/ubuntu/scripts/build/configure-system.sh),
  [configure-apt.sh](https://github.com/actions/runner-images/blob/e2ea192b4e85841e1fa6923606fa284af50dd7b6/images/ubuntu/scripts/build/configure-apt.sh),
  [systemd-linger.sh](https://github.com/actions/runner-images/blob/e2ea192b4e85841e1fa6923606fa284af50dd7b6/images/ubuntu/assets/post-gen/systemd-linger.sh),
  [create-image-and-azure-resources.md](https://github.com/actions/runner-images/blob/e2ea192b4e85841e1fa6923606fa284af50dd7b6/docs/create-image-and-azure-resources.md),
  [Ubuntu2604-Readme.md](https://github.com/actions/runner-images/blob/e2ea192b4e85841e1fa6923606fa284af50dd7b6/images/ubuntu/Ubuntu2604-Readme.md);
  and [Ubuntu2604-Readme.md](https://github.com/actions/runner-images/blob/c3c3ced4790b41080f2d1255ad684ab15d8ac660/images/ubuntu/Ubuntu2604-Readme.md)
  at ubuntu26/20261023.163, commit c3c3ced4
- runner-images [PR #9979](https://github.com/actions/runner-images/pull/9979) and
  [issue #9937](https://github.com/actions/runner-images/issues/9937); [issue #14789](https://github.com/actions/runner-images/issues/14789)
  (report)
- liske/needrestart [ex/needrestart.conf](https://github.com/liske/needrestart/blob/7d57c2ce5348a6a59e2da00beab9d635d4bdea7d/ex/needrestart.conf)
- GitHub docs, read on 2026-10-29: [GitHub-hosted runners](https://docs.github.com/en/actions/concepts/runners/github-hosted-runners)
  and the [runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)

The other programs in the chain:

- dotnet/runtime `release/8.0` at 80c68f48:
  [pal_process.c](https://github.com/dotnet/runtime/blob/80c68f487bfc00665064c792f7ac9644b28bfe45/src/native/libs/System.Native/pal_process.c),
  [pal_signal.c](https://github.com/dotnet/runtime/blob/80c68f487bfc00665064c792f7ac9644b28bfe45/src/native/libs/System.Native/pal_signal.c)
- bash at savannah [9c465866](https://git.savannah.gnu.org/cgit/bash.git/tree/?id=9c465866b7d849378369ef700cbe2965aa9691e3)
- GitHub code search of the nodejs/node and libuv/libuv default branches, 2026-10-29
- [Node.js 22 CLI](https://nodejs.org/docs/latest-v22.x/api/cli.html), `--experimental-test-isolation`
  and `--test-concurrency`

This repository:

- `test/ruby.test.mjs` (the test, `stubRuby`, `exists`), `plugins/anatomiya/lib/ruby.mjs`
  (`killAndReap`, `startFor`), `plugins/anatomiya/lib/child.mjs` (`signalChild`),
  `.github/workflows/ci.yml`
- CI jobs: the failures [123339242080](https://github.com/crisnahine/anatomiya/actions/runs/40841661903/job/123339242080)
  and [123047536756](https://github.com/crisnahine/anatomiya/actions/runs/40753899145/job/123047536756);
  the passing legs of runs 40837041309, 40781424982, 40773863592, 40746039690, 40722654265 and
  40706772706, and the node 24 leg of run 40841661903
