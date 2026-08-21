/**
 * The two lines every hook here shares: read the payload off stdin, write one
 * object back. Shared so the two entry points cannot spell the answer
 * differently, which is the shape Claude Code parses.
 */
import { readFileSync } from "node:fs";

/** The payload, and an empty string where there is none to read. */
export function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/** The payload as an object, or an empty one. */
export function parsePayload(stdin) {
  try {
    const value = JSON.parse(stdin);
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

/** One JSON object on stdout, and nothing at all when there is nothing to say. */
export function respond(event, context) {
  if (context === null || context === undefined) return;
  process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: context } })}\n`);
}
