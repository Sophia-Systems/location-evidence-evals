// main.js -- boot. Kept separate so the build inliner can concatenate all
// modules in dependency order and finish with this entry point.

import { buildApp } from "./ui.js";

function boot() {
  buildApp(document.getElementById("root"));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
