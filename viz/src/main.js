// main.js -- boot. Kept separate so the build inliner can concatenate all
// modules in dependency order and finish with this entry point.

import { buildApp } from "./ui.js";

// The bench is desktop-optimized (#app pins min-width 1080px); small
// screens get the scroll story instead, which sits next to this page in
// both the src/ dev shells and the built deliverables. `?full` is the
// escape hatch (and what the story's own "full demo" link uses, so the
// two pages never bounce between each other).
function wantsStory() {
  if (new URLSearchParams(location.search).has("full")) return false;
  return window.matchMedia("(max-width: 760px)").matches;
}

// The story sits next to this page, but "next to" depends on how this page
// was addressed: opened as .../index.html (files, dev shells), a relative
// "./story.html" resolves beside it -- while behind a clean-URL rewrite
// (johnx.co serves this page at /demos/location-evidence-evals with no
// trailing slash), the same relative link would resolve into the PARENT
// directory and 404. An extensionless path therefore appends /story.html
// to the page's own path segment instead.
function storyUrl() {
  const p = location.pathname;
  return p.endsWith(".html") ? "./story.html" : `${p.replace(/\/+$/, "")}/story.html`;
}

function boot() {
  if (wantsStory()) {
    location.replace(storyUrl());
    return;
  }
  buildApp(document.getElementById("root"));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
