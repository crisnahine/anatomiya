# What the README quotes, and where to see it again

Date: 2026-10-25. Every map line, notice and `check` result the README shows came from the runs below,
on public repositories at the commits named, with this repository's code at the change that added this
page (its plugin code is anatomiya 0.18.0's). Clone the repository, check out the commit, run
`node plugins/anatomiya/bin/anatomiya.mjs scan <clone>` from this repository, and read the area file
for the directory named. A line that reads differently on a rerun is the thing to report.

## Map lines

| Repository and commit | Directory | The line, and its counts |
|---|---|---|
| [mastodon/mastodon](https://github.com/mastodon/mastodon) at `3f5c32f` | `app/controllers/api/v1` | classes here inherit Api::BaseController / 58 of 59 sites across 59 of 59 files, 51 authors |
| [mastodon/mastodon](https://github.com/mastodon/mastodon) at `3f5c32f` | `app/controllers/admin` | request parameters are filtered through params.expect / 37 of 37 sites across 33 of 70 files, 36 authors  (partial: some sites are not visible statically) |
| [mastodon/mastodon](https://github.com/mastodon/mastodon) at `3f5c32f` | `app/javascript/mastodon/actions` | network calls go through the repository's own client, not fetch directly / 91 of 94 sites across 20 of 63 files, 37 authors  (partial: some sites are not visible statically) |
| [forem/forem](https://github.com/forem/forem) at `b5237b1` | `db/migrate` | migrations change the schema and leave the data alone / 927 of 936 sites across 935 of 949 files, 70 authors  (partial: some sites are not visible statically) |
| [alphagov/whitehall](https://github.com/alphagov/whitehall) at `4484836` | `test/unit/app/models/edition` | times are read and built through the application time zone / 21 of 21 sites across 6 of 23 files, 50 authors |
| [mastodon/mastodon](https://github.com/mastodon/mastodon) at `3f5c32f` | `app/javascript/mastodon/utils` | most imported from here: WithRouterPropTypes (9 files), DAY (5), assetHost (5), OnElementHandler (4), compareUrls (4) |
| [rubocop/rubocop](https://github.com/rubocop/rubocop) at `f009b33` | `lib/rubocop/cop/style` | a .rb file added to "lib/rubocop/cop/style" ships with an edit to "config/default.yml" / 100 of the last 100 changes that added one, 22 authors |
| [excalidraw/excalidraw](https://github.com/excalidraw/excalidraw) at `438d898` | `packages/element/tests` | possibly-absent values are read with ?., not asserted with ! / 178 of 182 sites across 10 of 26 files, 31 authors  (partial: some sites are not visible statically) |
| [forem/forem](https://github.com/forem/forem) at `b5237b1` | overview, What lives where | app/javascript: 321 .jsx (JSX), 297 .js and 33 other; 49 story files; 143 of 149 test files under __tests__; 78 of 196 have a namesake test; 220 sibling modules named index/actions/actionsPanel; 71 of 311 JSX files inline a helper |

## Sizes

What Claude Code loads: the overview on every turn, and a directory's own file when the agent reads a
file in it. Bytes as written by the scan above.

| Repository and commit | Overview | Area files | Median area file |
|---|---|---|---|
| rubocop at `f009b33` | 2,338 | 34 | 481 |
| forem at `b5237b1` | 2,829 | 124 | 843 |
| mastodon at `3f5c32f` | 2,869 | 129 | 908 |
| discourse at `2d1c470` | 2,768 | 447 | 978 |
| excalidraw at `438d898` | 3,414 | 38 | 2,306 |

## The notice before a write

rubocop at `f009b33`, after a scan, asked through the PreToolUse hook about a `Write` to
`lib/rubocop/cop/style/reverse_first.rb`, a path where no file exists yet:

```text
anatomiya: lib/rubocop/cop/style/reverse_first.rb
  A .rb file added here ships with a new .md file in "changelog": 97 of the last 100 changes that added one.
  A .rb file added here ships with an edit to "config/default.yml": 100 of the last 100 changes that added one.
  A .rb file added here ships with an edit to "lib/rubocop.rb": 99 of the last 100 changes that added one.
  Make those changes in the same change, or say why this file does not need them.
```

## `check` on three branches

Each branch adds one file on top of the commit and is checked before it is committed.

rubocop at `f009b33`, after a scan and a pin, with `lib/rubocop/cop/style/reverse_first.rb` added alone (a cop
class that flags `array.reverse.first` and autocorrects it to `array.last`, and nothing else):

```text
base origin/HEAD (f009b33), 0 changed files, 1 examined, compare
1 MUST-FIX, 2 FIX, 0 NIT

MUST-FIX  "lib/rubocop/cop/style/reverse_first.rb":1  a .rb file added to "lib/rubocop/cop/style" ships with an edit to "config/default.yml"
  all 100 of the last 100 changes that added one; no "config/default.yml"

FIX  "lib/rubocop/cop/style/reverse_first.rb":1  a .rb file added to "lib/rubocop/cop/style" ships with a new .md file in "changelog"
  97 of the last 100 changes that added one; no "changelog/*.md"

FIX  "lib/rubocop/cop/style/reverse_first.rb":1  a .rb file added to "lib/rubocop/cop/style" ships with an edit to "lib/rubocop.rb"
  99 of the last 100 changes that added one; no "lib/rubocop.rb"
```

The third finding asks for an edit the repository no longer makes: rubocop moved cop registration out
of `lib/rubocop.rb` and into `lib/rubocop/cop/style.rb` in
[e9defb6](https://github.com/rubocop/rubocop/commit/e9defb651dff92627ac49ddca76211011c7cf08c), "Load cops lazily", and has added one
style cop since. The claim stays until the newest changes outweigh it (D14).

mastodon at `3f5c32f`, after a scan and a pin, with `app/controllers/api/v1/bookmark_folders_controller.rb`
added, a controller that inherits `ApplicationController`:

```ruby
# frozen_string_literal: true

class Api::V1::BookmarkFoldersController < ApplicationController
  def index
    render json: current_account.bookmark_folders
  end

  def create
    folder = current_account.bookmark_folders.create!(params.permit(:title))
    render json: folder
  end
end
```

```text
base origin/HEAD (3f5c32f), 0 changed files, 1 examined, compare
0 MUST-FIX, 1 FIX, 0 NIT

FIX  "app/controllers/api/v1/bookmark_folders_controller.rb":3  classes here inherit Api::BaseController
  BookmarkFoldersController: 58 of 59 baseline sites conform
```

excalidraw at `438d898`, after a scan and a pin, with `packages/element/tests/rotate.test.ts` added, a
test that imports a type without `import type` and asserts `found!`. Two FIX findings, at line 1 for the
import and at line 8 for `found!`.
