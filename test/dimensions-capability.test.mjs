import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSync } from "oxc-parser";

import { CAPABILITY_DIMENSIONS, stemWords } from "../plugins/anatomiya/lib/dimensions-capability.mjs";
import { dimensionsFor } from "../plugins/anatomiya/lib/dimensions.mjs";
import { capabilitiesIn } from "../plugins/anatomiya/lib/corpus.mjs";

const dim = (key) => CAPABILITY_DIMENSIONS.find((d) => d.key === key);

function hits(key, src, extra) {
  const { program } = parseSync("f.tsx", src, { sourceType: "module" });
  const out = [];
  dim(key).run(program, (h) => out.push(h), extra);
  return out;
}

const counts = (key, src, extra) => {
  const h = hits(key, src, extra);
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

test("capabilitiesIn reads the corpus for wrapper-shaped files and directories", () => {
  const files = (rels) => rels.map((rel) => ({ rel, lang: "js" }));
  assert.deepEqual(
    [...capabilitiesIn(files(["src/lib/logger.ts", "src/api-client.ts", "src/a.ts"]))].sort(),
    ["logging", "network"]
  );
  assert.deepEqual(
    [...capabilitiesIn(files(["src/logging/index.ts"]))],
    ["logging"],
    "a directory-module wrapper is imported by its directory name"
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
  const { adoptedCapabilities } = await import("../plugins/anatomiya/lib/dimensions.mjs");
  const rec = (key, conforming) => ({ ok: true, hits: { [key]: [{ conforming }] } });
  const records = new Map([
    ["a.ts", rec("route_logging", true)],
    ["b.ts", rec("route_logging", true)],
    ["c.rb", rec("logger_over_puts", true)],
    ["d.ts", rec("route_network", true)],
    ["e.ts", rec("route_env", false)],
  ]);
  const adopted = adoptedCapabilities(records);
  assert.deepEqual([...adopted].sort(), ["logging"], "three adopting files across both engines; one is a habit");
});

test("adoption needs no filename vocabulary: Rails.logger carries none", async () => {
  const { adoptedCapabilities } = await import("../plugins/anatomiya/lib/dimensions.mjs");
  const rec = () => ({ ok: true, hits: { logger_over_puts: [{ conforming: true }] } });
  const records = new Map([["a.rb", rec()], ["b.rb", rec()], ["c.rb", rec()]]);
  assert.deepEqual([...adoptedCapabilities(records)], ["logging"]);
});

test("a stylesheet or a data file whose name says settings is not the config module", () => {
  // Measured on a `settings` feature of 12 components, each reading its own
  // CSS module: `styles.root` counted as a conforming env read, three files
  // adopted the capability, and the map stated "environment reads go through
  // the repository's own config module" 72 of 73 over a repository holding
  // none, with the one real process.env read as its exception.
  const r = counts("route_env", `
    import styles from "./SettingsPanel.module.css";
    import defaults from "./settings.json";
    const a = styles.root;
    const b = defaults.theme;
    const c = process.env.NEXT_PUBLIC_API_URL;
  `);
  assert.deepEqual(r, { candidates: 1, conforming: 0 }, "only the process.env read is a site");
});

test("a config module named the Angular and NestJS way is still the config module", () => {
  // `import_extension` learned that a dotted suffix is as often part of a
  // source file's stem (`config.service.ts`, `env.constants.ts`) as an asset's
  // extension; this row kept the old rule and dropped the wrapper those
  // repositories route every environment read through. A `?raw` import is a
  // string, not the module its name says.
  const r = counts("route_env", `
    import { cfg } from "./config.service";
    import { env } from "./env.constants";
    import raw from "./settings.ts?raw";
    const a = cfg.apiUrl;
    const b = env.port;
    const c = raw.length;
  `);
  assert.deepEqual(r, { candidates: 2, conforming: 2 });
});

test("a destructuring read off process.env is a direct site per name", () => {
  const r = counts("route_env", `const { PORT, HOST } = process.env;`);
  assert.deepEqual(r, { candidates: 2, conforming: 0 });
});

/* --- the module that implements the routing is not one of its own sites (#68) --- */

test("the client that implements the routing is not one of its own sites", () => {
  // Something has to reach the platform. The always-loaded map read "network
  // calls go through the repository's own client, not fetch directly ... except
  // src/queries/request.ts", which is the client: the map told an agent that
  // the client breaks the client rule.
  assert.deepEqual(counts("route_network", `const r = await fetch("/x");`, { rel: "src/queries/request.ts" }), {
    candidates: 0,
    conforming: 0,
  });
});

test("the logger and the config module are excused the same way", () => {
  assert.deepEqual(counts("route_logging", `console.log("x")`, { rel: "src/lib/logger.ts" }), {
    candidates: 0,
    conforming: 0,
  });
  assert.deepEqual(counts("route_env", `const p = process.env.PORT`, { rel: "src/config.ts" }), {
    candidates: 0,
    conforming: 0,
  });
});

test("a file that merely mentions the vocabulary is still a site", () => {
  // Every word of the stem, where an import needs one. Measured on two
  // repositories, the strict rule keeps all 22 Ruby clients and the one
  // JavaScript client 301 files import, and drops the 92 that merely mention
  // the vocabulary. One word would have excused a real fetch in an ordinary
  // feature module and 20 log-named files.
  assert.deepEqual(counts("route_network", `const r = await fetch("/x");`, { rel: "src/queries/userApi.ts" }), {
    candidates: 1,
    conforming: 0,
  });
  assert.deepEqual(counts("route_env", `const p = process.env.PORT`, { rel: "src/app-config.ts" }), {
    candidates: 1,
    conforming: 0,
  });
});

test("a row handed no path answers exactly as it always did", () => {
  // Every test in this file and three others run a row with no third argument.
  assert.deepEqual(counts("route_network", `const r = await fetch("/x");`), { candidates: 1, conforming: 0 });
  assert.deepEqual(counts("route_logging", `console.log("x")`), { candidates: 1, conforming: 0 });
  assert.deepEqual(counts("route_env", `const p = process.env.PORT`), { candidates: 1, conforming: 0 });
});

test("implementsCapability asks every word of the stem, and only the stem", async () => {
  const { implementsCapability } = await import("../plugins/anatomiya/lib/dimensions-capability.mjs");

  for (const rel of ["src/queries/request.ts", "app/clients/client.rb", "src/lib/api-client.ts", "src/lib/httpClient.ts", "app/clients/api_client_v2.rb", "src/lib/apiClientV1.ts", "app/clients/api_v2_client.rb", "app/clients/v2_api_client.rb", "src/lib/ApiV2Client.ts", "app/clients/api_client_1.rb"]) {
    assert.equal(implementsCapability(rel, "network"), true, rel);
  }
  for (const rel of ["src/queries/userApi.ts", "app/services/payment_api.rb", "src/queries/index.ts", "src/lib/v2.ts", "src/lib/v2_payment.ts"]) {
    assert.equal(implementsCapability(rel, "network"), false, rel);
  }
  for (const rel of ["src/2_api.ts", "app/clients/2_client.rb"]) {
    assert.equal(implementsCapability(rel, "network"), false, `a leading number is a sequence, not a version: ${rel}`);
  }
  assert.equal(implementsCapability("db/migrations/20240901_settings.js", "env"), false, "a migration timestamp is not a version");
  assert.equal(implementsCapability("db/migrate/001_logger.rb", "logging"), false, "nor is a fixture sequence");
  assert.equal(implementsCapability("src/queries/request.ts", "logging"), false, "one vocabulary at a time");
  assert.equal(implementsCapability("src/config.ts", "env"), true);
  assert.equal(implementsCapability(null, "env"), false, "a row handed no path answers as before");
  assert.equal(implementsCapability("src/config.ts", "nosuch"), false, "and an unknown capability lends nothing");
});

/* --- a wrapper is a module named nothing but the vocabulary --- */

test("an import whose stem merely mentions the vocabulary is not the wrapper", () => {
  // Measured on a Redux store: src/store/settingsSlice.ts is dispatched from
  // six files (`settingsSlice.actions.setTheme(...)`), and one word of the stem
  // said settings, so every dispatch counted as a conforming environment read
  // and route_env read 12 of 13 over a repository whose one real config access
  // was a process.env read in api.ts. The same rule implementsCapability asks:
  // every word of the imported stem.
  const r = counts("route_env", `
    import { settingsSlice } from "./settingsSlice";
    import { parseRequest } from "./request-utils";
    import { ApiError } from "./api-errors";
    dispatch(settingsSlice.actions.setTheme("dark"));
    const t = settingsSlice.name;
    const u = process.env.API_URL;
  `);
  assert.deepEqual(r, { candidates: 1, conforming: 0 }, "only the process.env read is a site");
  const n = counts("route_network", `
    import { parseRequest } from "./request-utils";
    import { ApiError } from "./api-errors";
    parseRequest(x);
    throw new ApiError("x");
    await fetch("/x");
  `);
  assert.deepEqual(n, { candidates: 1, conforming: 0 });
});

test("stemWords keeps an acronym whole", () => {
  // `HTTPClient` split letter by letter into h,t,t,p,client, so neither
  // src/lib/HTTPClient.ts nor src/API.ts was the implementing module and an
  // import of "./API" was not a wrapper.
  assert.deepEqual(stemWords("HTTPClient"), ["http", "client"]);
  assert.deepEqual(stemWords("API"), ["api"]);
  assert.deepEqual(stemWords("APIClient"), ["api", "client"]);
  assert.deepEqual(stemWords("getHTTPResponse"), ["get", "http", "response"]);
  assert.deepEqual(stemWords("oauth2Client"), ["oauth2", "client"]);
});

test("an acronym-named client is the implementing module and its import the wrapper", async () => {
  const { implementsCapability } = await import("../plugins/anatomiya/lib/dimensions-capability.mjs");
  for (const rel of ["src/API.ts", "src/APIClient.ts", "src/lib/HTTPClient.ts"]) {
    assert.equal(implementsCapability(rel, "network"), true, rel);
  }
  const r = counts("route_network", `
    import API from "./API";
    import { HTTPClient } from "../lib/HTTPClient";
    import apiV2 from "./api-client-v2";
    import v3Api from "./v3-api-client";
    await API.get("/x");
    await HTTPClient.post("/y");
    await apiV2.get("/z");
    await v3Api.get("/w");
  `);
  assert.deepEqual(r, { candidates: 4, conforming: 4 });
});
