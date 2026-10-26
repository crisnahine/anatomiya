import { test } from "node:test";
import assert from "node:assert/strict";

import { templateInertLines, templateOf } from "../plugins/anatomiya/lib/templates.mjs";

/** The lines of a template that hold code, numbered from one. */
const asking = (path, source) => templateInertLines(templateOf(path), source).flatMap((quiet, i) => (quiet ? [] : [i + 1]));

test("a view template is told by its extension, and anything else is no template", () => {
  assert.equal(templateOf("app/views/links/_link.html.erb"), "erb");
  assert.equal(templateOf("app/views/x.turbo_stream.erb"), "erb");
  assert.equal(templateOf("Views/Home/Index.cshtml"), "razor");
  assert.equal(templateOf("Pages/Counter.razor"), "razor");
  assert.equal(templateOf("app/models/a.rb"), null);
  assert.equal(templateOf("README.md"), null);
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
  assert.deepEqual(asking("a.cshtml", source), [4, 6, 8, 9, 10]);
});

test("a Razor component's code block asks through every line of it", () => {
  assert.deepEqual(asking("C.razor", "<h1>Hi</h1>\n@code {\n    private int count;\n    void Up() { count++; }\n}\n"), [2, 3, 4, 5]);
});
