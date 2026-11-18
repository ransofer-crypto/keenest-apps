#!/usr/bin/env node
// Keenest worker — runs on the office Mac.
// Picks up jobs that the Keenest sites put in Supabase (app_jobs) and runs them
// with Claude Code on this Mac, so they use the Claude subscription and the
// connectors (Notion, Financy, Morning, Higgsfield...) that are connected here.
//   kind "mcp"    -> call one connector tool, return its exact result
//   kind "sample" -> ask Claude, stream the answer back
// No packages needed (Node 18+). Settings: worker/config.json (see config.example.json).
import { spawn, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const CFG_PATH = join(HERE, "config.json");
const CFG = JSON.parse(readFileSync(CFG_PATH, "utf8"));
// First run: make our own secret, keep it only on this Mac, and register it once.
if (!CFG.secret) { CFG.secret = randomBytes(32).toString("base64url"); writeFileSync(CFG_PATH, JSON.stringify(CFG, null, 2)); }
const SB_URL = CFG.supabaseUrl || "https://ccqpmbcytrcxngnlooon.supabase.co";
const SB_KEY = CFG.supabaseKey || "sb_publishable_SbkMpYDQN-0FA92vFKeVaA_85mQn7dJ";
const SECRET = CFG.secret;
const CLAUDE = CFG.claudePath || "claude";
const MAX_PARALLEL = CFG.maxParallel || 4;
const WORKDIR = join(os.homedir(), ".keenest-worker", "run");
const LOG = join(os.homedir(), ".keenest-worker", "worker.log");
mkdirSync(WORKDIR, { recursive: true });

function log(...a) {
  const line = new Date().toISOString() + " " + a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ");
  console.log(line);
  try { appendFileSync(LOG, line + "\n"); } catch {}
}

async function rpc(name, args) {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error(`${name}: ${r.status} ${await r.text()}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
const update = (job, st, extra = {}) =>
  rpc("worker_update", { s: SECRET, job, st, part: extra.partial ?? null, res: extra.result ?? null, err: extra.error ?? null });

// ---------- which Claude Code profile runs which site ----------
function envFor(app) {
  const env = { ...process.env, MAX_MCP_OUTPUT_TOKENS: String(CFG.maxToolTokens || 400000), MCP_CONNECTION_NONBLOCKING: "false" }; // wait for the claude.ai connectors before running
  const prof = (CFG.apps && CFG.apps[app] && CFG.apps[app].profile) || null;
  if (prof) env.CLAUDE_CONFIG_DIR = prof.replace(/^~/, os.homedir());
  return env;
}

// ---------- connector names: "financy" -> the server id Claude Code uses ----------
const norm = (s) => String(s || "").toLowerCase().replace(/^claude\.ai\s+/, "").replace(/^claude_ai_/, "").replace(/[^a-z0-9]/g, "");
const sanitize = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, "_");
const serverCache = {};
function listServers(app) {
  const key = (CFG.apps && CFG.apps[app] && CFG.apps[app].profile) || "default";
  const hit = serverCache[key];
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.names;
  let out = "";
  try { out = execFileSync(CLAUDE, ["mcp", "list"], { env: envFor(app), cwd: WORKDIR, encoding: "utf8", timeout: 90000 }); } catch (e) { out = String(e.stdout || ""); }
  const names = [];
  for (const line of out.split("\n")) {
    const m = line.match(/^(.+?):\s+(https?:\/\/|\S+\s)/);
    if (m && !/^Checking/i.test(line)) names.push(m[1].trim());
  }
  serverCache[key] = { at: Date.now(), names };
  return names;
}
function serverId(app, server) {
  const alias = CFG.serverAliases && CFG.serverAliases[server];
  if (alias) return sanitize(alias);
  const names = listServers(app);
  const want = norm(server);
  const found = names.find((n) => norm(n) === want) || names.find((n) => norm(n).includes(want) || want.includes(norm(n)));
  return sanitize(found || server);
}

// ---------- run Claude Code once, reading its stream ----------
function runClaude(app, args, prompt, onEvent, signalMs) {
  return new Promise((resolve, reject) => {
    const p = spawn(CLAUDE, ["-p", "--output-format", "stream-json", "--verbose", "--no-session-persistence", ...args], { env: envFor(app), cwd: WORKDIR });
    let buf = "", errText = "";
    const timer = setTimeout(() => { p.kill("SIGTERM"); reject(Object.assign(new Error("timeout"), { code: "timeout" })); }, signalMs);
    p.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        try { onEvent(JSON.parse(line)); } catch {}
      }
    });
    p.stderr.on("data", (d) => { errText += d; });
    p.on("close", (code) => { clearTimeout(timer); if (code === 0) resolve(); else reject(Object.assign(new Error(errText.slice(-500) || "claude exited " + code), { code: "claude_failed" })); });
    p.stdin.end(prompt);
  });
}

// Claude Code may put a big tool result in a file and hand back only a note with its path.
function fromSavedFile(text) {
  const m = String(text || "").match(/saved to:?\s+(\/\S+?\.(?:txt|json))/i);
  if (!m) return null;
  try { return readFileSync(m[1], "utf8"); } catch { return null; }
}
function expandSaved(c) {
  const t = typeof c === "string" ? c : Array.isArray(c) ? c.filter((x) => x && x.type === "text").map((x) => x.text).join("") : "";
  const f = fromSavedFile(t);
  if (f == null && /saved to/i.test(t)) log("saved result file not readable:", t.slice(0, 200));
  return f != null ? f : c;
}
function parseToolContent(c) {
  if (c == null) return null;
  if (typeof c === "string") { const f = fromSavedFile(c); if (f != null) c = f; }
  else if (Array.isArray(c)) { const t = c.filter((x) => x && x.type === "text").map((x) => x.text).join(""); const f = fromSavedFile(t); if (f != null) c = f; }
  if (typeof c === "string") { try { return JSON.parse(c); } catch { return c; } }
  if (Array.isArray(c)) {
    const texts = c.filter((x) => x && x.type === "text").map((x) => x.text);
    const joined = texts.join("");
    try { return JSON.parse(joined); } catch { return joined; }
  }
  return c;
}

// kind "mcp": call exactly one tool and hand back what it returned
async function doMcp(job) {
  const { server, tool, input } = job.payload || {};
  if (!server || !tool) throw Object.assign(new Error("missing server/tool"), { code: "bad_request" });
  const allowedServers = (CFG.apps && CFG.apps[job.app] && CFG.apps[job.app].servers) || null;
  if (allowedServers && !allowedServers.includes(server)) throw Object.assign(new Error("server not allowed for this site"), { code: "not_in_manifest" });
  const sid = serverId(job.app, server);
  const full = `mcp__${sid}__${tool}`;
  const prompt =
    `Call the tool ${full} exactly once, with exactly this JSON as its input (do not change anything):\n` +
    JSON.stringify(input || {}) +
    `\nDo not call any other tool. After the tool returns, reply with the single word: done`;
  let result, isErr = false, sawCall = false;
  await runClaude(job.app, ["--model", CFG.toolModel || "haiku", "--tools", "", "--allowedTools", full, "--max-turns", "3"], prompt, (ev) => {
    if (ev.type === "assistant") for (const b of ev.message?.content || []) if (b.type === "tool_use") sawCall = true;
    // read a saved-to-file result right away: the file may be gone once Claude Code exits
    if (ev.type === "user") for (const b of ev.message?.content || []) if (b.type === "tool_result" && result === undefined) { result = expandSaved(b.content); isErr = !!b.is_error; }
  }, 4 * 60 * 1000);
  if (result === undefined) throw Object.assign(new Error(sawCall ? "the tool gave no result" : `connector "${server}" is not connected on the office Mac`), { code: sawCall ? "tool_error" : "server_not_connected" });
  const payload = parseToolContent(result);
  if (typeof payload === "string" && /exceeds maximum allowed tokens|RESULT_TOO_LARGE/i.test(payload)) isErr = true;
  if (isErr) {
    const msg = typeof payload === "string" ? payload : JSON.stringify(payload);
    let code = /exceeds maximum allowed tokens|too large/i.test(msg) ? "RESULT_TOO_LARGE" : "tool_error";
    if (/permission|not allowed|denied/i.test(msg)) code = "server_not_connected";
    if (/auth|token|expired|unauthori[sz]ed|reconnect/i.test(msg)) code = "needs_reauth";
    throw Object.assign(new Error(msg.slice(0, 2000)), { code, result: payload });
  }
  return { payload, content: Array.isArray(result) ? result : [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result) }] };
}

// kind "mcp_all": page a list tool to the end here on the Mac, so the site can be closed meanwhile.
// payload: { server, tool, input, keep:[top-level fields to keep per item], limit }
async function doMcpAll(job) {
  const { server, tool, input = {}, keep = null } = job.payload || {};
  let lim = Number(job.payload?.limit) || 60, cursor = null, pages = 0;
  const data = [];
  const pick = (o) => { if (!keep || !o || typeof o !== "object") return o; const r = {}; for (const k of keep) if (o[k] !== undefined) r[k] = o[k]; return r; };
  for (;;) {
    const inp = { ...input, limit: lim }; if (cursor) inp.cursor = cursor;
    let out = null;
    for (let i = 0; i < 3 && !out; i++) {
      try { out = await doMcp({ ...job, payload: { server, tool, input: inp } }); }
      catch (e) {
        if (e.code === "RESULT_TOO_LARGE" && lim > 10) { lim = Math.max(10, Math.floor(lim / 2)); inp.limit = lim; i--; continue; }
        if (i < 2 && ["server_not_connected", "timeout", "claude_failed", "tool_error"].includes(e.code)) { await new Promise((r) => setTimeout(r, 8000)); continue; }
        throw e;
      }
    }
    const p = out.payload || {};
    for (const it of p.data || []) data.push(pick(it));
    cursor = p.nextPage || null; pages++;
    await update(job.id, "running", { partial: String(data.length) }).catch(() => {});
    if (!cursor || pages >= 300) break;
  }
  return { payload: { data, pages } };
}

// kind "sample": a plain Claude answer, streamed
async function doSample(job) {
  const { messages = [], system } = job.payload || {};
  const conv = messages.map((m) => {
    const c = typeof m.content === "string" ? m.content : (m.content || []).map((x) => x.text || "").join("");
    return (m.role === "assistant" ? "ASSISTANT:\n" : "USER:\n") + c;
  }).join("\n\n");
  const prompt =
    (messages.length > 1 ? "Here is the conversation so far. Write only the next ASSISTANT reply, nothing else.\n\n" : "") + conv;
  let text = "", lastSent = 0, final = null, failed = null;
  const args = ["--model", (job.payload && job.payload.model) || CFG.sampleModel || "sonnet", "--tools", "", "--strict-mcp-config", "--include-partial-messages", "--max-turns", "1"];
  if (system) args.push("--append-system-prompt", system);
  await runClaude(job.app, args, prompt, (ev) => {
    if (ev.type === "stream_event" && ev.event?.type === "content_block_delta" && ev.event.delta?.type === "text_delta") {
      text += ev.event.delta.text;
      if (Date.now() - lastSent > 700) { lastSent = Date.now(); update(job.id, null, { partial: text }).catch(() => {}); }
    }
    if (ev.type === "result" && typeof ev.result === "string") final = ev.result;
    if (ev.type === "result" && ev.is_error) failed = ev.result || "error";
  }, 7 * 60 * 1000);
  if (failed) throw Object.assign(new Error(failed), { code: "failed" });
  return { text: final ?? text };
}

const running = new Set();
async function handle(job) {
  running.add(job.id);
  const t0 = Date.now();
  try {
    const result = job.kind === "mcp" ? await doMcp(job) : job.kind === "mcp_all" ? await doMcpAll(job) : job.kind === "sample" ? await doSample(job) : { ok: true };
    await update(job.id, "done", { result });
    log("done", job.app, job.kind, job.payload?.server || "", job.payload?.tool || "", `${Date.now() - t0}ms`);
  } catch (e) {
    log("error", job.app, job.kind, job.payload?.tool || "", e.code || "", String(e.message).slice(0, 300));
    await update(job.id, "error", { error: { code: e.code || "failed", message: hebrew(e) } }).catch(() => {});
  } finally { running.delete(job.id); }
}
function hebrew(e) {
  const m = { RESULT_TOO_LARGE: "RESULT_TOO_LARGE", server_not_connected: "החיבור הזה לא מחובר ב-Claude Code במחשב במשרד.", needs_reauth: "החיבור פג במחשב במשרד וצריך להתחבר מחדש.", timeout: "לקח יותר מדי זמן. נסו שוב.", not_in_manifest: "לאתר הזה אין הרשאה לחיבור הזה." };
  return (m[e.code] || "משהו השתבש במחשב במשרד.") + (e.code === "tool_error" ? " " + String(e.message).slice(0, 300) : "");
}

const REPO = join(HERE, "..");
function head() { try { return execFileSync("git", ["-C", REPO, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { return ""; } }
const STARTED_AT = head();
function selfUpdate() {
  try {
    // GitHub is the only source of truth for this folder (config.json is not tracked, so it stays)
    execFileSync("git", ["-C", REPO, "fetch", "-q", "origin", "main"], { encoding: "utf8", timeout: 60000 });
    execFileSync("git", ["-C", REPO, "reset", "-q", "--hard", "origin/main"], { encoding: "utf8", timeout: 60000 });
    const now = head();
    if (now && STARTED_AT && now !== STARTED_AT) {
      log("new worker code", now.slice(0, 7), "— restarting when idle");
      const t = setInterval(() => { if (running.size === 0) { clearInterval(t); process.exit(0); } }, 2000);
    }
  } catch (e) { log("self-update failed", String(e.message).slice(0, 200)); }
}
setInterval(selfUpdate, 3 * 60 * 1000);

async function loop() {
  log("Keenest worker started", os.hostname(), STARTED_AT.slice(0, 7));
  for (;;) {
    try {
      const free = MAX_PARALLEL - running.size;
      const jobs = await rpc("worker_claim", { s: SECRET, n: Math.max(0, free) });
      for (const j of jobs || []) handle(j);
    } catch (e) { log("poll failed", String(e.message).slice(0, 200)); await new Promise((r) => setTimeout(r, 10000)); }
    await new Promise((r) => setTimeout(r, 1500));
  }
}
if (process.argv[2] === "--servers") { console.log(listServers(process.argv[3] || "")); process.exit(0); }
const ok = await rpc("worker_register", { s: SECRET }).catch((e) => { log("register failed", e.message); return false; });
if (!ok) { log("This Mac's secret is not the registered one. Ask Claude to reset the worker pairing."); process.exit(1); }
await rpc("worker_hello", { s: SECRET, v: STARTED_AT.slice(0, 7) }).catch(() => {});
loop();
