// Type-check, build twice (bytes must match), unit tests, then the local conformance check.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
const run = (cmd) => execSync(cmd, { stdio: ["ignore", "inherit", "inherit"] });
run("pnpm --silent typecheck");
run("pnpm --silent build");
const first = readFileSync("dist/plugin.mjs");
run("pnpm --silent build");
if (!first.equals(readFileSync("dist/plugin.mjs"))) throw new Error("build_not_deterministic");
run("node --import tsx --test test/arc.test.ts");
run("node scripts/conformance.mjs");
