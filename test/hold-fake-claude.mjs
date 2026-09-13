/**
 * A stand-in for the claude binary that the hold's self-check and shadow capture
 * start, run as `node hold-fake-claude.mjs <claude's own arguments>`.
 *
 * It talks to the stand-in API the way a session does, closely enough for the
 * check to classify what it sees: a main-loop request carrying the prompt it was
 * given and the Agent tool's listing, a subagent request when the answer asks
 * for a spawn, and the main loop's follow-up with the tool's result. What it
 * does is steered by `FAKE_CLAUDE_*` variables, read here and nowhere in the
 * plugin.
 */
const base = process.env.ANTHROPIC_BASE_URL;
const args = process.argv.slice(2);
const prompt = args[args.indexOf("-p") + 1] ?? "";
const spawnEffort = process.env.FAKE_CLAUDE_SPAWN_EFFORT ?? "medium";

if (args[0] === "--version") {
  process.stdout.write(`${process.env.FAKE_CLAUDE_VERSION ?? "2.1.999"} (Claude Code)\n`);
  process.exit(0);
}

async function post(body, beta = "context-1m-2025-08-07") {
  const response = await fetch(`${base}/v1/messages?beta=true`, {
    method: "POST",
    headers: { "content-type": "application/json", "anthropic-beta": beta },
    body: JSON.stringify(body),
  });
  return response.text();
}

const listing = "Available agent types for the Agent tool:\n- general-purpose: Anything at all. (Tools: *)\n- Plan: Plans work. (Tools: All tools except Edit, Agent)\n- kit:checker: Checks. (Tools: Read)\n\nWhen you launch";
const first = await post({
  model: "claude-opus-5",
  system: [{ type: "text", text: "x-anthropic-billing-header: cc_version=2.1.999;" }],
  messages: [{ role: "user", content: [{ type: "text", text: `${listing}\n\n${prompt}` }] }],
  tools: [{ name: "Agent" }, { name: "Bash" }],
  output_config: { effort: "xhigh" },
});

const type = /\\?"subagent_type\\?":\\?"([^"\\]+)/.exec(first)?.[1];
if (first.includes("tool_use") && process.env.FAKE_CLAUDE_SPAWNS !== "0") {
  await post({
    model: "claude-opus-5",
    system: [
      { type: "text", text: "x-anthropic-billing-header: cc_version=2.1.999; cc_is_subagent=true;" },
      { type: "text", text: `The prompt of ${type ?? "an agent"}.\n\nMessages from the agent that launched you follow.` },
    ],
    messages: [{ role: "user", content: "say ok" }],
    tools: [{ name: "Bash" }],
    output_config: { effort: spawnEffort },
  });
}
await post({
  model: "claude-opus-5",
  system: [{ type: "text", text: "x-anthropic-billing-header: cc_version=2.1.999;" }],
  messages: [
    { role: "user", content: prompt },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_main", is_error: process.env.FAKE_CLAUDE_REFUSED ? true : undefined, content: process.env.FAKE_CLAUDE_REFUSED ?? "done" }] },
  ],
  tools: [{ name: "Agent" }],
  output_config: { effort: "xhigh" },
});
await fetch(`${base}/v1/messages/count_tokens`, { method: "POST", body: "{}" });
await fetch(`${base}/api/hello`);
process.stdout.write(first.includes("tool_use") ? "saw a tool call\n" : "saw text\n");
