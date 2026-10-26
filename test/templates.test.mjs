import { test } from "node:test";
import assert from "node:assert/strict";

import { markupCodeLines, templateInertLines, templateOf } from "../plugins/anatomiya/lib/templates.mjs";

/** The lines of a component's markup that hold code, numbered from one. */
const markupAsking = (kind, source) => markupCodeLines(kind, source).flatMap((asks, i) => (asks ? [i + 1] : []));

/** The lines of a template that hold code, numbered from one. */
const asking = (path, source) => templateInertLines(templateOf(path), source).flatMap((quiet, i) => (quiet ? [] : [i + 1]));

test("a view template is told by its extension, and anything else is no template", () => {
  assert.equal(templateOf("app/views/links/_link.html.erb"), "erb");
  assert.equal(templateOf("app/views/x.turbo_stream.erb"), "erb");
  assert.equal(templateOf("Views/Home/Index.cshtml"), "razor");
  assert.equal(templateOf("Pages/Counter.razor"), "razor");
  assert.equal(templateOf("app/views/a/show.html.haml"), "haml");
  assert.equal(templateOf("app/views/a/show.html.slim"), "slim");
  assert.equal(templateOf("templates/page.jinja"), "jinja");
  assert.equal(templateOf("templates/page.html.j2"), "jinja");
  assert.equal(templateOf("web/templates/page.tmpl"), "gotmpl");
  assert.equal(templateOf("web/templates/page.gotmpl"), "gotmpl");
  assert.equal(templateOf("app/models/a.rb"), null);
  assert.equal(templateOf("README.md"), null);
  // An `.html` file is anybody's: Angular, Vue, Django or plain markup, and no one rule reads all of them.
  assert.equal(templateOf("templates/page.html"), null);
});

test("an ERB line holding Ruby asks, through a tag spread over lines, and markup, a comment tag and an escaped tag ask nothing", () => {
  const source = [
    "<div>",
    "  <% if URI(link).host != Whitehall.public_host %>",
    "    <a href=\"<%= link %>\" rel=\"external\">x</a>",
    "  <% end %>",
    "  <%# a note %>",
    "  <%% literal %>",
    "  <% total = items.sum do |i|",
    "       i.price",
    "     end %>",
    "</div>",
  ].join("\n");
  assert.deepEqual(asking("a.html.erb", source), [2, 3, 4, 7, 8, 9]);
});

test("an ERB comment tag spread over lines asks nothing, and a tag never closed asks to the end", () => {
  assert.deepEqual(asking("a.erb", "<%# one\n two %>\n<p>x</p>\n"), []);
  assert.deepEqual(asking("a.erb", "<p>a</p>\n<% x = 1\n<p>b</p>\n"), [2, 3]);
});

test("a Razor line holding C# asks, and a code block asks through its closing brace, while markup, a directive that names a type and an e-mail address ask nothing", () => {
  const source = [
    "@model LinkViewModel",
    "@using Acme.Web",
    "<p>Write to admin@example.com</p>",
    "@if (Uri.TryCreate(Model.Href, UriKind.Absolute, out var u) && u.Host != Request.Host.Host)",
    "{",
    "    <a href=\"@Model.Href\" rel=\"external\">x</a>",
    "}",
    "@{",
    "    var total = Model.Items.Sum(i => i.Price);",
    "}",
    "@* a note *@",
    "<p>@@handle</p>",
  ].join("\n");
  // A line of braces alone opens or closes a block and computes nothing.
  assert.deepEqual(asking("a.cshtml", source), [4, 6, 8, 9]);
});

test("a Razor control block holds C# on every line that is not markup, through the brace that closes it and the else after it", () => {
  const source = [
    "@if (Model.On)",
    "{",
    "    var total = Math.Round(Model.Price * 1.2m, 2);",
    "    <p>@total</p>",
    "    <p>plain</p>",
    "}",
    "else",
    "{",
    "    var none = 0;",
    "}",
    "@foreach (var x in Model.Items) {",
    "    var y = x * 2;",
    "}",
    "<p>after</p>",
  ].join("\n");
  assert.deepEqual(asking("a.cshtml", source), [1, 3, 4, 7, 9, 11, 12]);
});

test("a Razor component's code block asks on every line of C# in it", () => {
  assert.deepEqual(asking("C.razor", "<h1>Hi</h1>\n@code {\n    private int count;\n    void Up() { count++; }\n}\n"), [2, 3, 4]);
  // A brace in a string opens and closes nothing.
  assert.deepEqual(asking("C.razor", '@code {\n    string s = "}";\n    int n = 1;\n}\n<p>x</p>\n'), [1, 2, 3]);
});

test("a HAML or Slim line holding Ruby asks: a line of code, an output line, a tag's output and an interpolation", () => {
  const haml = ["%div", "  - total = items.sum(&:price)", "  %p= number_to_currency(total)", "  %p Hello #{user.name}", "  %p plain text", "  -# a comment"].join("\n");
  assert.deepEqual(asking("show.html.haml", haml), [2, 3, 4]);
  const slim = ["div", "  - total = items.sum(&:price)", "  p = number_to_currency(total)", "  p Hello #{user.name}", "  p plain text", "  / a comment"].join("\n");
  assert.deepEqual(asking("show.html.slim", slim), [2, 3, 4]);
});

test("a Jinja or Go template line asks where an expression or a statement holds a call or an operator, and a plain name asks nothing", () => {
  const jinja = ["<p>{{ user.name }}</p>", "<p>{{ price | round(2) }}</p>", "{% if total > 100 %}", "<p>{{ format_money(total) }}</p>", "{% endif %}", "{# a note #}"].join("\n");
  assert.deepEqual(asking("page.jinja", jinja), [2, 3, 4]);
  const go = ['<p>{{ .Name }}</p>', '<p>{{ printf "%.2f" .Price }}</p>', "{{ if gt .Total 100 }}", "{{ end }}", "{{/* a note */}}"].join("\n");
  assert.deepEqual(asking("page.tmpl", go), [2, 3]);
});

test("a component's markup asks where an expression in it computes with a literal, and a name, a call with names, a comparison or a toggle asks nothing", () => {
  const vue = [
    "<template>",
    "  <p>{{ user.name }}</p>",
    "  <p>{{ (price * 1.2).toFixed(2) }}</p>",
    '  <b :title="label">x</b>',
    '  <b :title="format(label)">x</b>',
    '  <i @click="open = !open">y</i>',
    "  <a :href=\"'/users/' + id\">u</a>",
    "  <p>{{ $t('greeting') }}</p>",
    "</template>",
    "<script setup>",
    "const total = price * 1.2",
    "</script>",
  ].join("\n");
  assert.deepEqual(markupAsking("vue", vue), [3, 7]);
  const svelte = ["<p>{user.name}</p>", "<p>{(price * 1.2).toFixed(2)}</p>", "{#if total > 100}", "<p>big</p>", "{/if}", "<button on:click={() => count++}>+</button>"].join("\n");
  assert.deepEqual(markupAsking("svelte", svelte), [2]);
});

test("a line past the length a rule reads asks unread, and reading it takes no time", () => {
  // The rules run on every line of a changed view inside the stop's budget, and a minified line is a megabyte.
  const long = "{{".repeat(60_000);
  for (const [path, line] of [["a.jinja", long], ["a.cshtml", `@{\n${'"\\'.repeat(60_000)}\n}`], ["a.tmpl", long]]) {
    const started = performance.now();
    const asks = asking(path, line);
    assert.ok(performance.now() - started < 200, `${path} took ${Math.round(performance.now() - started)} ms`);
    assert.ok(asks.length > 0, path);
  }
  const started = performance.now();
  assert.deepEqual(markupAsking("vue", `<p>${long}</p>`), [1]);
  assert.ok(performance.now() - started < 200);
});

test("HAML and Slim attributes written in Ruby ask, and a quoted attribute asks nothing", () => {
  assert.deepEqual(asking("a.haml", "%a{ href: format_price(x) } Buy\n%p(title=format(x)) hi\n%p(title='plain') hi\n%p{ class: 'x' } hi\n"), [1, 2, 4]);
  assert.deepEqual(asking("a.slim", "a[href=format_price(x)] Buy\np(title=\"plain\") hi\n"), [1]);
});

test("Razor text and markup inside a block open and close no braces", () => {
  const source = ["@{", "    @: brace { here", "    <p>plain</p>", "}", "plain words after", "<p>more</p>"].join("\n");
  assert.deepEqual(asking("a.cshtml", source), [1]);
});

test("a Jinja raw block is text", () => {
  assert.deepEqual(asking("a.jinja", "{% raw %}{{ a + b }}{% endraw %}\n<p>{{ a + b }}</p>\n"), [2]);
});
