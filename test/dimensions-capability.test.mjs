import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSync } from "oxc-parser";

import { CAPABILITY_DIMENSIONS, stemWords } from "../lib/dimensions-capability.mjs";
import { dimensionsFor } from "../lib/dimensions.mjs";
import { capabilitiesIn } from "../lib/corpus.mjs";

const dim = (key) => CAPABILITY_DIMENSIONS.find((d) => d.key === key);

function hits(key, src) {
  const { program } = parseSync("f.tsx", src, { sourceType: "module" });
  const out = [];
  dim(key).run(program, (h) => out.push(h));
  return out;
}

const counts = (key, src) => {
  const h = hits(key, src);
  return { candidates: h.length, conforming: h.filter((x) => x.conforming).length };
};

/* --- the stem vocabulary --- */

test("stemWords splits on delimiters and camel humps", () => {
  assert.deepEqual(stemWords("api-client"), ["api", "client"]);
  assert.deepEqual(stemWords("apiClient"), ["api", "client"]);
  assert.deepEqual(stemWords("app_logger"), ["app", "logger"]);
  assert.deepEqual(stemWords("dialog"), ["dialog"], "log inside a word is not the word log");
});

/* --- logging --- */

test("console calls are direct sites and wrapper calls conform", () => {
  const r = counts("route_logging", `
    import logger from "./logger.js";
    console.log("a");
    console.error("b");
    logger.info("c");
    logger("d");
  `);
  assert.deepEqual(r, { candidates: 4, conforming: 2 });
});

test("a namespace import of the wrapper counts the same way", () => {
  const r = counts("route_logging", `
    import * as log from "../shared/logging.ts";
    log.warn("x");
  `);
  assert.deepEqual(r, { candidates: 1, conforming: 1 });
});

test("an import from node_modules is not a wrapper", () => {
  const r = counts("route_logging", `
    import winston from "winston";
    winston.info("x");
    console.log("y");
  `);
  assert.deepEqual(r, { candidates: 1, conforming: 0 }, "only the console call is a site");
});

test("a file with no logging has no logging sites", () => {
  assert.equal(hits("route_logging", `export const a = 1;`).length, 0);
});

/* --- network --- */

test("fetch and axios are direct sites and the repo client conforms", () => {
  const r = counts("route_network", `
    import axios from "axios";
    import { api } from "./api-client.ts";
    const a = await fetch("/x");
    const b = await axios.get("/y");
    const c = await api.get("/z");
  `);
  assert.deepEqual(r, { candidates: 3, conforming: 1 });
});

test("a local binding named fetch is still counted, and marked partial in the row", () => {
  assert.equal(dim("route_network").precision, "partial");
});

/* --- env --- */

test("process.env reads are direct sites and the config module conforms", () => {
  const r = counts("route_env", `
    import { config } from "./config.ts";
    const a = process.env.PORT;
    const b = config.port;
  `);
  assert.deepEqual(r, { candidates: 2, conforming: 1 });
});

/* --- offering --- */

test("capabilitiesIn reads the corpus for wrapper-shaped files", () => {
  const files = (rels) => rels.map((rel) => ({ rel, lang: "js" }));
  assert.deepEqual(
    [...capabilitiesIn(files(["src/lib/logger.ts", "src/api-client.ts", "src/a.ts"]))].sort(),
    ["logging", "network"]
  );
  assert.deepEqual([...capabilitiesIn(files(["src/a.ts", "src/dialog.ts"]))], []);
});

test("dimensionsFor offers a capability row only where the corpus shows the wrapper", () => {
  const with_ = dimensionsFor(["js"], { capabilities: new Set(["logging"]) }).map((d) => d.key);
  assert.ok(with_.includes("route_logging"));
  assert.ok(!with_.includes("route_network"));
  const unknown = dimensionsFor(["js"]).map((d) => d.key);
  assert.ok(unknown.includes("route_logging"), "a caller that cannot know is offered everything");
});

test("a capability is offered only where files already route through a wrapper", async () => {
  const { adoptedCapabilities } = await import("../lib/dimensions.mjs");
  const rec = (key, conforming) => ({ ok: true, hits: { [key]: [{ conforming }] } });
  const records = new Map([
    ["a.ts", rec("route_logging", true)],
    ["b.ts", rec("route_logging", true)],
    ["c.rb", rec("logger_over_puts", true)],
    ["d.ts", rec("route_network", true)],
    ["e.ts", rec("route_env", false)],
  ]);
  const adopted = adoptedCapabilities(records, new Set(["logging", "network", "env"]));
  assert.deepEqual([...adopted].sort(), ["logging"], "three adopting files across both engines; one is a habit, none is a vocabulary accident");
});

test("a destructuring read off process.env is a direct site per name", () => {
  const r = counts("route_env", `const { PORT, HOST } = process.env;`);
  assert.deepEqual(r, { candidates: 2, conforming: 0 });
});
