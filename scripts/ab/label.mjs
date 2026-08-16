/**
 * What to call the repository a measurement was taken on.
 *
 * Never the path it sat at. The first result file committed here carried
 * `/Users/<name>/Documents/...` into a public repository, in the title and in
 * the table, and where a clone happened to live on the machine that ran the
 * trials is not part of the measurement. It also cannot be checked by anyone
 * else, which is the point of writing the file down.
 *
 * The origin is the better name when there is one: it identifies the commit for
 * a reader who wants to run the same thing. Otherwise the directory's own name,
 * which is as much as a local clone can honestly say about itself.
 */
export function repoLabel(dir, origin) {
  const fromOrigin = normaliseOrigin(origin);
  if (fromOrigin) return fromOrigin;
  return String(dir)
    .split(/[/\\]/)
    .filter(Boolean)
    .at(-1) ?? "the repository";
}

/** `git@host:owner/name.git` and `https://host/owner/name.git` both read as `host/owner/name`. */
function normaliseOrigin(origin) {
  if (typeof origin !== "string" || origin.trim() === "") return null;
  const url = origin.trim().replace(/\.git$/, "");
  const scp = url.match(/^[^@]+@([^:]+):(.+)$/);
  if (scp) return `${scp[1]}/${scp[2]}`;
  const full = url.match(/^[a-z+]+:\/\/(?:[^@/]+@)?(.+)$/i);
  if (full) return full[1];
  return null;
}
