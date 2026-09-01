import { test } from "node:test";
import assert from "node:assert/strict";

import { hostEnv } from "./host-env.mjs";

test("the host's Claude Code and plugin settings never reach a case, and everything else does", () => {
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
  assert.ok(!("CLAUDE_CONFIG_DIR" in hostEnv(process.env)), "and it reads the process by default");
});
