# How code search ranks a symbol, and what an index buys an agent

Research notes, October 2026. Two questions. First, how do established code-search and symbol-index
tools rank a symbol for an identifier or a sentence of words? Second, what does published evidence say
about handing a coding agent a pre-built symbol index instead of grep, in tokens and in tasks solved?
The answers are set against `findSymbols` in `plugins/anatomiya/lib/code-index.mjs` as it stands on the
`code-index` branch.

Every claim is traced to the source that owns it: source code at a pinned commit, the vendor's own docs or
engineering blog, or the paper's own text. Each carries a label:

- **measured**: an empirical result with numbers behind it
- **vendor claim**: a first-party statement by a tool maker about its own product, with no numbers
- **code**: what the source does, read at the pinned commit
- **anecdotal**: said by someone who built the thing, and said by them to rest on feel

What the review made of it (H60): adjustment 2, one score per word in its best field, shipped and took
the mean reciprocal rank on 19 queries from 0.794 to 0.833; adjustment 1, a whole-name bonus, changed no
rank and was left out; the importer prior stayed a multiplier, since capping it read 0.790 and dropping
it 0.684. The section below describes `findSymbols` as it stood before those changes.

Pinned commits: Zoekt `cd5b7bc424e1ce81b20f561c12a92c96b1ef6149`, Aider `5dc9490bb35f9729ef2c95d00a19ccd30c26339c`,
SCIP `bbec5345bfae602b31286a9ec74e2c2042713f50`, all `main` on 2026-10-28.

## What anatomiya does today

`findSymbols` splits names on camelCase and snake_case, folds endings (`s`, `es`, `ing`, `ation` and a few
more), adds the whole name run together as one more word, and weighs each asked word by
`log(1 + N / (1 + df))` over the index's names. A word counts 3 in the name, 2 in the container, 1 in the doc
sentence and 1 in the path. Each field counts a word once. The field scores are summed, multiplied by
`1 + 0.15 * log2(1 + importers)`, halved in a test file, and the top 12 are printed one line each with
parameters, `path:line`, kind, container, importer count and the doc sentence.

## 1. Zoekt

Zoekt is the trigram index behind Sourcegraph's indexed search. It has two scorers, picked by
`SearchOptions.UseBM25Scoring`.

**The classic scorer** (code). `index/score.go`, `scoreLine`, scores each candidate match on a line and keeps
the best line:
https://github.com/sourcegraph/zoekt/blob/cd5b7bc424e1ce81b20f561c12a92c96b1ef6149/index/score.go

- A match on word boundaries at both ends adds `scoreWordMatch` (500); a boundary at one end only adds
  `scorePartialWordMatch` (50).
- A match that covers a whole symbol adds `scoreSymbol` (7000). One that starts or ends with the symbol adds
  the mean of 7000 and 4000, and one inside a symbol adds `scorePartialSymbol` (4000). Filenames get the same
  split through `scoreBase` (7000) and `scorePartialBase` (4000).
- The symbol's kind adds `scoreSymbolKind(...) * scoreKindMatch` (100). The constants and the comment that
  bounds all query-dependent signals "at ~9000" are in `index/contentprovider.go`, lines 589 to 610:
  https://github.com/sourcegraph/zoekt/blob/cd5b7bc424e1ce81b20f561c12a92c96b1ef6149/index/contentprovider.go
- `scoreSymbolKind` (same file, line 720) gives a generic order: class 10, struct 9.5, enum 9, interface and
  type 8, function and method 7, field 5.5, constant 5, variable 4, anything else 1. Per-language tables
  override it. For Go it adds 0.5 to an exported (capitalised) symbol and multiplies the factor by 0.8 in a
  `_test.go` file.
- `scoreFile` adds an "atom" bonus of `(1 - 1/n) * 400` for a file matched by `n` distinct query atoms, then
  computes `ScoreOffset * score + 100 * repoRank + 10 * docOrderScore` with `ScoreOffset = 10_000_000`. The
  query score is truncated first, so repository rank and the file's order in the index break ties only. They
  never lift a weaker match over a stronger one.

**The BM25 scorer** (code). `scoreFileBM25` and `scoreLineBM25` in the same `score.go`:

- `calculateTermFrequency` counts a match in a filename or a symbol as 5 (`importantTermBoost`), a content match
  as 1. In a low-priority file the counts are divided by 5 (`lowPriorityFilePenalty`). Low priority means test,
  vendored, generated or binary (`FileCategory.lowPriority`,
  https://github.com/sourcegraph/zoekt/blob/cd5b7bc424e1ce81b20f561c12a92c96b1ef6149/index/file_category.go),
  falling back to `enry.IsTest` or `enry.IsVendor` on the path (`isLowPriority`).
- Term frequency saturates with Lucene's defaults, `k = 1.2`, `b = 0.75` (`tfScore`).
- IDF is held constant on purpose. The comment above `scoreFileBM25` says: "our evaluations ... showed that for
  keyword style queries, idf can down-weight the score of some keywords too much, leading to a worse ranking.
  The intuition is that each keyword is important independently of how frequent it appears in the corpus."
  The evaluation itself is not published in the repository.

**Sourcegraph's account of the BM25 change** (measured, vendor's own eval):
https://sourcegraph.com/blog/keeping-it-boring-and-relevant-with-bm25f

- They used BM25F, adding the boost to term frequencies before saturation. They rejected summing one BM25
  score per field because "this gives too big an advantage to files with a match on multiple fields."
- The 5x boost came from "a tiny grid of options against our internal evaluation datasets", and "the final
  ranking is not too sensitive to the exact choice of boost."
- "BM25 showed roughly 20% improvement across all key metrics compared to our baseline ranking." The size and
  makeup of the evaluation set are not given.

## 2. Sourcegraph symbol search and file ranking

- Symbol search "matches declarations instead of plain text", uses ctags on demand, and indexes exact
  (`^foo$`) and prefix (`^foo`) matches. The page says nothing about how symbol results are ordered (vendor
  claim): https://sourcegraph.com/docs/code-search/types/symbol
- "Ranking in a week" builds a graph whose nodes are files and whose edges mean "a reference of a symbol
  (variable, function, type, etc) defined in another file", runs PageRank on it undirected, and reads the
  result as a measure of code reuse. The only check reported is that the team "hand-vetted the document
  scores". No metric (vendor claim): https://sourcegraph.com/blog/ranking-in-a-week
- How that rank meets the query score is not said in the post. In Zoekt's code it arrives as index order
  (`docOrderScore`) and repository rank, both tiebreakers (code, section 1).

## 3. GitHub code search

The engineering post says the indexer builds "ngram indices (for content, symbols, and paths)", uses "sparse
grams" of dynamic size instead of trigrams, assigns document IDs "based on the ranking of each document", and
the query service will "re-sort by score ... and return the top 100". It names no ranking signal and does not
describe definition search. Its numbers are system numbers: p99 per shard about 100 ms, a 25 TB index, about
120,000 documents a second ingested (vendor claim):
https://github.blog/engineering/architecture-optimization/the-technology-behind-githubs-new-code-search/

Nothing here bears on how to rank one symbol, beyond the fact that symbols are kept in their own index.

## 4. What a symbol record holds: ctags and SCIP

**universal-ctags** (vendor docs): https://docs.ctags.io/en/latest/man/ctags.1.html, "Extension fields".
A tag has `name`, `input` (file) and `pattern`. Optional fields include `line` (`n`), `kind` (`k`, `K`),
`scope` (`s`, the enclosing class or namespace), `signature` (`S`, "a language-dependent representation of the
signature of a routine", C-family only and without the return type), `end` (`e`, last line), `roles` (`r`),
`access` (`a`, visibility of a class member) and `typeref` (`t`, a variable's type or a callable's return type).

**SCIP** (spec, `scip.proto`):
https://github.com/sourcegraph/scip/blob/bbec5345bfae602b31286a9ec74e2c2042713f50/scip.proto

- `SymbolInformation` holds `symbol` (a globally unique id), `documentation` (markdown, docstrings),
  `relationships` (implements, type definition), `kind` (86 named kinds), `display_name`,
  `signature_documentation` and `enclosing_symbol`.
- An `Occurrence` holds a range, the symbol and `symbol_roles`. The roles are `Definition`, `Import`,
  `WriteAccess`, `ReadAccess`, `Generated`, `Test` and `ForwardDefinition`. References are first-class, so a
  reference count is derived, not stored.

**anatomiya's record** is `[name, kind, line, container, params, doc, importers]` with five kinds (`fn`,
`method`, `class`, `type`, `const`), from `plugins/anatomiya/lib/symbols.mjs` and `code-index.mjs`. Against the
two above it has the same core (name, kind, line, scope, signature, first doc line) and adds an importer
count that neither stores. It lacks an end line, visibility (`access`), a return type (`typeref`) and
generated-code marking.

## 5. Splitting identifiers for retrieval

- **CodeSearchNet** (measured): https://arxiv.org/pdf/1909.09436v3. The neural models split identifiers into
  subtokens ("a variable camelCase yields two subtokens camel and case"), or use BPE. The ElasticSearch
  baseline indexed two fields per function, "the function name, split into subtokens" and the whole function
  text, with the default tokenizer. On the 99 human-rated queries (Table 4, NDCG Within, average over six
  languages) ElasticSearch scored 0.337 against 0.574 for neural bag of words and 0.493 for self-attention.
  The authors' reading: keyword search "performs quite well. It has the advantage of being able to
  efficiently use rare terms, which often appear in code", and the best model "is particularly good at keyword
  matching". The paper does not ablate splitting itself, so it shows only that every system they built split
  names.
- **Dit, Guerrouj, Poshyvanyk, Antoniol, ICPC 2011, "Can Better Identifier Splitting Techniques Help Feature
  Location?"** (measured): https://www.cs.wm.edu/~denys/pubs/ICPC2011-IdentifierSplitting.pdf. CamelCase
  splitting, Samurai and hand splitting, on Rhino and jEdit (four datasets of features and bugs). From the
  abstract: IR-based feature location "can benefit from better preprocessing algorithms in some cases", with a
  statistically significant gain for hand splitting over the tools "in those cases", and no gain once
  execution data is added. Plain camelCase splitting is the baseline they improve on in some cases only.
- Hill, Binkley, Lawrie, Pollock and Vijay-Shanker (Empirical Software Engineering, 2013) compare five
  splitters on splitting accuracy. I did not read its text, so nothing here rests on it:
  https://www.eecis.udel.edu/~pollock/879tainsef13/idsplittjournal.pdf
- **Stemming or suffix folding on code queries**: I found no primary source that measures it. Zoekt does
  substring matching with no tokenizer, and the CodeSearchNet baseline used ElasticSearch's default analyzer,
  which does not stem. anatomiya's folding is untested by this literature either way.

## 6. Agents with an index versus grep

**Aider repo map** (code; no measurement).
https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/repomap.py

- `get_ranked_tags` builds a graph with files as nodes. It adds an edge from each file that references an
  identifier to each file that defines it, weighted `mul * sqrt(num_refs)`. `mul` is x10 if the identifier is
  mentioned in the chat, x10 if it is snake, kebab or camel case and at least 8 characters, x0.1 if it starts
  with `_`, and x0.1 if more than 5 files define it. A reference from a file in the chat is a further x50.
  The square root is there so that "high freq (low value) mentions don't dominate".
- It runs `nx.pagerank` personalised toward chat files and mentioned names, then spreads each file's rank over
  its outgoing edges to rank `(file, identifier)` definitions.
- `get_ranked_tags_map_uncached` binary-searches how many ranked tags fit the token budget, accepting within
  15%. The default budget is `map_tokens=1024`, multiplied by `map_mul_no_files=8` when no file is in the chat.
- Docs and the 2023 post describe the design and report no benchmark, token comparison or success rate
  (vendor claim): https://aider.chat/docs/repomap.html, https://aider.chat/2023/10/22/repomap.html

**SWE-agent** (measured): https://arxiv.org/html/2405.15793v3

- Commands `find_file`, `search_file` and `search_dir`. "The search commands return at most 50 results for
  each search query." The interface "encourages efficient searches by suppressing verbose results."
- Search ablation on SWE-bench Lite with GPT-4 Turbo: summarized search (the default) resolved 18.0%,
  iterative search 12.0%, no search tool 15.7%. Iterative search did worse than none.
- The paper's reason: "when given a large number of search results, agents tend to look through every match
  exhaustively, calling next until each result has been inspected", which "can exhaust an agent's cost budget
  or context window."
- This compares output shapes of grep-like tools. It does not compare an index against grep.

**Agentless** (measured): https://arxiv.org/html/2407.01489

- Localisation goes repository tree, then suspicious files (prompt plus embedding retrieval), then a
  "skeleton" of each file (class and function headers, fields, method signatures, class and module comments),
  then edit locations.
- Skeleton against complete file for finding related elements (Table 2): 58.33% against 53.67% of ground-truth
  locations kept, $0.02 against $0.15 per issue. The paper puts this down to LLMs handling long context poorly.
- File-level localisation: prompting 78.67%, embeddings with folder filtering 70.33%, both combined 81.67%.
- Whole pipeline: 32.00% resolved on SWE-bench Lite at $0.70 per issue (78,166 tokens on average), against
  SWE-agent at $1.62 to $2.53 per issue in the same table. Those are different systems, not a controlled test.

**LocAgent, Chen et al. 2025** (measured): https://arxiv.org/html/2503.09089

- Parses a repository into a graph of files, classes and functions with imports, calls and inheritance, and
  gives the agent `SearchEntity`, `TraverseGraph` and `RetrieveEntity`. `SearchEntity` tries entity ids, then
  names, then a BM25 index over entity ids, then a code-chunk index: "When an exact match isn't found in the
  upper index, the system performs a fuzzy search using the lower index."
- Ablation (Table 6, Qwen-2.5-7B fine-tuned, File Acc@5 / Function Acc@10): full 88.32 / 71.53, without
  `SearchEntity` 68.98 / 53.28, without the BM25 index 75.18 / 60.22, without `TraverseGraph` 86.13 / 66.06.
  The entity search carries most of the result. The graph walk adds a few points.
- Cost per example (Table 5): $0.66 with Claude 3.5, $0.05 to $0.09 with the fine-tuned open models, against
  $0.46 to $0.83 for MoatlessTools, SWE-agent and OpenHands. The 86% saving is from model swap and
  fine-tuning, not from the index.
- Its 92.7% file-level figure and the 12% Pass@10 gain on issue resolution are from the abstract.

**RepoGraph** (abstract only): https://arxiv.org/abs/2410.14684 says the plug-in "substantially boosts the
performance of all systems" across four SWE-bench methods. The abstract gives no numbers and I did not read
the tables, so nothing here rests on it.

**Anthropic on Claude Code** (anecdotal, first-party):

- Boris Cherny, on Latent Space (https://www.latent.space/p/claude-code): the team first indexed code with an
  embedding service, then moved to "just regular code search" with glob and grep, which "outperformed
  everything. By a lot." He says it was "just vibes, so internal vibes", with internal benchmarks that were
  "mostly vibes". He names the cost, "at the cost of latency and tokens", and two reasons against an index:
  "the code drifts out of sync", and a hosted index raises security and liability concerns.
- The current docs list search ("find files by pattern, search content with regex") and, through plugins, code
  intelligence ("jump to definitions, find references") as tool categories. They publish no comparison (vendor
  claim): https://code.claude.com/docs/en/how-claude-code-works
- That comparison was against an embedding index, not a symbol-name index like anatomiya's.

**Where evidence is absent.** I found no controlled study that gives one agent grep alone and the same agent
grep plus a symbol-name index, and reports tokens and success on the same tasks. The closest are LocAgent's
ablation (removing entity search, on a fine-tuned 7B model, localisation only) and SWE-agent's ablation (output
shape of grep-like tools). Neither measures reuse of an existing helper, which is what `find` is for.

## What this means for anatomiya's find

Confirmations:

- **Split identifiers into words.** Every retrieval system in CodeSearchNet split names into subtokens, and
  keyword matching over them held up well against neural models on human-rated queries (CodeSearchNet,
  section 5). Keep it.
- **Rarity weighting fits sentence queries.** CodeSearchNet credits keyword search with using rare terms well.
  Zoekt dropped IDF, but its own comment scopes that to "keyword style queries" (section 1). A `find` query is a
  sentence of the job's words, where `new` and `id` would bury `uuid`, which is the case the current
  `weightsOf` comment records. Keep IDF. Do not copy Zoekt's constant-IDF choice without a measurement on
  sentence queries.
- **Name above container above doc and path.** Zoekt and Sourcegraph boost symbol and filename matches 5 to 1
  over content and found the result "not too sensitive to the exact choice of boost" (section 1). The 3/2/1
  ladder is in line with that. No source supports tuning it further by reasoning.
- **Push test files down.** Zoekt divides term frequency by 5 in test, vendored and generated files, and
  multiplies a Go symbol's kind factor by 0.8 in `_test.go` (section 1). Halving is in the same direction.
- **A short, capped, one-line-per-hit list.** SWE-agent's capped, summarized search beat both iterative search
  and no search, 18.0% against 12.0% and 15.7% (section 6). Agentless's signature-plus-comment skeleton kept
  more right answers than whole files at about a seventh of the cost (section 6). Twelve lines with parameters
  and a doc sentence is that shape. Do not raise the cap or add pagination: SWE-agent measured that paging
  through results costs more than having no search at all.

Adjustments the evidence supports, each still to be measured on anatomiya's own corpus before it ships:

1. **A whole-name match should beat a partial one by a clear margin.** Zoekt gives 7000 for a match covering
   the whole symbol and 4000 for a partial one, and Sourcegraph's symbol search indexes exact `^foo$` matches
   (sections 1 and 2). Today `compareUrls` asked for scores `compareUrls` above `compareUrlsLater` only by
   the one run-together word, and a high-reach `compareUrlsLater` can pass it. A bonus when the query's
   run-together words equal the whole name would follow Zoekt.
2. **Do not sum a word across fields; take its best field.** Sourcegraph rejected per-field sums because they
   give "too big an advantage" to multi-field matches (section 1). Today one word in the name, container, doc
   and path counts 3 + 2 + 1 + 1 = 7, so a method of a class named after the word, in a file named after it,
   can beat the one function whose name and doc say exactly what was asked. Counting each asked word once, at
   its highest field weight, is a simple stand-in for BM25F's saturation.
3. **Make importer reach a tiebreaker or cap its pull.** Zoekt keeps every static rank (repository rank, index
   order from Sourcegraph's PageRank) below the query score, so it only breaks ties (section 1). Aider takes the
   square root of reference counts so frequent mentions "don't dominate" (section 6). Today 252 importers
   multiply a score by 2.2, which can lift a helper that matches one asked word over one that matches three. No
   source measured importer weight for finding a helper to reuse, so the size of the multiplier is anatomiya's
   own call. The sources agree that it should not override the match.
4. **Push down private names.** Zoekt adds 0.5 to an exported Go symbol, and Aider multiplies an identifier
   starting with `_` by 0.1 (sections 1 and 6). A leading `_` or `#` is in the name already, so this needs no
   new field. Full visibility (ctags `access`) would need the parsers to record it.
5. **Kind is a signal, but not in Zoekt's order.** Zoekt ranks class above function above field above
   constant, for a person jumping to a definition (section 1). `find` serves someone about to write a function,
   so no published order fits. Leave kind out of the score until a corpus run shows it helps.

What the evidence says not to do:

- Do not claim `find` saves tokens or raises success rates. No published study measures a symbol-name index
  against grep for one agent on the same tasks (section 6). The Claude Code team's own call went the other way
  for an embedding index, and they say it rested on feel.
- Do not treat a stale index as an answer. The one reason Anthropic's team gave against indexes that applies
  here is that "the code drifts out of sync" (section 6). `find.md` already tells the session the index is from
  the last scan and to grep as well. Keep that, and keep step 3 of the command (read the file before deciding).
- Do not add stemming beyond what a test case needs on the strength of IR folklore. No source here measured
  suffix folding on code queries (section 5).
- Do not swap the word index for embeddings on these grounds. In CodeSearchNet keyword search was competitive,
  and in Agentless the embedding path alone (70.33%) lost to prompting over the tree (78.67%) at file level
  (sections 5 and 6).
