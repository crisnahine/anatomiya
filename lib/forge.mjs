import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

// Bot detection is the difference between measuring review and measuring CI.
// Eight of ten repositories we sampled run an automated reviewer, and on one of
// them the bot wrote more comments than every human combined.
const BOT_SUFFIX = /\[bot\]$/i;
const BOT_NAMES = new Set([
  "coderabbitai", "copilot", "copilot-pull-request-reviewer", "sourcery-ai",
  "deepsource-autofix", "codecov", "codecov-commenter", "sonarcloud",
  "greptile-apps", "qodo-merge-pro", "codiumai-pr-agent-pro", "renovate",
  "dependabot", "snyk-bot", "netlify", "vercel", "changeset-bot",
  "github-actions", "danger", "reviewdog", "rovodev", "rovo-dev",
]);

export function isBot(login) {
  if (!login) return false;
  const l = String(login).toLowerCase();
  return BOT_SUFFIX.test(l) || BOT_NAMES.has(l);
}

async function gh(args) {
  // execFile, never a shell: repository-supplied strings reach these arguments.
  const { stdout } = await run("gh", args, { maxBuffer: 64 * 1024 * 1024, timeout: 120_000 });
  return stdout;
}

export async function ghAvailable() {
  try {
    await run("gh", ["auth", "status"], { timeout: 30_000 });
    return true;
  } catch {
    return false;
  }
}

// GitHub's own charset for a login or a repository name. Anything else reaching
// the path segments below would address a different endpoint than the caller asked for.
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function segment(value, what) {
  const s = String(value ?? "");
  if (!NAME.test(s) || s === "." || s === "..") throw new Error(`invalid ${what}: ${JSON.stringify(s)}`);
  return s;
}

/** Merged pull requests, newest merge first. */
export async function ghPulls(owner, repo, limit) {
  const o = segment(owner, "owner");
  const r = segment(repo, "repo");
  const out = await gh([
    "api", "--paginate",
    `repos/${o}/${r}/pulls?state=closed&per_page=100&sort=updated&direction=desc`,
    "--jq",
    ".[] | select(.merged_at != null) | {number, title, user: .user.login, merged_at, created_at}",
  ]);
  // The API sorts by updated_at, so a stale-but-recently-touched pull outranks a newer merge.
  const rows = parseJsonLines(out).sort((a, b) => String(b.merged_at).localeCompare(String(a.merged_at)));
  return Number.isInteger(limit) && limit >= 0 ? rows.slice(0, limit) : rows;
}

/**
 * Review comments for one pull request: inline review comments plus
 * pull-request-level comments, normalised to one shape.
 */
export async function ghComments(owner, repo, number) {
  const o = segment(owner, "owner");
  const r = segment(repo, "repo");
  const n = Number(number);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`invalid pull number: ${JSON.stringify(number)}`);

  const [inline, general] = await Promise.all([
    gh(["api", "--paginate", `repos/${o}/${r}/pulls/${n}/comments?per_page=100`,
        "--jq", ".[] | {id, user: .user.login, body, path, line, created_at, in_reply_to_id}"]),
    gh(["api", "--paginate", `repos/${o}/${r}/issues/${n}/comments?per_page=100`,
        "--jq", ".[] | {id, user: .user.login, body, created_at}"]),
  ]);

  const rows = [
    ...parseJsonLines(inline).map((c) => ({ ...c, inline: true })),
    ...parseJsonLines(general).map((c) => ({
      ...c, inline: false, path: null, line: null, in_reply_to_id: null,
    })),
  ];

  return rows.map((c) => ({ ...c, pr: n, bot: isBot(c.user) }));
}

/**
 * `gh --jq` emits one JSON value per line. A body containing a newline is
 * already escaped inside the JSON string, so splitting on newlines is safe
 * here and would not be if we were parsing raw bodies.
 */
export function parseJsonLines(text) {
  const out = [];
  if (!text) return out;
  for (const line of String(text).split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      // A malformed line is a harvest defect, not a reason to lose the run.
    }
  }
  return out;
}

export function parseRepo(spec) {
  const m = /^(?:(?:https?:\/\/)?github\.com\/|git@github\.com:)?([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i
    .exec(String(spec ?? "").trim());
  if (!m) return null;
  try {
    return { owner: segment(m[1], "owner"), repo: segment(m[2], "repo") };
  } catch {
    return null;
  }
}
