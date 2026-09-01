import { test } from "node:test";
import assert from "node:assert/strict";

import { hostEnv } from "./host-env.mjs";

test("the host's Claude Code and plugin settings never reach a case, and everything else does", (t) => {
  const given = {
    PATH: "p",
    HOME: "h",
    OTHER: "1",
    CLAUDE_CONFIG_DIR: "/x",
    CLAUDE_CODE_DISABLE_WORKFLOWS: "1",
    CLAUDE_CODE_EXECPATH: "/cli",
    ULTRACODE_ANYWHERE: "0",
    ULTRACODE_ANYWHERE_STAGE_EFFORT: "medium",
  };

  assert.deepEqual(hostEnv(given), { PATH: "p", HOME: "h", OTHER: "1" });

  // The default reads the process, held to a name this case puts there so the
  // assertion cannot pass on a machine that never set one.
  process.env.CLAUDE_CODE_HOST_ENV_PROBE = "1";
  t.after(() => delete process.env.CLAUDE_CODE_HOST_ENV_PROBE);
  assert.ok(!("CLAUDE_CODE_HOST_ENV_PROBE" in hostEnv()));
  assert.ok("PATH" in hostEnv());
});
