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

function boot() {
  if (wantsStory()) {
    location.replace("./story.html");
    return;
  }
  buildApp(document.getElementById("root"));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
