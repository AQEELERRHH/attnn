#!/usr/bin/env node
// Wrapper so Arc Studio's --host flag maps to Next.js's --hostname
const { spawnSync } = require("child_process");
const args = process.argv.slice(2)
  .map((s) => (s === "--host" ? "--hostname" : s))
  .filter((s) => s !== "--strictPort");
spawnSync("./node_modules/.bin/next", ["dev", ...args], { stdio: "inherit", shell: false });
