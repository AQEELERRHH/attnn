// Local stand-in for the PayBox starter's conformance check (same protocol shape:
// one process per operation, a single JSON-RPC line with _meta, no initialize).
// The official hosted checks in the developer portal remain the real test.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import Ajv2020 from "ajv/dist/2020.js";

const PROTOCOL = "2026-07-28";
const artifact = "dist/plugin.mjs";
const bytes = readFileSync(artifact);
if (bytes.length === 0 || bytes.length > 10 * 1024 * 1024) throw new Error("artifact_invalid");
const config = JSON.parse(readFileSync("paybox-plugin.json", "utf8"));
const callArgs = process.argv[2] ? JSON.parse(process.argv[2]) : config;

function op(method, params) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [artifact], { env: { PATH: process.env.PATH, NODE_ENV: "production", NO_COLOR: "1", HOME: "/tmp" } });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error(`timeout on ${method}`)); }, 10_000);
    child.stdout.on("data", (d) => {
      out += d;
      for (const line of out.split("\n").slice(0, -1)) {
        const msg = JSON.parse(line); // non-JSON on stdout = protocol_invalid
        if (msg.jsonrpc !== "2.0") reject(new Error("protocol_invalid: jsonrpc"));
        if (msg.id === undefined) continue;
        if (msg.id !== 2) reject(new Error("protocol_invalid: id"));
        clearTimeout(timer); child.kill();
        if (msg.error) return reject(new Error(`tool_failed: ${JSON.stringify(msg.error)}`));
        if (msg.result?.resultType !== "complete") return reject(new Error(`protocol_invalid: resultType=${msg.result?.resultType}`));
        return resolve(msg.result);
      }
    });
    child.stderr.on("data", (d) => { err += d; });
    child.on("exit", () => setTimeout(() => reject(new Error(`startup_failed: ${err.slice(0, 500)}`)), 50));
    child.stdin.write(JSON.stringify({
      jsonrpc: "2.0", id: 2, method,
      params: { ...params, _meta: {
        "io.modelcontextprotocol/protocolVersion": PROTOCOL,
        "io.modelcontextprotocol/clientInfo": { name: "paybox-plugin-conformance", version: "1.0.2" },
        "io.modelcontextprotocol/clientCapabilities": {},
      } },
    }) + "\n");
  });
}

const t0 = Date.now();
const list = await op("tools/list", {});
if (list.nextCursor) throw new Error("expected a single page");
const ajv = new Ajv2020({ strict: false, allErrors: true });
const names = new Set();
for (const tool of list.tools) {
  if (!tool.name || names.has(tool.name)) throw new Error("tool_catalog_invalid: name");
  names.add(tool.name);
  if (JSON.stringify(tool).includes("x-mcp-header")) throw new Error("tool_catalog_invalid: x-mcp-header");
  const size = Buffer.byteLength(JSON.stringify(tool.inputSchema)) + Buffer.byteLength(JSON.stringify(tool.outputSchema ?? {}));
  if (size > 64 * 1024) throw new Error("limit_exceeded: schema");
  ajv.compile(tool.inputSchema);
  if (tool.outputSchema) ajv.compile(tool.outputSchema);
}
const selected = list.tools.find((t) => t.name === callArgs.tool);
if (!selected) throw new Error(`config_invalid: ${callArgs.tool} not listed`);
if (!ajv.validate(selected.inputSchema, callArgs.arguments)) throw new Error(`arguments_invalid: ${ajv.errorsText()}`);
const result = await op("tools/call", { name: callArgs.tool, arguments: callArgs.arguments });
if (!Array.isArray(result.content) || result.content.length > 128) throw new Error("result_invalid: content");
if (result.isError === true) throw new Error(`tool_failed: ${result.content[0]?.text}`);
if (selected.outputSchema && !ajv.validate(selected.outputSchema, result.structuredContent)) throw new Error(`result_invalid: ${ajv.errorsText()}`);
console.log(JSON.stringify({
  status: "passed",
  tools: [...names],
  sampleCall: { tool: callArgs.tool, status: "ok" },
  artifact: { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") },
  durationMs: Date.now() - t0,
}, null, 2));
