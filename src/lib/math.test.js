// @ts-nocheck: run by node --test, which needs the .ts import extension.
// Run with: node --test src/lib/
import assert from "node:assert/strict";
import test from "node:test";
import { Marked } from "marked";
import { matchBlockMath, matchInlineMath, mathExtension } from "./math.ts";

const md = new Marked(mathExtension((tex, display) => (display ? `<mD>${tex}</mD>` : `<mI>${tex}</mI>`)), { breaks: true, gfm: true });
const html = (s) => md.parse(s).trim();
const tex = (s) => matchInlineMath(s)?.tex;

test("inline dollar math", () => {
  assert.equal(tex("$x^2$ and more"), "x^2");
  assert.equal(tex("$a + b$"), "a + b");
  assert.equal(tex("$\\alpha$."), "\\alpha");
  assert.equal(tex("$a \\$ b$"), "a \\$ b");
});

test("dollar amounts are text", () => {
  assert.equal(tex("$5 and $10"), undefined);
  assert.equal(tex("$1,000 to $2,000."), undefined);
  assert.equal(tex("$5-$10"), undefined);
  assert.equal(tex("$HOME/bin:$PATH"), undefined);
  assert.equal(tex("$ 5$"), undefined);
  assert.equal(tex("$x $"), undefined);
  assert.equal(html("It costs $5 and $10 today."), "<p>It costs $5 and $10 today.</p>");
});

test("escaped dollars", () => {
  assert.equal(html("pay \\$5 or \\$6"), "<p>pay $5 or $6</p>");
  assert.equal(html("\\$a$ and $b$"), "<p>$a$ and <mI>b</mI></p>");
});

test("adjacent math", () => {
  assert.equal(html("$a$$b$"), "<p><mI>a</mI><mI>b</mI></p>");
  assert.equal(html("$a$ and $b$"), "<p><mI>a</mI> and <mI>b</mI></p>");
});

test("$$ inline is display, \\( \\) inline, \\[ \\] display", () => {
  assert.deepEqual(matchInlineMath("$$x$$ tail"), { raw: "$$x$$", tex: "x", display: true });
  assert.equal(html("see \\(a+b\\) ok"), "<p>see <mI>a+b</mI> ok</p>");
  assert.equal(html("see \\[a+b\\] ok"), "<p>see <mD>a+b</mD> ok</p>");
  assert.equal(matchInlineMath("\\(unclosed"), undefined);
  assert.equal(matchInlineMath("$$"), undefined);
  assert.equal(matchInlineMath("$$ $$"), undefined);
});

test("display blocks", () => {
  assert.equal(html("$$\nE = mc^2\n$$"), "<mD>\nE = mc^2\n</mD>");
  assert.equal(html("intro\n$$\na\n$$\noutro"), "<p>intro</p>\n<mD>\na\n</mD>\n<p>outro</p>");
  assert.equal(html("\\[\nx\n\\]"), "<mD>\nx\n</mD>");
  assert.equal(html("$$x$$"), "<mD>x</mD>");
  // Something after the closer on its line: an inline display in a paragraph, not a block.
  assert.equal(html("$$x$$ is nice"), "<p><mD>x</mD> is nice</p>");
  assert.equal(matchBlockMath("$$x$$ is nice"), undefined);
});

test("unclosed $$ stays text while streaming", () => {
  assert.equal(matchBlockMath("$$\nE = mc^2"), undefined);
  assert.equal(html("$$\nE = mc^2"), "<p>$$<br>E = mc^2</p>");
  // A blank line ends the search, so a stray $$ can't swallow what follows.
  assert.equal(matchBlockMath("$$\nx\n\ny\n$$"), undefined);
});

test("code is never math", () => {
  assert.equal(html("`$a$` and `$b$`"), "<p><code>$a$</code> and <code>$b$</code></p>");
  assert.equal(html("```\n$$\nx\n$$\n```"), '<pre><code>$$\nx\n$$\n</code></pre>');
  assert.equal(html("    $$\n    x\n    $$"), "<pre><code>$$\nx\n$$\n</code></pre>");
});

test("math in lists, quotes and tables", () => {
  assert.equal(html("- a $x$\n- b"), "<ul>\n<li>a <mI>x</mI></li>\n<li>b</li>\n</ul>");
  assert.equal(html("> $x$"), "<blockquote>\n<p><mI>x</mI></p>\n</blockquote>");
  assert.match(html("| a |\n|---|\n| $x_1$ |"), /<td><mI>x_1<\/mI><\/td>/);
});

test("tex is not touched by markdown", () => {
  assert.equal(html("$a_b * c_d$"), "<p><mI>a_b * c_d</mI></p>");
  assert.equal(html("$a*b*c$"), "<p><mI>a*b*c</mI></p>");
});
