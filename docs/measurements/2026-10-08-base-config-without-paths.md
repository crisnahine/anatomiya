# A root `tsconfig.base.json` that declares no `paths`

Date: 2026-10-08. `2026-10-07-checker-root-config.md` section 2 found that of eight roots holding a
`tsconfig.base.json` and no `tsconfig.json`, the six whose base declares `paths` include the five
that resolve over the 0.80 floor, and the two whose base declares none (eslint, prisma) both
degrade. Two repositories cannot carry a rule. This asks the same of more roots of that shape whose
base declares no `paths`: how many degrade, how many resolve, and whether anything recorded here is
shared by the ones that resolve. Four roots whose base does declare `paths`, none of them in the
earlier file, were measured the same way as controls.

The build measured is commit `6f2a116` of this repository, copied out with `git archive` so that
nothing edited it during the run.

## Method

### Finding the roots

Five code searches, each asking GitHub for at most 100 results:

```
gh search code --filename tsconfig.base.json --limit 100 --json repository,path 'compilerOptions'
gh search code --filename tsconfig.base.json --limit 100 --json repository,path 'declaration strict'
gh search code --filename tsconfig.base.json --limit 100 --json repository,path 'moduleResolution NOT paths'
gh search code --filename tsconfig.esm.json --limit 100 --json repository,path '"./tsconfig.base.json"'
gh search code --filename tsconfig.build.json --limit 100 --json repository,path '"./tsconfig.base.json"'
```

The first returned 92 repositories with the file at the root. The second and third returned
nothing. The fourth and fifth, which look for a root build config that extends a root base, added
63 repositories not in the first. That is 155 repositories.

For each one, two reads, and two more where the root holds the base and no `tsconfig.json`:

```
gh api repos/<owner>/<repo>
gh api repos/<owner>/<repo>/contents/
gh api repos/<owner>/<repo>/contents/tsconfig.base.json
gh api repos/<owner>/<repo>/contents/package.json
```

The root listing says whether `tsconfig.base.json` and `tsconfig.json` are there, which lockfiles
are, and whether `pnpm-workspace.yaml` and `nx.json` are. The base file was decoded, comments and
trailing commas were stripped, and it was read with `JSON.parse`. `package.json` gives `workspaces`
and `packageManager`.

Of the 155, 96 hold both files and are not this shape. 59 hold the base and no `tsconfig.json`:
36 whose base has no `compilerOptions.paths`, 22 whose base declares at least one entry, and one
whose base declares `paths` as an empty object.

### Measuring one root

One repository at a time, on macOS with Node 22.22.3:

1. `git clone --depth 1` into a new directory, and `git rev-parse HEAD` for the commit.
2. The install, from the repository's own lockfile and with install scripts off:
   - `package-lock.json`: `npm ci --ignore-scripts`, with npm 10.9.8 where `package.json` names
     no `packageManager`, and through `corepack` where it does.
   - `pnpm-lock.yaml`: `corepack pnpm install --frozen-lockfile --ignore-scripts --ignore-pnpmfile`.
     Every pnpm repository measured names its pnpm version in `packageManager`.
   - `yarn.lock` without `__metadata`: `yarn install --frozen-lockfile --ignore-scripts
     --non-interactive` with yarn 1.22.22.
   - `yarn.lock` with `__metadata`: `corepack yarn install --immutable --mode=skip-build` with
     `YARN_IGNORE_PATH=1`, so the yarn that `corepack` holds runs and not the release file the
     clone names in `yarnPath`. A clone whose `.yarnrc.yml` loads plugins from its own tree was
     dropped, since the install would run them.
3. `node plugins/anatomiya/bin/anatomiya.mjs scan <clone> --format json`, three times. The verdict
   is the `semantic` key of the record the scan writes: `ran`, `status`, `reason` and
   `typedResolutionRate`. The rate was the same number on all three scans of every repository.
4. The root `node_modules` moved out of the clone, and three more scans. On every repository all
   three then record `ran: false` with the reason `no-dependencies`.
5. The clone deleted.

Seconds are the wall time of the whole `node` process, median of three. The load is the lowest and
highest 1-minute load average `uptime` gave before the six scans. No script, build or binary of a
clone was run.

Where this departs from the earlier file: the time there is the scan's own, in milliseconds, and
here it is the process's wall time; the checker is kept from running here by moving the root
`node_modules` away, which leaves the `node_modules` of workspace packages in place; each clone is
one commit deep; and no scan was run with the base left unread, so nothing here says what reading
the base changed.

## The roots measured

All eighteen were measured 2026-10-08. "Files" is the record's `corpus.files`. "TS and JS" counts
tracked files by extension, declaration files left out of the first number. "Below" counts tracked
`tsconfig.json` files under the root.

### Base without `paths`

| repository | commit | date | files | workspace | package manager | base extends | status | reason | rate | with | without | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ethers-io/ext-signer-ledger | `b59a757be` | 2026-10-08 | 15 | none | npm 10.9.8 | no | degraded | `low-resolution` | 76.7% | 1.1s | 0.3s | 3.0 to 3.1 |
| avatsaev/webb-tracker-api | `2b3e72ec5` | 2026-10-08 | 8 | none | npm 10.9.8 | `@tsconfig/node16/tsconfig.json` | ok | none | 100.0% | 1.1s | 0.3s | 3.5 to 3.5 |
| coreui/coreui-icons | `88d1cfc47` | 2026-10-08 | 1,592 | none | npm 10.9.8 | no | ok | none | none recorded | 1.1s | 0.5s | 3.3 to 3.5 |
| justinfagnani/supertalk | `8acc34bc7` | 2026-10-08 | 39 | `workspaces` in `package.json` | npm 10.9.0 | no | ok | none | 97.2% | 1.6s | 0.4s | 3.0 to 4.5 |
| CyberPhoenix90/aurum | `b6228b8cf` | 2026-10-08 | 266 | `workspaces` in `package.json` | npm 10.9.8 | no | ok | none | 80.3% | 2.9s | 0.6s | 4.6 to 4.7 |
| VilledeMontreal/workit | `055ce4b14` | 2026-10-08 | 223 | `workspaces` in `package.json` | npm 10.9.8 | no | degraded | `low-resolution` | 70.3% | 2.3s | 0.4s | 4.5 to 4.7 |
| vbuch/node-signpdf | `2bc7eefbf` | 2026-10-08 | 83 | `workspaces` in `package.json` | yarn 1.22.22 | no | degraded | `low-resolution` | 52.5% | 1.3s | 0.3s | 4.4 to 4.6 |
| adonyssantos/fullstack-monorepo-boilerplate | `49391dac9` | 2026-10-08 | 19 | `workspaces` in `package.json`, with `nx.json` | yarn 3.4.1 | no | degraded | `low-resolution` | 34.8% | 1.3s | 0.3s | 9.9 to 10.5 |
| OWOX/models | `0e019ad36` | 2026-10-08 | 208 | `pnpm-workspace.yaml` | pnpm 10.12.4 | no | ok | none | 83.5% | 2.9s | 0.5s | 8.1 to 8.8 |
| mbarzeev/pedalboard | `ed3045f14` | 2026-10-08 | 62 | `pnpm-workspace.yaml` | pnpm 9.15.4 | no | ok | none | 90.7% | 1.6s | 0.3s | 7.2 to 7.6 |
| Wizleap-Inc/wiz-ui | `ab6f103f7` | 2026-10-08 | 1,311 | `pnpm-workspace.yaml` | pnpm 10.8.1 | no | ok | none | 94.6% | 3.8s | 0.7s | 3.7 to 4.9 |
| paritytech/substrate-connect | `0c844c65b` | 2026-10-08 | 397 | `pnpm-workspace.yaml` | pnpm 9.9.0 | `@total-typescript/tsconfig/tsc/dom/library-monorepo` | ok | none | 82.4% | 5.4s | 0.5s | 4.5 to 5.1 |
| cinderline/northcinder | `d1343096a` | 2026-10-08 | 286 | `pnpm-workspace.yaml` | pnpm 10.33.0 | no | degraded | `low-resolution` | 51.8% | 4.2s | 0.6s | 7.8 to 9.7 |
| terrazzoapp/terrazzo | `99f719a68` | 2026-10-08 | 302 | `pnpm-workspace.yaml` | pnpm 11.17.0 | no | degraded | `low-resolution` | 67.6% | 3.2s | 0.5s | 3.2 to 4.9 |

coreui/coreui-icons ran the checker and its record holds `status: "ok"` with a null rate.

### Base with `paths`, as controls

| repository | commit | date | files | `paths` entries | workspace | package manager | base extends | status | reason | rate | with | without | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Genie-sa/genie-react | `404d54a1f` | 2026-10-08 | 334 | 8 | `pnpm-workspace.yaml` | pnpm 10.34.4 | no | ok | none | 94.8% | 5.6s | 0.6s | 5.3 to 6.7 |
| qwikifiers/qwik-nx | `2ed9db156` | 2026-10-08 | 120 | 2 | none, with `nx.json` | pnpm 9.7.0 | no | ok | none | 96.8% | 1.6s | 0.4s | 5.7 to 6.3 |
| tutkli/ngx-sonner | `06e252140` | 2026-10-08 | 39 | 1 | none, with `nx.json` | npm 10.9.8 | no | ok | none | 99.8% | 1.5s | 0.3s | 4.2 to 4.5 |
| tinesoft/ngx-cookieconsent | `47edc642c` | 2026-10-08 | 58 | 1 | none, with `nx.json` | npm 10.9.8 | no | ok | none | 100.0% | 1.6s | 0.3s | 4.3 to 5.4 |

### What each root holds beside the base

| repository | verdict | TS and JS | TS share | below | installed `node_modules` |
|---|---|---|---|---|---|
| ethers-io/ext-signer-ledger | degraded | 3 and 6 | 33% | 0 | 156 MB |
| avatsaev/webb-tracker-api | ok | 5 and 3 | 63% | 0 | 165 MB |
| coreui/coreui-icons | ok, no rate | 1,592 and 2 | 100% | 0 | 73 MB |
| justinfagnani/supertalk | ok | 36 and 3 | 92% | 3 | 172 MB |
| CyberPhoenix90/aurum | ok | 259 and 8 | 97% | 0 | 97 MB |
| VilledeMontreal/workit | degraded | 187 and 42 | 82% | 11 | 226 MB |
| vbuch/node-signpdf | degraded | 7 and 110 | 6% | 8 | 369 MB |
| adonyssantos/fullstack-monorepo-boilerplate | degraded | 10 and 9 | 53% | 4 | 783 MB |
| OWOX/models | ok | 204 and 3 | 99% | 3 | 255 MB |
| mbarzeev/pedalboard | ok | 51 and 11 | 82% | 1 | 388 MB |
| Wizleap-Inc/wiz-ui | ok | 976 and 3 | 100% | 8 | 511 MB |
| paritytech/substrate-connect | ok | 374 and 19 | 95% | 18 | 1.0 GB |
| cinderline/northcinder | degraded | 261 and 27 | 91% | 16 | 249 MB |
| terrazzoapp/terrazzo | degraded | 345 and 58 | 86% | 20 | 706 MB |
| Genie-sa/genie-react | ok | 321 and 13 | 96% | 9 | 1.4 GB |
| qwikifiers/qwik-nx | ok | 95 and 5 | 95% | 5 | 487 MB |
| tutkli/ngx-sonner | ok | 37 and 2 | 95% | 2 | 690 MB |
| tinesoft/ngx-cookieconsent | ok | 54 and 4 | 93% | 2 | 817 MB |

CyberPhoenix90/aurum keeps no `tsconfig.json` in its packages and 23 other `tsconfig*.json` files
below the root.

## Looked at and dropped

Cloned, then dropped at the install:

- hackers4peace/sai-js at `1605434aa`, base without `paths`: `npm ci` with npm 11.3.0 refused,
  `package.json` and `package-lock.json` not in sync.
- favware/dragonite at `9efc53b27`, base without `paths`, a single package extending five
  `@sapphire/ts-config` files: its `.yarnrc.yml` loads `.yarn/plugins/@yarnpkg/plugin-git-hooks.cjs`
  from the clone.
- fmalcher/soundcraft-ui at `540ff0ba1`, a control with one `paths` entry: `npm ci` with npm
  10.9.8 refused, the lockfile not in sync.
- google/ground-platform at `515fd8c45`, a control with three `paths` entries: it names no
  `packageManager`, and pnpm 11.21.0 refused on its `engines.pnpm`.

Not cloned:

- skyra-project/acrysel, base without `paths`: the same plugin line in its `.yarnrc.yml`, read
  through the contents API.
- ChronicStone/typed-xlsx and Noineri/vibe_tavern, base without `paths`: a `bun.lock` and no bun
  on this machine.
- normative-service/business-carbon-calculator-public: its base declares `paths` as an empty
  object, which is neither group.
- Seventeen more whose base declares no `paths`, left out because the run stopped at fourteen and
  for no other reason: remorses/docker-phobia, DannyMac180/meta-agent, QuantiaAI/helm-agents,
  coppynight/slark, anote-ai/Panacea, Devansh-365/freellm, ggui-ai/ggui,
  danial-riazati/avan-persian-date-picker, NOC-OI/zarr-maps, lxsmnsyc/solid-gpui,
  applica-software-guru/sdd, reallygood83/hwpx-cli, huhamhire/code-meeseeks,
  scythe-discord/scythe-stats, droztech/droz-visu, Sunny-117/dev-server-proxy and
  steipete/summarize.
- Sixteen more whose base declares `paths`, not needed as controls: ng-doc/ng-doc,
  gitroomhq/crosspublic, klarna/react-native-klarna-inapp-sdk, pedaling/opensource, isboyjc/amux,
  haqq-network/frontend, juanfran/tapiz, feibeck/StarshipMayflower, rejifald/movar,
  pjlamb12/angular-svg-icon-preloader, tech-leads-club/nj-mmo, ngaox/ngaox,
  bitovi/nx-cucumber-plugin, nearform/angular-patterns-workshop, epam/statgpt-admin-frontend and
  ngxs/store.
- The 96 that hold a root `tsconfig.json` beside the base.

## What the sample shows

Of the fourteen roots whose base declares no `paths`, six degrade, seven resolve over the floor,
and one reads ok with no rate. With eslint and prisma from the earlier file that is sixteen: eight
degrade, seven resolve and one has no rate. All eight that degrade name `low-resolution`.

The four controls all read ok. With the six of the earlier file, ten roots whose base declares
`paths` have been measured: nine read ok and one degrades (tomalaforge/angular-challenges, 71.1%).

The seven that resolve, against the six that degrade here, on each fact recorded:

- Workspace kind. Resolve: four `pnpm-workspace.yaml`, two `workspaces` in `package.json`, one
  with neither. Degrade: two, three and one.
- Package manager. Resolve: four pnpm, three npm. Degrade: two pnpm, two npm, two yarn. Both yarn
  roots degrade, and they are the only two.
- The base extends something. Two of the fourteen do and both resolve (avatsaev/webb-tracker-api
  100.0%, paritytech/substrate-connect 82.4%). prisma's base also extends a package, and it
  degrades at 65.9%.
- Tracked `tsconfig.json` files below the root. Resolve: 0, 0, 1, 3, 3, 8 and 18. Degrade: 0, 4,
  8, 11, 16 and 20.
- Share of tracked source files that are TypeScript. Resolve: 63%, 82%, 92%, 95%, 97%, 99% and
  100%. Degrade: 6%, 33%, 53%, 82%, 86% and 91%. The three roots under 63% all degrade, and three
  roots at 82% to 91% degrade too.

None of the five separates the two groups.

Three of the seven that resolve sit within 3.5 points of the floor (CyberPhoenix90/aurum 80.3%,
paritytech/substrate-connect 82.4%, OWOX/models 83.5%), and one of the six that degrade sits 3.3
points under it (ethers-io/ext-signer-ledger 76.7%).

The three roots that are not a workspace give three different answers: degraded at 76.7% on 15
files, ok at 100.0% on 8 files, and ok with no rate on 1,592 files.

The checker's own time, the median with it less the median without, runs from 0.6s
(coreui/coreui-icons) to 5.0s (Genie-sa/genie-react) over the eighteen. On the six that degrade it
is 0.8s, 1.0s, 1.0s, 1.9s, 2.7s and 3.6s.

## What it does not show

- Why any root resolves or degrades. No file of a clone was read to find which lookups failed.
- How many lookups a rate rests on. The record holds the rate and not its two counts, so a rate on
  8, 15 or 19 files may rest on few.
- What reading the base changed. No root was scanned with the base left unread.
- A random sample. The roots come from the first 100 results of each of three searches, in
  GitHub's own order, and the fourteen were then picked by hand for different shapes and a small
  install.
- Large repositories. The fourteen hold 8 to 1,592 scanned files; eslint and prisma hold 853 and
  3,647 checked files in the earlier file.
- A bun workspace, a yarn 2 or later root that is a single package, or any root whose install
  failed here.
- Stability. Each root is one commit on one day, on one machine, with a 1-minute load between 3.0
  and 10.5 during the scans.
- Whether the type-checked claims of a root that reads ok are right. Only the verdict and the rate
  were read.
