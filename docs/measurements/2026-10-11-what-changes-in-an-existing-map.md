# What a scan of 0.15.0 changes in a map 0.14.0 wrote (2026-10-11)

The counts under "What changes in an existing map" in the CHANGELOG's 0.15.0 section, and the
README's "its overview or area files did on 22 of 60", come from this run.

## Method

- Builds: `git archive v0.14.0` and `git archive 195f620` (0.15.0 before the fixes of its last
  review round), each with the same `node_modules` copied in.
- Repositories: the 35 in `anatomiya-corpus` and the 25 in `anatomiya-corpus-langs`. Per repository,
  one at a time, two `cp -Rc` copies, a plain `scan` from no map with each build, then the `.claude`
  tree of each normalised (JSON pretty-printed; `scannedAt`, `durationMs`, `measuredAt`, `at`,
  `mtimeMs`, `startedAt`, `elapsedMs` and `seconds` masked; the copy's path replaced) and compared
  with `diff -ru`. Every differing line was given a cause by a classifier over the diff, and next.js
  and canvas-lms were read by hand. The claims line is the scan's own stdout.
- Every scan exited 0 on both builds. Load 12 to 59, so no time from this run is quoted anywhere.

## Totals

- Every rule file (the overview and every area file) identical in 38 of 60.
- The overview differs in 20 of 60.
- Area files: 8,011 identical, 161 changed, 4 added, 0 removed.
- `facts.json` and `layout.json` differ in all 60, for the new `layout.cochange` member;
  `refresh.json` differs in all 60 only in its build `stamp`.
- Areas: next.js 497 to 500 (`examples/with-sfcc`, `examples/with-storybook`,
  `examples/with-supabase/app`, 11 files each), canvas-lms 497 to 498
  (`ui/features/eportfolio/react/__tests__`). Every other repository keeps its area count.

## Causes

- The co-change record (C55): `facts.json` and `layout.json` in all 60.
- Co-change blocks (C55, A110): 13 area files in 7 repositories (whitehall, consul, forem,
  canvas-lms, mastodon, rubocop, supabase). No directive line moves in any of them. In one supabase
  area four gated count lines give way and fold into `and 4 more not shown here, all of them
  counts`.
- Support files under a test tree (H53): whitehall, appsmith, cal.diy, discourse, element-plus,
  forem, canvas-lms, openproject, prisma, react, rubocop, storybook, vitepress.
- The sibling-module count over producers (H54): Ghost, angular, appsmith, backstage, cal.diy,
  element-plus, react-front-end, vscode, prisma, react, storybook, supabase, next.js,
  webpack. next.js's `test` root loses its whole helper clause, `2767 sibling modules ...; 736 of
  6989 JSX files inline a helper`, since no producer module is left there.
- The seven dotted test kinds (H56): vscode, webpack.
- The give-back at the area ceiling (A111): next.js, canvas-lms.
- A slot's `scope` (B56, C57): `facts.json` only, in 22 repositories; no rule file moves for it.
- The build digest: `refresh.json`'s `stamp` and the checker's `measuredUnder`.
- Quoted names, the family hold and `Class.method` move nothing: no directory name in the 60 that
  reaches a map holds a space, and the other two are `check`'s.

backstage and discourse state co-change claims that print in no area file, so their claims lines do
not move. hugo, ktor, okhttp and serde state nothing and read `, they print as counts` where 0.14.0
printed `, the rest print as counts`.

## Per repository

The claims line is `same` where it did not move; otherwise 0.14.0's, then this build's.

| repository | overview | area files identical | changed | added | removed | areas | claims line |
|---|---|---|---|---|---|---|---|
| BurntSushi__ripgrep | same | 10 | 0 | 0 | 0 | 10 | same |
| Homebrew__brew | same | 57 | 0 | 0 | 0 | 57 | same |
| JamesNK__Newtonsoft.Json | same | 12 | 0 | 0 | 0 | 12 | same |
| Kotlin__kotlinx.serialization | same | 33 | 0 | 0 | 0 | 33 | same |
| TryGhost__Ghost | differs | 283 | 0 | 0 | 0 | 283 | same |
| alphagov__whitehall | differs | 56 | 4 | 0 | 0 | 60 | 61 of 292 claims stated, 4 match the model default, the rest print as counts -> 63 of 294 claims stated, 4 match the model default, the rest print as counts |
| angular__angular | same | 300 | 0 | 0 | 0 | 300 | same |
| apache__commons-lang | same | 22 | 0 | 0 | 0 | 22 | same |
| appsmithorg__appsmith | differs | 428 | 1 | 0 | 0 | 429 | same |
| babel__babel | same | 66 | 0 | 0 | 0 | 66 | same |
| backstage__backstage | differs | 425 | 0 | 0 | 0 | 425 | same |
| caddyserver__caddy | same | 29 | 0 | 0 | 0 | 29 | same |
| calcom__cal.diy | differs | 245 | 7 | 0 | 0 | 252 | same |
| chef__chef | same | 70 | 0 | 0 | 0 | 70 | same |
| composer__composer | same | 37 | 0 | 0 | 0 | 37 | same |
| consul__consul | same | 76 | 1 | 0 | 0 | 77 | 87 of 289 claims stated, the rest print as counts -> 88 of 290 claims stated, the rest print as counts |
| decidim__decidim | same | 338 | 0 | 0 | 0 | 338 | same |
| diaspora__diaspora | same | 63 | 0 | 0 | 0 | 63 | same |
| discourse__discourse | differs | 443 | 4 | 0 | 0 | 447 | same |
| django__django | same | 95 | 0 | 0 | 0 | 95 | same |
| element-plus__element-plus | differs | 112 | 1 | 0 | 0 | 113 | same |
| rails-api | same | 156 | 0 | 0 | 0 | 156 | same |
| react-front-end | differs | 127 | 0 | 0 | 0 | 127 | same |
| errbit__errbit | same | 32 | 0 | 0 | 0 | 32 | same |
| eslint__eslint | same | 29 | 0 | 0 | 0 | 29 | same |
| fastapi__fastapi | same | 38 | 0 | 0 | 0 | 38 | same |
| fastlane__fastlane | same | 55 | 0 | 0 | 0 | 55 | same |
| forem__forem | differs | 120 | 4 | 0 | 0 | 124 | 145 of 823 claims stated, 41 match the model default, the rest print as counts -> 147 of 825 claims stated, 41 match the model default, the rest print as counts |
| gin-gonic__gin | same | 4 | 0 | 0 | 0 | 4 | same |
| gohugoio__hugo | same | 63 | 0 | 0 | 0 | 63 | 0 of 103 claims stated, the rest print as counts -> 0 of 103 claims stated, they print as counts |
| google__gson | same | 12 | 0 | 0 | 0 | 12 | same |
| huginn__huginn | same | 26 | 0 | 0 | 0 | 26 | same |
| huntabyte__shadcn-svelte | same | 88 | 0 | 0 | 0 | 88 | same |
| instructure__canvas-lms | differs | 421 | 76 | 1 | 0 | 497 -> 498 | 962 of 7654 claims stated, 732 match the model default, the rest print as counts -> 968 of 7662 claims stated, 737 match the model default, the rest print as counts |
| jellyfin__jellyfin | same | 80 | 0 | 0 | 0 | 80 | same |
| junit-team__junit5 | same | 71 | 0 | 0 | 0 | 71 | same |
| ktorio__ktor | same | 133 | 0 | 0 | 0 | 133 | 0 of 133 claims stated, the rest print as counts -> 0 of 133 claims stated, they print as counts |
| laravel__framework | same | 115 | 0 | 0 | 0 | 115 | same |
| mastodon__mastodon | same | 128 | 1 | 0 | 0 | 129 | 236 of 1189 claims stated, 61 match the model default, the rest print as counts -> 237 of 1190 claims stated, 61 match the model default, the rest print as counts |
| microsoft__vscode | differs | 476 | 24 | 0 | 0 | 500 | same |
| openfoodfoundation__openfoodnetwork | same | 84 | 0 | 0 | 0 | 84 | same |
| opf__openproject | differs | 499 | 1 | 0 | 0 | 500 | same |
| pallets__flask | same | 10 | 0 | 0 | 0 | 10 | same |
| prisma__prisma | differs | 192 | 0 | 0 | 0 | 192 | same |
| publiclab__plots2 | same | 28 | 0 | 0 | 0 | 28 | same |
| puppetlabs__puppet | same | 89 | 0 | 0 | 0 | 89 | same |
| react__react | differs | 110 | 21 | 0 | 0 | 131 | same |
| rubocop__rubocop | differs | 28 | 6 | 0 | 0 | 34 | 33 of 104 claims stated, the rest print as counts -> 40 of 111 claims stated, the rest print as counts |
| serde-rs__serde | same | 11 | 0 | 0 | 0 | 11 | 0 of 11 claims stated, the rest print as counts -> 0 of 11 claims stated, they print as counts |
| serilog__serilog | same | 20 | 0 | 0 | 0 | 20 | same |
| slimphp__Slim | same | 11 | 0 | 0 | 0 | 11 | same |
| square__okhttp | same | 48 | 0 | 0 | 0 | 48 | 0 of 52 claims stated, the rest print as counts -> 0 of 52 claims stated, they print as counts |
| storybookjs__storybook | differs | 264 | 1 | 0 | 0 | 265 | same |
| supabase__supabase | differs | 391 | 1 | 0 | 0 | 392 | 927 of 7288 claims stated, 641 match the model default, the rest print as counts -> 929 of 7290 claims stated, 641 match the model default, the rest print as counts |
| sveltejs__kit | same | 110 | 0 | 0 | 0 | 110 | same |
| tokio-rs__tokio | same | 33 | 0 | 0 | 0 | 33 | same |
| typeorm__typeorm | same | 120 | 0 | 0 | 0 | 120 | same |
| vercel__next.js | differs | 496 | 1 | 3 | 0 | 497 -> 500 | 423 of 5993 claims stated, 719 match the model default, the rest print as counts -> 423 of 6030 claims stated, 723 match the model default, the rest print as counts |
| vuejs__vitepress | differs | 21 | 6 | 0 | 0 | 27 | same |
| webpack__webpack | differs | 72 | 1 | 0 | 0 | 73 | same |
