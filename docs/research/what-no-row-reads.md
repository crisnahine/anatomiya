# What no row reads

Research notes, October 2026. The question is what anatomiya never reads, and which of those
unread classes hold a per-repository convention strong enough to be a row. Issue #238 is the
trigger: no row reads a string literal's value, so a snake_case URL segment in a route table where
37 of 38 segments are kebab-case went unflagged. The goal behind it is that the map should cover a
repository's structure and its wiring as well as its code style.

Every claim carries its source, in two kinds:

- **code**: a file and line in this repository at `89c17085`
- **probe**: a throwaway script run read-only over the corpus, named by its path and command

The corpus is the 35 checkouts under `~/Documents/Projects/anatomiya-corpus`, at whatever commit
each was checked out at on 2026-10-20. Nothing in them was modified. The probes import
`classifyWord`, `isCorpusPath`, `isDenied`, `isExcludedDir` and `wilsonLower` from a copy of this
repository made with `git archive HEAD`, so a probe's corpus filter and word classes are the tool's
own. The probes were throwaway and are not kept, which is the rule for probes here; each section
below gives the claim, the sites and the command shape, which is enough to write one again:

- `probe-js.mjs`: oxc-parser over every corpus `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs` and `.cjs` file
- `probe-text.mjs`: regex and path counts for Ruby, `routes.rb`, views, Ember route maps, file routers and non-source files
- `probe-locales.rb`: key parity between locale files, YAML and JSON
- `probe-lazy.mjs`: lazy against full i18n keys in Rails views
- `area.mjs`: per repository and per area proxy, one claim or several joined with `+`

How the numbers below were taken, and what that leaves out:

- A site is one place the construct appears. A repository "holds" a claim where it has at least 20 sites and one
  side takes at least 0.90 of them. That is the ratio gate's bar (`gates.mjs:2`) with a floor
  on sites in place of the Wilson bound.
- `eff` is the inverse Simpson file count the concentration gate uses (`reduce.mjs:544-557`).
- An **area proxy** is a file's directory cut to its first three segments. It is not the tool's
  area discovery, which was not run. A claim "held in an area" means some proxy has 20 or more
  sites at 0.90 or more for that side.
- No author gate, no applicability gate and no model-default filter were applied. Which side a
  model writes unprompted was not measured for any class here.
- Ruby is read by regex, not by Prism. The JS probe skips `.vue` and `.svelte` script blocks.
- The measured React front end's checkout holds 42 of 42 kebab-case route segments. The snake_case segment in #238
  came from a branch the checkout does not have.

## What was built from this

Written after the note. The classes below stay as measured, and their numbers are the probes'.
The shipped rows count their own predicate, so the same tables read differently: #238 counted 37
of 38 distinct segments on the branch it was filed from, the probe here counts 42 of 42 at the
corpus checkout, and the shipped row 41 of 41; on the Rails API the probe counts 269 of 275 and
the shipped row 256 of 259.

- URL path segments: `url_segment_case` and `route_segment_case` (C59), with the route table's
  declarations standing in for its files at the three gates that refused it (D16). Request paths
  handed to `fetch` and file-router directories are not read: the first names another service's
  URLs, and the second is a directory name.
- A Rails controller's parameter filter, `strong_params_style` (C60), and whether a spec's
  outermost `describe` names its `type:` in its options, `spec_type_declared` (C61).
- The overview's Not covered section now counts the files no row opens and says which strings a row
  reads (A120).
- Not built, and why, in `DECISIONS.md` under "What is deliberately not built": directory name case
  and test titles are both answered by the sibling an agent lists or opens before it writes, and the
  rows over CSS, YAML and locale files have no area to stand in.

Issues #239 to #243 then measured every class this note ranks but locale key parity against the bar,
over the three corpora with the tool's own filters, areas and gates, and put the classes whose
numbers cleared it to sessions with no map (`docs/measurements/2026-10-23-unread-classes.md`). One
shipped: `endpoint_segment_case` reads the route paths Python, Java, C# and Rust declare, since the
class a repository holds differs inside each of the four, and PHP, Go and Kotlin were refused (C62).
The rest were refused. The URL forms left unread above stay unread (C63). The YAML extension and
Markdown and data file names cleared the numbers, but the sibling in the file's own directory
already agrees with 0.98 or more of their sites, every session matched it, and they have no area to
sit in; CSS classes hold CSS's own default and locale parity is the translation pipeline's (C64).
Directory names, "should" titles and i18n key case and shape were matched in every session that
wrote one, and the other classes in section 4 fail on applicability, spread, a linter or a reader
this tool lacks (C65). An i18n key's presence in the base locale is a correctness check with no
sides, a migration's schema edit is a co-change claim already, and an action pinned to a sha was
copied from the sibling workflows in every session (C66).

## Summary

anatomiya reads source text in 12 languages and the path of every tracked file. Inside source it
reads identifiers, declarations, calls by callee name, imports, comments next to declarations, JSX
text, and Rails migration options. At `89c17085` it read no string literal argument for its shape. It never
opens a non-source file: YAML, JSON, CSS, Markdown, view templates and `.gjs` components are
counted by extension and nothing else. That is 91,369 of 268,541 tracked files across the corpus,
0.340 of them.

Of the 15 unread classes that hold a convention somewhere, three split the corpus both ways, which
is the design value the tool cares about:

1. **URL path segments** (route tables, request paths, links, file-router directories, Rails
   routes): 19 repositories have 20 or more sites, 12 hold a side at 0.90, 7 snake_case and 5
   kebab-case. Area proxies hold kebab-case in 9 repositories and snake_case in 8.
2. **Directory name case**: 30 repositories measurable, 13 hold a side, 7 snake_case and 6
   kebab-case. Area proxies hold kebab-case in 17 repositories, snake_case in 14, PascalCase in 5
   and camelCase in 4.
3. **Test titles that start with "should"**: 35 repositories measurable, 17 hold "does not" at
   repository level, and 13 repositories hold "should" at 0.90 in at least one area proxy
   (next.js in 34 of them, angular in 18, backstage in 18, cal.diy in 15).

Two gates, not one, stop a row over a single-file registry. #238 names the concentration gate.
The applicability gate stops it too: a construct that lives in 1 file of an 8-file area needs 3
files (`reduce.mjs:34-40`, `reduce.mjs:654`). And a row over a non-source file has nowhere to
stand at all, because areas are built from source files only (`areas.mjs:586`, `scan.mjs:155`).

## 1. What is read

### File kinds

The corpus is `git ls-files -z` filtered to source extensions (`corpus.mjs:28`, built from
`langs.mjs:239`). Twelve declarations:

| Language | Extensions and names | Engine | Declared at |
|---|---|---|---|
| JavaScript, TypeScript | `.ts .mts .cts .js .mjs .cjs` | oxc | `langs.mjs:64` |
| JSX, TSX | `.tsx .jsx` | oxc | `langs.mjs:98` |
| Vue, Svelte | `.vue .svelte`, the script blocks only | oxc | `langs.mjs:128`, `langs.mjs:143-144` |
| Ruby | `.rb .rake .gemspec .jbuilder`, `Rakefile`, `Gemfile`, `config.ru` | Prism | `langs.mjs:153-157` |
| Python, PHP, Go, Java, C#, Rust, Kotlin | `.py .php .go .java .cs .rs .kt .kts` | tree-sitter | `langs.mjs:195-206` |

`docs/how-it-works.md:20` listed only the JavaScript and Ruby extensions at `89c17085`; the seven
tree-sitter languages are in `langs.mjs:239` and in `README.md:672`, and the same change fixed that
table row.

Every tracked file, source or not, also reaches the layout corpus for "What lives where", counted by
extension and never opened (`docs/how-it-works.md:1972-1980`).

### Constructs, from the 61 registry rows

The registry is 52 dimensions, the filename row among them, and 9 obligations (`registry.mjs:37-39`,
read off a dump of the registry). By what each one looks at:

| What is looked at | Rows |
|---|---|
| Error handling | `swallowed_error`, `error_shape`, `async_error_handling`, `rescue_uses_error`, `caught_error_used`, `service_result_shape` |
| Bindings and operators | `module_state_const`, `optional_chaining`, `nullish_default`, `non_null_assertion`, `absent_is_null`, `iterate_with_for_of`, `function_style`, `keyword_params` |
| Types | `explicit_return_type`, `type_only_import`, `declared_return_type`, `law_of_demeter` (type-checked) |
| Identifier and file names | `function_naming_case`, `exported_symbol_case`, `exported_class_case`, `exported_type_case`, `interface_prefix`, `type_alias_prefix`, `file_naming_case` |
| Inheritance | `extends_base`, `class_base`, `module_include` |
| Calls routed through a wrapper | `route_logging`, `route_network`, `route_env`, `logger_over_puts`, `http_through_client`, `zone_aware_time`, `record_lookup` |
| Tests | `test_call_style`, `assertion_style` (callee names only) |
| Comments | `doc_comment_style`, `public_doc_comment` |
| React | `hook_per_module`, `hook_call_style`, `handler_is_named`, `spread_on_component`, `text_translated`, `handler_memoised` |
| Rails models and migrations | `model_callbacks`, `migration_reversible`, `migration_schema_only`, `column_null_declared`, `table_primary_key_declared`, `reference_foreign_key` |
| Obligations | 9 Ruby rows, "a model ships with a spec" and its siblings (`pairing.mjs:45`) |

### The string values that are read

Six, and none of them for the string's own shape:

- import specifiers, for their extension and their module (`dimensions-extra.mjs:574`,
  `dimensions-capability.mjs:90-103`, `facets.mjs:193`)
- JSX text, to ask whether it is visible and untranslated (`dimensions-jsx.mjs:539-543`)
- comment text, to tell a doc comment from a TODO or a license (`dimensions-extra.mjs:884-890`)
  and to find a JSX pragma (`dimensions-extra.mjs:167`)
- a quoted object key, to tell a result object from any other (`dimensions-base.mjs:386`)
- Rails table and column names, as a symbol or a string (`dimensions-rails.mjs:83-85`), and the
  SQL handed to `execute` (`:380` and `:785`, C42); a migration's option keys are read as symbols
  only (`:141`)
- a Rails method name given as a string to `send`, `public_send`, `__send__`, `method` or
  `define_method`, so a migration's own method is found (`dimensions-rails.mjs:332` and `:308`)

### Layout, tests, history

- Area discovery, from source file counts per directory (`areas.mjs:586`).
- "What lives where": every tracked file by extension, root lines, facets (JSX, imports, exports,
  test runner, private helpers) and three sentences (`docs/how-it-works.md:1958-2383`).
- Test shape: runner per file, namesake tests, place-collected tests for Rust
  (`docs/how-it-works.md:2035-2120`).
- Co-change: which files a first-parent change that adds a file of one class also touches, mined
  from git history with no parser, so any language can get a claim (`docs/how-it-works.md:2430`).
- Authors, from `git log -M --no-merges --name-status` (`docs/how-it-works.md:884`).

## 2. What is never read

### Files never opened

Across the corpus, 91,369 of 268,541 tracked files that pass the deny list and the excluded
directories are never parsed (the `inventory.parsed` claim of `area.mjs`, aggregated from
`probe-text.mjs`). The largest kinds:

| Kind | Files | Repositories |
|---|---|---|
| `.yml` / `.yaml` | 14,492 / 1,260 | 35 / 25 |
| `.svg`, `.png`, `.jpg` | 11,450 / 9,176 / 4,243 | 30 / 34 / 24 |
| `.md`, `.mdx` | 9,589 / 2,781 | 35 / 9 |
| `.json` | 8,366 | 34 |
| `.erb`, `.haml` view templates | 7,367 / 1,180 | 19 / 3 |
| `.gjs`, `.gts` Ember template-tag components | 2,944 / 40 | discourse |
| `.scss`, `.css`, `.sass` | 2,393 / 2,058 / 466 | 19 / 23 / 2 |
| `.html` | 1,234 | 27 |
| `.sql` | 751 | 10 (cal.diy 601, supabase 103) |
| `.coffee` | 461 | 4 (openfoodnetwork 455) |
| `.hbs`, `.handlebars` | 406 / 231 | 6 / 2 |
| `.prisma`, `.graphql`, `.gql` | 51 / 13 / 3 | 3 / 3 / 1 |
| `Dockerfile`, `.github/workflows/*` | 54 / 635 | 21 / 33 |

Two of those are source in all but name. Discourse writes its components as `.gjs`, 2,944 files
the scan never sees. Nineteen Ruby repositories hold their markup, their i18n calls and their
links in view templates nobody parses.

### Constructs inside source that no row reads

Measured below: string arguments of route tables, request calls and links; i18n keys; event names;
`className` tokens and `data-testid` values; test titles; error and log messages; env var names;
object literal keys; module-level constant names; TODO form. Ruby hash key syntax and Rails lazy
lookup in views. Directory names, which `file_naming_case` does not read: it classifies a file's
stem (`dimensions-naming.mjs:246-275`) and skips the names a file router reads, `[id]`, `$param`,
`+page` (`dimensions-naming.mjs:266`).

### Wiring across files

Measured: barrel files re-exporting their siblings, and locale files holding the English file's
keys. Not measured, with the reason in section 5: a link resolving to a declared route, an i18n key
in code resolving to a key in the base locale.

## 3. Ranked: what holds a convention

"Holds" is 20 or more sites at 0.90 or more. The area column counts repositories with at least one
area proxy holding that side. "Opposite" means both sides are held somewhere in the corpus, which
is what makes a row per-repository rather than a model default.

| Rank | Class | Repositories with 20+ sites | Repositories holding, by side | Repositories holding in an area, by side | Opposite | What already sees it | Cost |
|---|---|---|---|---|---|---|---|
| 1 | URL path segments | 19 | 12: snake 7, kebab 5 | kebab 9, snake 8, camel 1 | yes | oxc (JS strings), Prism (`routes.rb`), paths (file routers) | medium to high: a learned-class row plus a gate change |
| 2 | Directory name case | 30 | 13: snake 7, kebab 6 | kebab 17, snake 14, Pascal 5, camel 4 | yes | nothing to parse: every path is in `git ls-files` | low |
| 3 | Test title starts with "should" | 35 | 17: "does not" 17 | "does not" 32, "should" 13 | yes, by area | oxc call arguments; Ruby test facets already find `it` | low |
| 4 | `.yml` against `.yaml` | 31 | 21: `.yml` 19, `.yaml` 2 | `.yml` 18, `.yaml` 3 | yes | the layout corpus already lists them | low, but no area holds a YAML file |
| 5 | Markdown file name case | 22 | 13: kebab 11, snake 2 | kebab 11, snake 2, Pascal 1 | yes | layout corpus | low to medium, no area |
| 6 | Data file name case (`.yml`, `.json`) | 26 | 10: kebab 7, snake 3 | kebab 10, snake 9 | yes | layout corpus | low to medium, no area |
| 7 | JS i18n key segment case | 8 | 7: snake 6, camel 1 | snake 6, camel 1 | yes, one repository | oxc; `text_translated` already finds the `t()` layer | low |
| 8 | Module-level primitive constant case | 22 | 4: SCREAMING 4 | SCREAMING 14, camel 5 | yes, by area | oxc; `module_state_const` visits the same declarations | low |
| 9 | Object literal key case | 28 | 10: camel 10 | camel 24, snake 7 | yes, by area | oxc | low, but keys often mirror a payload the code does not choose |
| 10 | Rails views: full i18n key against lazy `.key` | 13 | 8: full 8 | not run | no repository holds lazy at 0.90 | nothing: views are not parsed | high |
| 11 | CSS class selector case | 27 | 13: kebab 11, BEM 1, Pascal 1 | kebab 18, camel 4, BEM 2, Pascal 1 | weak | nothing: no CSS reader | high |
| 12 | i18n key shape: identifier against English text | 12 | 8: identifier 8 | identifier 9, text 3 | yes, by area | oxc | low |
| 13 | Locale files hold every English key | 14 with locale sets | 3 | not run | the opposite is the norm | nothing: YAML and JSON are not parsed | high, and an invariant more than a ratio |
| 14 | TODO form (`TODO:` against bare) | 24 | 8: `TODO:` 7, bare 1 | `TODO:` 10, bare 1 | weak | oxc comments, already read by `doc_comment_style` | low |
| 15 | Error message ends without a period | 20 | 8: no period 8 | no period 13, period 1 | weak | oxc | low |

## 4. Per-class measurements

### 4.1 URL path segments

Claim: a multi-word path segment is kebab-case (or snake_case, learned). Sites, all split on `/`
with `:param`, `*`, `[x]`, `$x` and `{x}` dropped:

- `path:` in an object, in a file importing a router (`react-router`, `vue-router`,
  `@angular/router`, `@tanstack/react-router` and four more), and `path` on a `*Route` JSX element
- the first string argument of `fetch`, `get`, `post`, `put`, `patch`, `delete`, `request`
- `to` and `href` JSX attributes that start with `/`
- in `config/routes.rb` and `config/routes/*.rb`: the string of `get`, `post`, `put`, `patch`,
  `delete`, `match`, `namespace`, `scope`, every `path:` option, and a multi-word `resources`
  symbol as the segment Rails emits (its `path:` where given, else the symbol)
- Next.js `app/` and `pages/` directory segments, only where a `package.json` names `next`, `nuxt`,
  `@sveltejs/kit` or `@remix-run/react`
- Ember `this.route("name", { path })`

```
node area.mjs "route_path.segment+http_path.segment+link_path.segment+rails_route_string.segment+rails_route_effective.segment+file_route.segment+ember_route.segment" --repos
```

| Repository | Side | Share | Sites | Files | eff |
|---|---|---|---|---|---|
| vercel/next.js | kebab | 0.992 | 5,640 | 3,522 | 2,536 |
| instructure/canvas-lms | snake | 0.991 | 2,307 | 282 | 84.7 |
| supabase/supabase | kebab | 0.996 | 479 | 387 | 187 |
| calcom/cal.diy | kebab | 0.927 | 302 | 120 | 64.2 |
| A measured Rails API | kebab | 0.978 | 275 | 1 | **1.0** |
| opf/openproject | snake | 0.977 | 259 | 34 | 5.0 |
| forem/forem | snake | 0.965 | 256 | 38 | 25.8 |
| openfoodfoundation/openfoodnetwork | snake | 0.990 | 97 | 11 | 6.2 |
| A measured React front end | kebab | 1.000 | 85 | 27 | 4.0 |
| consul/consul | snake | 0.982 | 57 | 18 | 3.6 |
| publiclab/plots2 | snake | 0.943 | 35 | 2 | **1.1** |
| diaspora/diaspora | snake | 0.939 | 33 | 3 | **1.6** |
| mastodon/mastodon | snake | 0.876 | 137 | 30 | 13.2 |
| decidim/decidim | snake | 0.863 | 51 | 5 | 2.8 |
| backstage/backstage | kebab | 0.860 | 308 | 57 | 15.9 |
| TryGhost/Ghost | kebab | 0.742 | 186 | 28 | 8.0 |
| angular/angular | kebab | 0.721 | 129 | 44 | 13.8 |
| discourse/discourse | kebab | 0.671 | 858 | 112 | 24.5 |
| alphagov/whitehall | snake | 0.542 | 59 | 2 | 1.8 |

Seven more repositories have fewer than 20 sites. 26 have any.

This is the class the corpus splits most cleanly. Within Rails alone,
`rails_route_string.segment+rails_route_effective.segment` holds snake_case in 8 repositories and
kebab-case in 1, a measured Rails API (269 of 275, all in `config/routes.rb`). That one
repository is the case a model default cannot cover: a Rails model writes snake_case, and this team
does not.

The JS route-table construct alone is rare in the corpus: `route_path.segment` has 20 or more sites
in 4 repositories. A measured React front end holds 42 of 42 kebab-case in 2 files, eff 1.0: its route table, and one page outside `src/router` that declares a path. The
request-path and link sites are what make the class wide.

Discourse and Ghost read under 0.90 because they mix a kebab-case front end with a snake_case Rails
API in one repository. Their area proxies hold one side each: discourse 4 kebab-case areas, Ghost
1. A per-area row would separate them where a repository-wide one cannot.

The concentration gate would stop 3 of the 12 repository-level holders (eff under 3), and 4 of the
9 Rails-only holders: canvas-lms (1,107 of 1,116 in 2 files, eff 1.1), a measured Rails API (1.0),
plots2 (1.1), diaspora (1.6).

### 4.2 Directory name case

Claim: a multi-word directory name is kebab-case (or snake_case, PascalCase, camelCase, learned).
A site is each distinct tracked directory, after the deny list and the excluded directories.

```
node area.mjs directory_name.case --repos
```

Holding at 0.90: snake_case in puppet 1.000 (62), consul 0.993 (140), a measured Rails API 0.992
(589), whitehall 0.978 (135), openfoodnetwork 0.960 (175), decidim 0.948 (594), mastodon 0.918
(171). kebab-case in typeorm 0.995 (442), prisma 0.991 (536), next.js 0.981 (4,795), webpack
0.974 (76), Ghost 0.963 (244), storybook 0.908 (524).

Split repositories: a measured React front end PascalCase 0.752 (335), appsmith PascalCase 0.723
(802), vscode camelCase 0.543 (923), openproject snake_case 0.615 (2,258). At area level 152
proxies hold a side. The repository-level split is partly the language (Ruby repositories lean
snake_case), but the area level is not: 5 repositories hold PascalCase areas, which is how a
component directory is named, and 4 hold camelCase.

No row reads this. `file_naming_case` reads the stem of a file (`dimensions-naming.mjs:246`).

### 4.3 Test titles that start with "should"

Claim: an `it` or `test` title does not start with "should" (or does, learned by area). Sites: the
first string argument of `it`, `test`, `it.only`, `it.skip` in a test file (JS), and of `it`,
`specify`, `test`, `scenario` in a `_spec.rb` or `_test.rb` file (Ruby).

```
node area.mjs "test_title.should+ruby_test_title.should" --repos
```

At repository level 17 hold "does not", among them prisma 0.998 (16,676), canvas-lms 0.968
(96,947 across both languages), discourse 0.941 (45,656), and 13 of the 19 Ruby repositories. None holds "should" at 0.90 across a whole repository, but several lean
that way: angular 0.850 (19,414), eslint 0.830 (2,732), typeorm 0.791 (2,878), next.js 0.755
(12,332), cal.diy 0.743 (4,558), puppet 0.510 (15,734).

The area proxies split it. "should" holds at 0.90 in 13 repositories: next.js in 34 proxies (and
"does not" in 4), angular 18 (3), backstage 18 (14), cal.diy 15 (0), typeorm 10 (0), puppet 6
(10), eslint 4 (1), and one to three in canvas-lms, forem, storybook, vscode, supabase and babel.
This is the per-area case the tool's design is built for: one repository, both habits, each held
by its own directories.

The test files are already parsed, and `test_call_style` already finds the call
(`dimensions-extra.mjs:749`). Reading its first argument is a few lines in the same visitor.

### 4.4 Non-source file names and the YAML extension

```
node area.mjs yaml.extension
node compact.mjs out2 'nonsource_name'
```

- `.yml` against `.yaml`: 21 of 31 hold, 19 `.yml` and 2 `.yaml` (backstage 0.91 of 740, vscode
  0.91 of 326). angular 0.74 and Ghost 0.57 lean `.yaml`.
- Markdown stems: 13 of 22 hold, kebab-case 11 (eslint 1.00 of 368, backstage 0.99 of 756),
  snake_case 2 (canvas-lms 0.99 of 82, rubocop 0.94 of 32).
- `.yml` and `.json` stems: 10 of 26 hold, kebab-case 7, snake_case 3 (consul 0.98 of 241,
  a measured Rails API 0.96, react 0.96).
- Stylesheet stems: 8 of 16 hold, split four ways: kebab 3, snake 3, camel 1 (vscode 0.98),
  Pascal 1 (react 1.00).

None of these files sits in an area, so a row over them has no slot (section 5).

### 4.5 i18n keys

```
node area.mjs i18n_key.segment --repos
node area.mjs i18n_key.shape --repos
node area.mjs ruby_i18n_key.segment
```

Sites: the first string of `t`, `$t`, `i18n.t`, `I18n.t`, `formatMessage({ id })`,
`<FormattedMessage id>`, `<Trans i18nKey>`, split on `.` and `:`.

- JS segment case: 7 of 8 hold, snake_case 6 (discourse 2,464 of 2,464, cal.diy 0.999, mastodon
  0.999, openproject 0.989, canvas-lms 0.977, diaspora 0.994), camelCase 1 (backstage 1,789 of
  1,789).
- Ruby segment case, in `.rb` and view templates: 12 of 12 hold snake_case. That side is the
  default and says little.
- Shape: 8 of 12 hold identifier keys. canvas-lms (0.685 English text, 19,626), vscode (0.893
  text, 2,671) and Ghost (0.742 text) lean the other way, and 3 repositories hold English-text keys
  in an area.

### 4.6 Module-level constants and object keys

```
node area.mjs const_primitive.case --repos
node area.mjs object_key.case --repos
```

- A module-level `const` bound to a string, number or boolean: 4 of 22 hold SCREAMING_SNAKE
  (mastodon 0.97, webpack 0.97, discourse 0.95, eslint 0.90). Many lean that way below 0.90, and
  openproject (0.63) and babel (0.60) lean camelCase. Area proxies: SCREAMING in 14 repositories,
  camelCase in 5.
- Object literal keys, not shorthand: 10 of 28 hold camelCase. canvas-lms (0.53 snake_case of
  144,033) and discourse (0.59 snake_case) lean the other way, and snake_case holds in an area in
  7 repositories. Those areas talk to a Rails API, so the key is the payload's choice.

### 4.7 Rails views: full keys against lazy lookup

```
for d in ~/Documents/Projects/anatomiya-corpus/*/; do node probe-lazy.mjs ${d%/}; done
```

Sites: literal `t(...)` keys in `app/views/**/*.{erb,haml,slim}`. Full keys hold at 0.90 in 8 of
13: consul 0 lazy of 1,811, forem 0 of 2,670, canvas-lms 0 of 1,665, discourse 0 of 232,
openproject 0.035, mastodon 0.056, whitehall 0, plots2 0. Lazy lookup leads in errbit (0.892 of 166) and openfoodnetwork (0.594 of 1,771). decidim (0.398) and diaspora (0.373) are split.

### 4.8 CSS

```
node area.mjs css_class.selector --repos
node area.mjs classname.token --repos
```

- Class selectors in `.css`, `.scss`, `.sass`, `.less`: 13 of 27 hold, kebab-case 11, BEM 1
  (a measured React front end 0.93 of 374), PascalCase 1 (react 0.97 of 492). 5 of
  the 13 have eff under 3. Below 0.90, whitehall leans BEM (0.85) and many repositories mix
  kebab-case with BEM.
- `className` string tokens in JSX: 9 of 15 hold kebab-case. One repository holds BEM in an area.

### 4.9 Locale key parity

```
for d in ~/Documents/Projects/anatomiya-corpus/*/; do rvm 3.4.10 do ruby probe-locales.rb ${d%/}; done
```

A locale set is the files that share a path once the locale code is replaced, under a `locales`,
`locale`, `i18n`, `lang` or `translations` directory. For each other locale, the share of the
English file's keys it holds.

- At 0.90 or more: Ghost 30,667 of 30,683 (0.999, 297 of 305 files complete), errbit 0.981,
  next.js examples 68 of 68.
- Below: forem 0.898, openfoodnetwork 0.822, cal.diy 0.814, mastodon 0.658, discourse 0.558,
  canvas-lms 0.634, consul 0.674, diaspora 0.582, decidim 0.368, plots2 0.155.
- openproject reads 0.012 and whitehall 0.122. The probe paired only one file with English in each
  of their largest sets, so those two numbers say little.

Most repositories ship English first and let the other locales lag, so "every locale holds every
key" is true where a translation pipeline enforces it and false elsewhere. That is a check against
a pipeline, not a habit a model would copy.

### 4.10 Comments and messages

```
node area.mjs "todo.form+ruby_todo.form"
node area.mjs error_message.period
```

- TODO form: 8 of 24 hold, `TODO:` 7 (appsmith 0.96 of 3,186, cal.diy 0.95, openproject 0.93),
  bare `TODO` 1 (webpack 0.97 of 151). backstage is the only repository leaning `TODO(owner)`
  (0.51).
- Error messages (`new XError("...")`, sentences only): 8 of 20 hold "no final period". The
  opposite holds in one area proxy only. typeorm (0.65) and eslint (0.57) lean towards a period.

## 5. Gate shapes that silence a whole class

**Concentration** (`reduce.mjs:653`). It needs an inverse Simpson file count of 3 and the ratio to
survive dropping the largest file. A single-file registry has eff 1.0, and dropping its one file
leaves no candidates, which `reduce.mjs:627` reads as a ratio of 0. Measured: a Rails API's
routes eff 1.0, canvas-lms 1.1, plots2 1.1, diaspora 1.6, a measured React front end's route table
1.0. The same shape stops any row over `db/schema.rb`, a single locale file, or a single
registration list.

**Applicability** (`reduce.mjs:34-40`, `reduce.mjs:654`). The construct has to appear in
`max(ceil(sqrt(F)), min(ceil(0.25 * F), 3 * ceil(sqrt(F))))` files, where `F` is every file of the
row's languages in the area (`reduce.mjs:602`). A construct in one file fails wherever `F` is 2 or
more. A measured React front end's `src/router` holds 8 tracked files and only `routes.tsx` holds route
paths, so the floor is 3 and the row fails here even if concentration were waived. An area holds at
least the area floor (`areas.mjs:27`, 3 to 8 files), so a one-file area cannot exist to escape it. #238's
two options, borrowing or an exemption from concentration, each leave this gate standing. A row
whose sites live in one registry needs its denominator to be the files that hold the registry's
construct, or a repository-wide slot.

**Borrowing helps one gate** (`reduce.mjs:641`, `reduce.mjs:650`). The prior lets a small,
consistent area clear evidence. It does nothing for concentration or applicability.

**Directories** (`reduce.mjs:661`). An area that spans more than one directory needs sites in two.
A route table in one directory of a multi-directory area fails it as well.

**Areas are source directories only** (`areas.mjs:586`, called from `scan.mjs:155` with the
corpus). A YAML, JSON, CSS, Markdown or template file is in no area, so no row over it has a slot,
whatever its counts. The layout corpus sees these files (`docs/how-it-works.md:1972`) but only as
counts on a root line.

**The extension filter** (`corpus.mjs:28`). `.gjs`, `.gts`, `.erb`, `.haml`, `.slim`, `.hbs`
and `.coffee` never reach a parser, so a convention inside them is unreadable even where it is a
source convention (Rails view i18n, Ember component code).

**The file router skip** (`dimensions-naming.mjs:266`). `file_naming_case` leaves out `[id]`,
`$param` and `+page` on purpose. Nothing else reads a router's directory names, so a file-system
route's segments are read by nothing.

**The model-default filter** (`docs/how-it-works.md:962-981`). A side the model already writes
prints as counts, not a directive. Several classes below are expected to land there. That costs
the delivery, not the check, which still enforces a stated claim.

## 6. Measured and not a per-repository convention

Each of these was measured with the same probes. Either one side holds everywhere it holds, so it
is a default and a row would add little, or nothing holds.

| Class | Repositories with 20+ sites | Result | Command |
|---|---|---|---|
| Env var names (`process.env.X`, `ENV["X"]`) | 16 JS, 18 Ruby | SCREAMING_SNAKE holds in 16 and 16, nothing else anywhere | `node area.mjs env_name.case`, `ruby_env_name.case` |
| `data-testid` values | 10 | kebab-case holds in all 10 | `node area.mjs testid.case` |
| JSX `className` tokens | 15 | kebab-case in 9, BEM in one area only | `node area.mjs classname.token` |
| Image file names | 26 | kebab-case in 14, snake_case in 3 areas | `node area.mjs nonsource_name.image` |
| Ruby i18n key segments | 12 | snake_case in all 12 | `node area.mjs ruby_i18n_key.segment` |
| Test title first letter | 25 | lowercase in 22, nothing else | `node area.mjs test_title.first_letter` |
| TODO names an owner or ticket | 24 | "no owner or ticket" in 14, the other side nowhere | `node area.mjs "todo.reference+ruby_todo.reference"` |
| Event names (`emit`, `on`, `addEventListener`, ...) | 17 | 2 hold (typeorm PascalCase, angular camelCase); the rest split by framework | `node area.mjs event_name.case` |
| Barrel re-exports every sibling | 17 | 2 hold; a barrel is complete in 0 of 9 at 0.90 | `node area.mjs barrel.reexports_every_sibling`, `barrel.complete` |
| Error message capitalised | 20 | Capitalised in 3; lowercase in one area | `node area.mjs error_message.capitalised` |
| Log message capitalised, final period | 21 | Capitalised in 13, "no period" in 3; the other sides in 2 and 0 areas | `node area.mjs log_message.capitalised`, `log_message.period` |
| Ruby hash key syntax | 19 | `key: value` in 15; puppet leans `:key =>` (0.63). A linter owns it | `node area.mjs ruby_hash_key.syntax` |

### Not measured

- **A link resolves to a declared route.** React Router nests child paths, so a declared full path
  needs the nesting joined first. Only 4 repositories have 20 or more route-table sites.
- **An i18n key in code exists in the base locale.** Each framework maps a key to a file
  differently (discourse prefixes `js.`, Rails lazy keys depend on the view path).
- **GraphQL, Prisma schema, SQL, Dockerfiles, CI workflow contents.** Counted above. Five
  repositories hold GraphQL or Prisma files, three of each, and the workflow and Dockerfile counts per repository
  (median about 13 workflows) are too small for a ratio.
- **Vue and Svelte script blocks**, skipped by `probe-js.mjs`.
- **Which side a model writes.** `scripts/measure-defaults.mjs` answers that per class, and it was
  not run. Until it is, "default" in this note means "every holder agrees", not "the model writes
  it".

## Route declarations in the language corpus

Measured on 2026-10-20 over `~/Documents/Projects/anatomiya-corpus-langs`, to see whether the seven
tree-sitter languages could carry a URL row. Each pattern is a common route form of its language,
and every path holding `test`, `docs`, `example` or `fixture` is left out (with `stub` for PHP and
`_test.go` for Go):

```
X=(':!*test*' ':!*Test*' ':!*docs*' ':!*example*' ':!*fixture*')
git grep -h -E '^\s*(re_)?path\(|@(app|router|bp|blueprint)\.(get|post|put|patch|delete|route)\(' -- '*.py' "${X[@]}"
git grep -h -E 'Route::(get|post|put|patch|delete|any|match|resource)\(' -- '*.php' "${X[@]}" ':!*stub*'
git grep -h -E '\.(GET|POST|PUT|PATCH|DELETE|HandleFunc|Handle)\("/' -- '*.go' "${X[@]}" ':!*_test.go'
git grep -h -E '\b(get|post|put|patch|delete|route)\("/' -- '*.kt' "${X[@]}"
git grep -h -E '\[(Route|Http(Get|Post|Put|Patch|Delete))\("' -- '*.cs' "${X[@]}"
git grep -h -E '@(Get|Post|Put|Patch|Delete|Request)Mapping\(' -- '*.java' '*.kt' "${X[@]}"
git grep -h -E '\.route\("/|#\[(get|post|put|patch|delete)\("' -- '*.rs' "${X[@]}"
```

| Repository | Routes |
|---|---|
| django | 0 |
| fastapi | 29 |
| flask | 9 |
| laravel/framework | 3 |
| slim | 0 |
| gin | 3 |
| caddy | 0 |
| ktor | 0 |
| jellyfin | 413 |
| commons-lang, gson, junit5, okhttp (Java, Kotlin) | 0 |
| ripgrep, serde, tokio (Rust) | 0 |

The frameworks declare their routes in tests and docs, and jellyfin is the one web application. A row
needs two real repositories that differ, so none can be measured here.

