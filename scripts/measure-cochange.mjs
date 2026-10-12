#!/usr/bin/env node
/**
 * What ships together, measured as `docs/measurements/2026-10-11-cochange.md` measures it: each
 * repository's claims mined over every change read, which is what a scan states, and mined on the
 * older four fifths and held out on the newest fifth. It only reads git, so a repository is read in
 * place.
 *
 * usage: node scripts/measure-cochange.mjs <repository> [<repository> ...]
 */
import { basename, resolve } from "node:path";

import { invokedAs } from "./entry.mjs";
import { mineCochange, startCochange } from "../plugins/anatomiya/lib/cochange-walk.mjs";
import { classesOf } from "../plugins/anatomiya/lib/cochange.mjs";

/** One repository: what its walk read, the claims a scan states, and the held-out record. */
export async function measure(root) {
  const started = await startCochange(root, null);
  const { walk, tree } = started;
  const usable = started.tip !== null && !walk.error && walk.changes.length > 0 && tree !== null;
  const stated = usable ? mineCochange(walk, { tree }).claims.filter((c) => c.directive) : [];
  // The walk lists the newest change first.
  const cut = Math.floor(walk.changes.length / 5);
  const held = walk.changes.slice(0, cut);
  const mined = usable ? mineCochange({ ...walk, changes: walk.changes.slice(cut) }, { tree }).claims.filter((c) => c.directive) : [];
  let met = 0;
  let fired = 0;
  for (const claim of mined) {
    for (const change of held) {
      if (!change.added.some((p) => classesOf(p).includes(claim.producer))) continue;
      fired++;
      const { kind, path } = claim.companion;
      if (kind === "edits" ? change.touched.includes(path) : change.added.some((p) => classesOf(p).includes(path))) met++;
    }
  }
  return { repo: basename(root), read: walk.read, counted: walk.changes.length, error: walk.error, stated: stated.length, mined: mined.length, met, fired };
}

/** The totals the measurement file and the CHANGELOG cite. */
export function tally(rows) {
  const sum = (pick) => rows.reduce((n, r) => n + pick(r), 0);
  return {
    stated: sum((r) => r.stated),
    statedIn: rows.filter((r) => r.stated > 0).length,
    mined: sum((r) => r.mined),
    minedIn: rows.filter((r) => r.mined > 0).length,
    met: sum((r) => r.met),
    fired: sum((r) => r.fired),
  };
}

if (invokedAs(import.meta.url)) {
  const roots = process.argv.slice(2);
  if (roots.length === 0) {
    console.error("usage: node scripts/measure-cochange.mjs <repository> [<repository> ...]");
    process.exit(2);
  }
  const rows = [];
  for (const root of roots) {
    rows.push(await measure(resolve(root)));
    console.log(JSON.stringify(rows.at(-1)));
  }
  const t = tally(rows);
  console.log(`mined over all: ${t.stated} claims in ${t.statedIn} repositories; on the older four fifths: ${t.mined} claims in ${t.minedIn}, and ${t.met} of ${t.fired} held-out additions came with their companion`);
}
