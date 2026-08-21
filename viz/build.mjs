#!/usr/bin/env node
// build.mjs -- emit the single self-contained deliverable viz/index.html.
//
// Plain Node, no dependencies. Concatenates the ES modules in dependency
// order with import/export lines stripped into one IIFE, inlines the CSS,
// and verifies the result: the extracted script must parse (node --check)
// and the emitted file's only permitted network dependency is the Carto
// basemap tile host (v2 adjudication: tiles allowed, superseding the
// original zero-network clause; the inlined vector geography keeps the page
// fully functional offline). No other http(s) URLs, no import statements,
// no fetch calls.
//
// Run: node viz/build.mjs

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = (f) => readFileSync(join(here, "src", f), "utf8");

// Dependency order: each file only uses names defined above it.
const MODULES = [
  "geo.js",
  "map-data.js",
  "ramps.js",
  "engine.js",
  "render.js",
  "ui.js",
  "main.js",
];

function stripModule(code, name) {
  const out = [];
  let inImport = false;
  for (const line of code.split("\n")) {
    // drop import statements, including multi-line named-import blocks
    if (inImport) {
      if (/from\s+["'][^"']+["'];?\s*$/.test(line)) inImport = false;
      continue;
    }
    if (/^\s*import\s/.test(line)) {
      if (!/from\s+["'][^"']+["'];?\s*$/.test(line)) inImport = true;
      continue;
    }
    // drop full-line comments (also removes attribution URLs, keeping the
    // emitted file free of http(s) strings)
    if (/^\s*\/\//.test(line)) continue;
    // unwrap export declarations
    out.push(line.replace(/^(\s*)export\s+(const|let|var|function|class)\s/, "$1$2 "));
  }
  const body = out.join("\n");
  if (/^\s*export\s/m.test(body) || /^\s*import\s/m.test(body)) {
    throw new Error(`${name}: unhandled import/export form survived stripping`);
  }
  return `// ---- ${name} ----\n${body}`;
}

const script = `(() => {\n"use strict";\n${MODULES.map((m) => stripModule(src(m), m)).join("\n")}\n})();`;
const css = src("style.css");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Verifying compute location</title>
<style>
${css}
</style>
</head>
<body>
<div id="root"></div>
<script>
${script}
</script>
</body>
</html>
`;

// ---- verification ---------------------------------------------------------

// 1. The concatenated script must parse as plain (non-module) JS.
const tmp = mkdtempSync(join(tmpdir(), "viz-build-"));
try {
  const f = join(tmp, "bundle.js");
  writeFileSync(f, script);
  execFileSync(process.execPath, ["--check", f], { stdio: "pipe" });
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// 2. Network surface: every http(s) URL must point at the whitelisted Carto
// tile host; nothing else may phone home (no imports, fetch, XHR, link/src).
// Exception: NAV_LINKS are user-clicked <a href> navigation targets (the
// research-page link in the intro blurb) -- they load nothing unless clicked,
// so they are not part of the page's network surface.
const TILE_HOST = "basemaps.cartocdn.com";
const NAV_LINKS = new Set(["https://johnx.co/research", "https://caish.org/hardware"]);
for (const m of html.matchAll(/https?:\/\/[^\s"'`\\]+/g)) {
  if (!m[0].includes(TILE_HOST) && !NAV_LINKS.has(m[0])) {
    console.error(`FAIL: emitted html contains non-whitelisted URL: ${m[0]}`);
    process.exit(1);
  }
}
for (const [pattern, why] of [
  [/^\s*import\s/m, "import statement"],
  [/\bfetch\s*\(/, "fetch call"],
  [/XMLHttpRequest/, "XHR"],
  [/<link\s/i, "external link tag"],
  [/\bsrc\s*=\s*["'](?!data:)/i, "external src attribute"],
]) {
  if (pattern.test(html)) {
    console.error(`FAIL: emitted html contains ${why} (${pattern})`);
    process.exit(1);
  }
}

const out = join(here, "index.html");
writeFileSync(out, html);
console.log(
  `wrote ${out}: ${(html.length / 1024).toFixed(1)} KB (script ${(script.length / 1024).toFixed(1)} KB, css ${(css.length / 1024).toFixed(1)} KB)`
);
console.log(
  "checks: script parses (node --check); network surface limited to the Carto tile host; no import/fetch/XHR/link/src refs"
);
