# The corpora

Every measurement under `docs/measurements/` names the repositories it ran on. This page lists them
with the commit each local clone sat at on 2026-10-25, so a reader can clone the same tree and run the
same command. A measurement that names its own commit was taken there; the commits below are where the
clones stand now.

Three corpora are used, and a measurement says which:

- The acceptance corpus, 35 repositories: 33 public ones and 2 private ones. It is what
  `npm run e2e:corpus` and `scripts/measure-layout.mjs` run on. The 2 private repositories are a Rails
  API and a React front end; a measurement describes them as `rails-api` and `react-front-end` and
  never by their names or paths (G16). Every number taken from them can be checked only by their
  owner.
- The language corpus, 25 public repositories for the seven tree-sitter languages and the
  Vue and Svelte script blocks. The 35 plus these 25 are the "60 measured repositories" several
  sections count; the 35 plus the nine Go, PHP and Python ones among these are the "44" the
  co-change measurement read, as cloned and again deepened (`docs/measurements/2026-10-11-cochange.md`).
- The applications corpus, 25 public applications, used for the URL rows and the unread
  classes. The three together are the "85".

The review-comment figures in `docs/why.md` (4,616 comments at one company, 3,015 from ten public
repositories, 317 defect comments) come from a classification done before this repository existed.
Neither the per-comment labels nor the list of the ten repositories is kept here, so those figures
cannot be checked from this repository.

## The acceptance corpus

| Repository | Commit | History |
|---|---|---|
| [alphagov/whitehall](https://github.com/alphagov/whitehall) | `44848361bcf7` | full |
| [angular/angular](https://github.com/angular/angular) | `d3d3bc62eae0` | full |
| [appsmithorg/appsmith](https://github.com/appsmithorg/appsmith) | `33ec55297f07` | full |
| [babel/babel](https://github.com/babel/babel) | `1eac4481473d` | full |
| [backstage/backstage](https://github.com/backstage/backstage) | `eeac444a9aba` | full |
| [calcom/cal.diy](https://github.com/calcom/cal.diy) | `176037d0afbe` | full |
| [chef/chef](https://github.com/chef/chef) | `a4cc5cd1d8b1` | full |
| [consul/consul](https://github.com/consul/consul) | `9d072cca7a68` | full |
| [decidim/decidim](https://github.com/decidim/decidim) | `8c714bf189fd` | full |
| [diaspora/diaspora](https://github.com/diaspora/diaspora) | `f96527862dc1` | full |
| [discourse/discourse](https://github.com/discourse/discourse) | `2d1c4701e62e` | full |
| rails-api (private, described by this name only) | not published | shallow |
| react-front-end (private, described by this name only) | not published | full |
| [errbit/errbit](https://github.com/errbit/errbit) | `4bd14f9fa1da` | full |
| [eslint/eslint](https://github.com/eslint/eslint) | `dc1e7a841693` | full |
| [fastlane/fastlane](https://github.com/fastlane/fastlane) | `38d0ec404332` | full |
| [forem/forem](https://github.com/forem/forem) | `b5237b126cf2` | full |
| [Homebrew/brew](https://github.com/Homebrew/brew) | `6cf9b128d3b7` | full |
| [huginn/huginn](https://github.com/huginn/huginn) | `f5833475f5cc` | full |
| [instructure/canvas-lms](https://github.com/instructure/canvas-lms) | `1c9f0bb8013e` | full |
| [mastodon/mastodon](https://github.com/mastodon/mastodon) | `3f5c32f43f57` | full |
| [microsoft/vscode](https://github.com/microsoft/vscode) | `a589bb7374a4` | full |
| [openfoodfoundation/openfoodnetwork](https://github.com/openfoodfoundation/openfoodnetwork) | `4e121e10f1ac` | full |
| [opf/openproject](https://github.com/opf/openproject) | `b3262b08aa1c` | full |
| [prisma/prisma](https://github.com/prisma/prisma) | `4df1c997c73a` | full |
| [publiclab/plots2](https://github.com/publiclab/plots2) | `5e1d8c2bac1c` | full |
| [puppetlabs/puppet](https://github.com/puppetlabs/puppet) | `e227c2754097` | full |
| [react/react](https://github.com/react/react) | `beef6d60f46a` | full |
| [rubocop/rubocop](https://github.com/rubocop/rubocop) | `f009b338048e` | full |
| [storybookjs/storybook](https://github.com/storybookjs/storybook) | `4d267f2636bd` | full |
| [supabase/supabase](https://github.com/supabase/supabase) | `18dc7e971d3f` | full |
| [TryGhost/Ghost](https://github.com/TryGhost/Ghost) | `407e032dc77e` | full |
| [typeorm/typeorm](https://github.com/typeorm/typeorm) | `df07bf1ef46f` | full |
| [vercel/next.js](https://github.com/vercel/next.js) | `c77d3f45a5b9` | full |
| [webpack/webpack](https://github.com/webpack/webpack) | `f02461706eae` | full |

## The language corpus

| Repository | Commit | History |
|---|---|---|
| [apache/commons-lang](https://github.com/apache/commons-lang) | `682a8ff5cddf` | shallow |
| [BurntSushi/ripgrep](https://github.com/BurntSushi/ripgrep) | `3fce3b5bb023` | shallow |
| [caddyserver/caddy](https://github.com/caddyserver/caddy) | `8ae69fae1e16` | shallow |
| [composer/composer](https://github.com/composer/composer) | `560806f89275` | shallow |
| [django/django](https://github.com/django/django) | `135d7c606fc6` | shallow |
| [element-plus/element-plus](https://github.com/element-plus/element-plus) | `88f4a8ed77ac` | shallow |
| [fastapi/fastapi](https://github.com/fastapi/fastapi) | `94918c1d40af` | shallow |
| [gin-gonic/gin](https://github.com/gin-gonic/gin) | `43fe48e8a0f4` | shallow |
| [gohugoio/hugo](https://github.com/gohugoio/hugo) | `31f5395d4094` | shallow |
| [google/gson](https://github.com/google/gson) | `845664ba1c30` | shallow |
| [huntabyte/shadcn-svelte](https://github.com/huntabyte/shadcn-svelte) | `493481fab94f` | shallow |
| [JamesNK/Newtonsoft.Json](https://github.com/JamesNK/Newtonsoft.Json) | `52fa3aef1f2c` | shallow |
| [jellyfin/jellyfin](https://github.com/jellyfin/jellyfin) | `32efb47601d3` | shallow |
| [junit-team/junit5](https://github.com/junit-team/junit5) | `47bbcd1f19ec` | shallow |
| [Kotlin/kotlinx.serialization](https://github.com/Kotlin/kotlinx.serialization) | `938b86dd400a` | shallow |
| [ktorio/ktor](https://github.com/ktorio/ktor) | `f76c50da18f6` | shallow |
| [laravel/framework](https://github.com/laravel/framework) | `725381d29c9f` | shallow |
| [pallets/flask](https://github.com/pallets/flask) | `d73fa1cdcbd8` | shallow |
| [serde-rs/serde](https://github.com/serde-rs/serde) | `6693a89cca77` | shallow |
| [serilog/serilog](https://github.com/serilog/serilog) | `bebc7719004f` | shallow |
| [slimphp/Slim](https://github.com/slimphp/Slim) | `3675bf6baac6` | shallow |
| [square/okhttp](https://github.com/square/okhttp) | `42e5888d4562` | shallow |
| [sveltejs/kit](https://github.com/sveltejs/kit) | `9b5654340f3b` | shallow |
| [tokio-rs/tokio](https://github.com/tokio-rs/tokio) | `16b1f9d2cfbd` | shallow |
| [vuejs/vitepress](https://github.com/vuejs/vitepress) | `8cc9e3432f8b` | shallow |

## The applications corpus

| Repository | Commit | History |
|---|---|---|
| [apache/dolphinscheduler](https://github.com/apache/dolphinscheduler) | `89817f16f69b` | full |
| [atuinsh/atuin](https://github.com/atuinsh/atuin) | `854654ec1ec6` | full |
| [bitwarden/server](https://github.com/bitwarden/server) | `8fb62cff78af` | full |
| [BookStackApp/BookStack](https://github.com/BookStackApp/BookStack) | `045c6a98cac2` | full |
| [CTFd/CTFd](https://github.com/CTFd/CTFd) | `d21c9cd3bb15` | full |
| [dani-garcia/vaultwarden](https://github.com/dani-garcia/vaultwarden) | `b71cb7a83208` | full |
| [dotnet/eShop](https://github.com/dotnet/eShop) | `913acea66708` | full |
| [firefly-iii/firefly-iii](https://github.com/firefly-iii/firefly-iii) | `b9c31006e8d3` | full |
| [go-gitea/gitea](https://github.com/go-gitea/gitea) | `facc0f2b1546` | full |
| [gotify/server](https://github.com/gotify/server) | `f4de6199f080` | full |
| [healthchecks/healthchecks](https://github.com/healthchecks/healthchecks) | `59caeef534d5` | full |
| [JetBrains/kotlinconf-app](https://github.com/JetBrains/kotlinconf-app) | `907ce238e1ff` | full |
| [koel/koel](https://github.com/koel/koel) | `fac6f8d4a8ff` | full |
| [ktorio/ktor-samples](https://github.com/ktorio/ktor-samples) | `1c9df7cf102d` | full |
| [LemmyNet/lemmy](https://github.com/LemmyNet/lemmy) | `f462da567f15` | full |
| [macrozheng/mall](https://github.com/macrozheng/mall) | `dcaa93b31503` | full |
| [mealie-recipes/mealie](https://github.com/mealie-recipes/mealie) | `7f099c91fb3d` | full |
| [meilisearch/meilisearch](https://github.com/meilisearch/meilisearch) | `7b6f9f39bd91` | full |
| [monicahq/monica](https://github.com/monicahq/monica) | `6e6ec217457e` | full |
| [netbox-community/netbox](https://github.com/netbox-community/netbox) | `350ac040cc91` | full |
| [nopSolutions/nopCommerce](https://github.com/nopSolutions/nopCommerce) | `f9e883bc9586` | full |
| [photoprism/photoprism](https://github.com/photoprism/photoprism) | `8b592713bb7c` | full |
| [thingsboard/thingsboard](https://github.com/thingsboard/thingsboard) | `7bfc40863666` | full |
| [umputun/remark42](https://github.com/umputun/remark42) | `4de6532c0a4e` | full |
| [woodpecker-ci/woodpecker](https://github.com/woodpecker-ci/woodpecker) | `aca84ce05add` | full |
