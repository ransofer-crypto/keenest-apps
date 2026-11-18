#!/usr/bin/env node
// kdb — small command line access to the Keenest sites' data (Supabase app_docs),
// used by Claude Code on the office Mac during "agent" jobs.
//   node kdb.mjs list  <app> <coll> [--fields a,b,c] [--where field=value]
//   node kdb.mjs get   <app> <coll> <id>
//   node kdb.mjs set   <app> <coll> <id> '<json>'      (replaces the doc; '@file.json' reads a file)
//   node kdb.mjs merge <app> <coll> <id> '<json>'      (top-level merge into the doc)
//   node kdb.mjs del   <app> <coll> <id>
//   node kdb.mjs batch <app> '@ops.json'               ([{op:"set"|"merge"|"del", coll, id, data}])
//   node kdb.mjs upload <app> <file>                   (puts a file online, prints {id,url}; up to 50 MB)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CFG = JSON.parse(readFileSync(join(HERE, "config.json"), "utf8"));
const SB_URL = CFG.supabaseUrl || "https://ccqpmbcytrcxngnlooon.supabase.co";
const SB_KEY = CFG.supabaseKey || "sb_publishable_SbkMpYDQN-0FA92vFKeVaA_85mQn7dJ";
const S = CFG.secret;
const ALLOWED = (process.env.KDB_APPS || "").split(",").filter(Boolean);

async function rpc(name, args) {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ s: S, ...args }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${name}: ${r.status} ${t}`);
  return t ? JSON.parse(t) : null;
}
const json = (x) => (String(x).startsWith("@") ? JSON.parse(readFileSync(String(x).slice(1), "utf8")) : JSON.parse(x));
const out = (x) => process.stdout.write(JSON.stringify(x) + "\n");

const [cmd, app, ...rest] = process.argv.slice(2);
try {
  if (!cmd || !app) throw new Error("usage: kdb list|get|set|merge|del|batch <app> ...");
  if (ALLOWED.length && !ALLOWED.includes(app)) throw new Error(`this job may only use: ${ALLOWED.join(", ")}`);
  if (cmd === "list") {
    const coll = rest[0];
    const fi = rest.indexOf("--fields"), wi = rest.indexOf("--where");
    const fields = fi >= 0 ? rest[fi + 1].split(",") : null;
    const where = wi >= 0 ? rest[wi + 1].split("=") : null;
    let rows = await rpc("worker_docs_list", { a: app, c: coll });
    if (where) rows = rows.filter((r) => String(r.data?.[where[0]]) === where[1]);
    if (fields) rows = rows.map((r) => { const d = {}; for (const f of fields) if (r.data && f in r.data) d[f] = r.data[f]; return { id: r.id, data: d }; });
    out(rows);
  } else if (cmd === "get") {
    const rows = await rpc("worker_docs_list", { a: app, c: rest[0] });
    const r = rows.find((x) => x.id === rest[1]);
    out(r ? r.data : null);
  } else if (cmd === "set" || cmd === "merge") {
    out(await rpc("worker_docs_put", { a: app, c: rest[0], i: rest[1], d: json(rest[2]), merge: cmd === "merge" }));
  } else if (cmd === "del") {
    out(await rpc("worker_docs_del", { a: app, c: rest[0], i: rest[1] }));
  } else if (cmd === "batch") {
    let n = 0;
    for (const o of json(rest[0])) {
      if (o.op === "del") await rpc("worker_docs_del", { a: app, c: o.coll, i: o.id });
      else await rpc("worker_docs_put", { a: app, c: o.coll, i: o.id, d: o.data, merge: o.op === "merge" });
      n++;
    }
    out({ ok: n });
  } else if (cmd === "upload") {
    const f = rest[0];
    const ext = (f.split(".").pop() || "").toLowerCase();
    const CT = { mp4: "video/mp4", mov: "video/quicktime", mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", pdf: "application/pdf", xml: "application/xml", srt: "application/x-subrip", vtt: "text/vtt", json: "application/json", txt: "text/plain", zip: "application/zip" };
    const r = await fetch(`${SB_URL}/functions/v1/worker_upload`, { method: "POST", headers: { "x-worker-secret": S, "Content-Type": CT[ext] || "application/octet-stream" }, body: readFileSync(f) });
    const t = await r.text(); if (!r.ok) throw new Error("upload: " + r.status + " " + t);
    process.stdout.write(t + "\n");
  } else throw new Error("unknown command " + cmd);
} catch (e) { console.error(String(e.message || e)); process.exit(1); }
