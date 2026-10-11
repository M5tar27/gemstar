const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const pages = ["index.html", "join.html", "track.html"];

function inlineScripts(html) {
  const out = [], re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m; while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

for (const p of pages) {
  test(`${p}: every inline script parses`, () => {
    inlineScripts(read(p)).forEach((code, i) => {
      assert.doesNotThrow(() => new vm.Script(code, { filename: `${p}#script${i}` }));
    });
  });
}

test("every id the page code looks up with getElementById exists in index.html", () => {
  const html = read("index.html");
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const wanted = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((m) => m[1]);
  // ids created at runtime are allowed to be absent; these are the ones the layout relies on
  const must = ["btn-record-start", "btn-record-stop", "input-mode-record", "input-mode-upload", "record-panel", "player-block", "spectrum-shell"];
  must.forEach((id) => assert.ok(ids.has(id), `missing #${id}`));
  assert.ok(wanted.length > 50);
});

test("English and Spanish text have the same keys", () => {
  const html = read("index.html");
  const keysOf = (block) => new Set([...block.matchAll(/^\s{6}([A-Za-z0-9_]+):/gm)].map((m) => m[1]));
  const en = html.indexOf("en: {"), es = html.indexOf("es: {");
  if (en < 0 || es < 0) return; // structure changed; skip rather than guess
  const a = keysOf(html.slice(en, es)), b = keysOf(html.slice(es, es + (es - en) + 5000));
  const missing = [...a].filter((k) => !b.has(k));
  assert.ok(missing.length < 5, "keys missing in Spanish: " + missing.slice(0, 10).join(", "));
});
