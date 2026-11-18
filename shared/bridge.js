/* Keenest apps bridge.
   Gives a site that was built as a Claude artifact the same window.claude API
   (db, mcp, sample, user) on keenest.co.il:
   - db      -> Supabase table app_docs (live updates through Realtime)
   - mcp     -> a job in app_jobs that the office Mac runs with Claude Code
   - sample  -> the same, streamed back as it is written
   - login   -> same names and personal codes as the Keenest clock
   Usage: set window.KEENEST_APP, mark the site's own scripts type="text/keenest-app",
   then load supabase.js and bridge.js at the end of the page (tools/port.py does all this). */
(function () {
  "use strict";
  var SB_URL = "https://ccqpmbcytrcxngnlooon.supabase.co";
  var SB_KEY = "sb_publishable_SbkMpYDQN-0FA92vFKeVaA_85mQn7dJ";
  var APP = window.KEENEST_APP || document.body.getAttribute("data-app");
  var MANIFEST = {};
  try { MANIFEST = JSON.parse((document.getElementById("keenest-manifest") || {}).textContent || "{}"); } catch (e) {}
  var sb = window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: "keenest-apps-auth" } });
  window.__keenestSb = sb;

  function err(code, message, extra) { var e = new Error(message || code); e.code = code; if (extra) for (var k in extra) e[k] = extra[k]; return e; }
  function splitPath(p) { p = String(p || "").replace(/^\/+|\/+$/g, ""); var i = p.lastIndexOf("/"); return i < 0 ? { coll: "", id: p } : { coll: p.slice(0, i), id: p.slice(i + 1) }; }
  function clone(x) { return x == null ? x : JSON.parse(JSON.stringify(x)); }

  /* ---------------- db ---------------- */
  var cache = {};            // "coll\u0000id" -> data
  var docSubs = [], collSubs = [];
  var dbReady = null;

  function key(c, i) { return c + "\u0000" + i; }
  function docSnap(c, i) { var d = cache[key(c, i)]; return { id: i, exists: d !== undefined, data: function () { return clone(d); }, ref: { path: (c ? c + "/" : "") + i } }; }
  function collSnap(c) {
    var docs = [];
    Object.keys(cache).forEach(function (k) { var p = k.split("\u0000"); if (p[0] === c) docs.push(docSnap(p[0], p[1])); });
    docs.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
    return { empty: docs.length === 0, size: docs.length, docs: docs, forEach: function (f) { docs.forEach(f); } };
  }
  function notify(c, i) {
    docSubs.forEach(function (s) { if (s.c === c && s.i === i) try { s.cb(docSnap(c, i)); } catch (e) { console.error(e); } });
    collSubs.forEach(function (s) { if (s.c === c) try { s.cb(collSnap(c)); } catch (e) { console.error(e); } });
  }
  var pendingNotify = {}, notifyTimer = null;
  function queueNotify(c, i) { pendingNotify[key(c, i)] = [c, i]; if (!notifyTimer) notifyTimer = setTimeout(flushNotify, 30); }
  function flushNotify() {
    var items = pendingNotify; pendingNotify = {}; notifyTimer = null;
    var colls = {};
    Object.keys(items).forEach(function (k) { var c = items[k][0], i = items[k][1]; colls[c] = 1;
      docSubs.forEach(function (s) { if (s.c === c && s.i === i) try { s.cb(docSnap(c, i)); } catch (e) { console.error(e); } }); });
    Object.keys(colls).forEach(function (c) { collSubs.forEach(function (s) { if (s.c === c) try { s.cb(collSnap(c)); } catch (e) { console.error(e); } }); });
  }

  async function loadAll() {
    var from = 0, size = 1000;
    for (;;) {
      var r = await sb.from("app_docs").select("coll,id,data").eq("app", APP).range(from, from + size - 1);
      if (r.error) throw r.error;
      r.data.forEach(function (row) { cache[key(row.coll, row.id)] = row.data; });
      if (r.data.length < size) break; from += size;
    }
    sb.channel("docs-" + APP).on("postgres_changes", { event: "*", schema: "public", table: "app_docs", filter: "app=eq." + APP }, function (p) {
      var row = p.eventType === "DELETE" ? p.old : p.new; if (!row || row.app !== APP) return;
      var k = key(row.coll, row.id);
      if (p.eventType === "DELETE") { if (!(k in cache)) return; delete cache[k]; }
      else { if (JSON.stringify(cache[k]) === JSON.stringify(row.data)) return; cache[k] = row.data; }
      queueNotify(row.coll, row.id);
    }).subscribe();
  }

  function docRef(path) {
    var p = splitPath(path), c = p.coll, i = p.id;
    return {
      id: i, path: path,
      get: async function () { await dbReady; return docSnap(c, i); },
      set: async function (data, opt) {
        var k = key(c, i), prev = cache[k];
        var next = opt && opt.merge && prev ? Object.assign({}, prev, clone(data)) : clone(data);
        cache[k] = next; queueNotify(c, i);
        var r = await sb.from("app_docs").upsert({ app: APP, coll: c, id: i, data: next, updated_at: new Date().toISOString() });
        if (r.error) { if (prev === undefined) delete cache[k]; else cache[k] = prev; queueNotify(c, i); throw err("write_failed", r.error.message); }
      },
      update: async function (patch) { var cur = cache[key(c, i)]; if (cur === undefined) throw err("not_found", "Document does not exist"); return this.set(Object.assign({}, cur, clone(patch))); },
      delete: async function () {
        var k = key(c, i), prev = cache[k]; delete cache[k]; queueNotify(c, i);
        var r = await sb.from("app_docs").delete().eq("app", APP).eq("coll", c).eq("id", i);
        if (r.error) { if (prev !== undefined) { cache[k] = prev; queueNotify(c, i); } throw err("write_failed", r.error.message); }
      },
      onSnapshot: function (cb, onErr) { var s = { c: c, i: i, cb: cb }; docSubs.push(s); dbReady.then(function () { cb(docSnap(c, i)); }, function (e) { onErr && onErr(e); }); return function () { docSubs = docSubs.filter(function (x) { return x !== s; }); }; }
    };
  }
  function collRef(name) {
    var c = String(name).replace(/^\/+|\/+$/g, "");
    return {
      id: c, path: c,
      doc: function (id) { return docRef(c + "/" + (id || Math.random().toString(36).slice(2) + Date.now().toString(36))); },
      add: async function (data) { var d = this.doc(); await d.set(data); return d; },
      get: async function () { await dbReady; return collSnap(c); },
      onSnapshot: function (cb, onErr) { var s = { c: c, cb: cb }; collSubs.push(s); dbReady.then(function () { cb(collSnap(c)); }, function (e) { onErr && onErr(e); }); return function () { collSubs = collSubs.filter(function (x) { return x !== s; }); }; }
    };
  }
  var dbApi = { doc: docRef, collection: collRef };

  /* ---------------- jobs (Mac) ---------------- */
  var waiters = {}, jobsChan = null, myId = null;
  function ensureJobsChannel() {
    if (jobsChan) return;
    jobsChan = sb.channel("jobs-" + myId).on("postgres_changes", { event: "UPDATE", schema: "public", table: "app_jobs", filter: "user_id=eq." + myId }, function (p) { var w = waiters[p.new.id]; if (w) w(p.new); }).subscribe();
  }
  async function macAlive() { try { var r = await sb.rpc("worker_ping"); return r.data && (Date.now() - new Date(r.data).getTime() < 120000); } catch (e) { return true; } }
  async function runJob(kind, payload, opts) {
    opts = opts || {};
    if (!(await macAlive())) throw err("worker_offline", "המחשב במשרד לא מחובר כרגע, אז אי אפשר להריץ את זה עכשיו.");
    ensureJobsChannel();
    var id = null;
    if (opts.reuse) { var old = await sb.from("app_jobs").select("id,status").eq("id", opts.reuse).maybeSingle(); if (old.data && old.data.status !== "error") id = old.data.id; }
    if (!id) {
      var ins = await sb.from("app_jobs").insert({ app: APP, kind: kind, payload: payload }).select("id").single();
      if (ins.error) throw err("queue_failed", ins.error.message);
      id = ins.data.id;
    }
    if (opts.onQueued) opts.onQueued(id);
    var lastPartial = "";
    return new Promise(function (resolve, reject) {
      var done = false, poll = null, timer = null;
      function finish(row) {
        if (done) return;
        if (row.partial && row.partial !== lastPartial && opts.onPartial) { lastPartial = row.partial; try { opts.onPartial(row.partial); } catch (e) {} }
        if (row.status === "done") {
          done = true; cleanup();
          // realtime leaves out big results: read the row itself then
          if (row.result == null) { sb.from("app_jobs").select("result").eq("id", id).single().then(function (r) { resolve(r.data ? r.data.result : null); }, function () { resolve(null); }); }
          else resolve(row.result);
        }
        else if (row.status === "error") { done = true; cleanup(); var e = row.error || {}; reject(err(e.code || "failed", e.message || "משהו השתבש במחשב במשרד.", { text: row.partial || "" })); }
      }
      function cleanup() { delete waiters[id]; clearInterval(poll); clearTimeout(timer); }
      waiters[id] = finish;
      poll = setInterval(async function () { var r = await sb.from("app_jobs").select("*").eq("id", id).single(); if (!r.error) finish(r.data); }, 4000);
      timer = setTimeout(function () { if (!done) { done = true; cleanup(); reject(err("timeout", "לקח יותר מדי זמן. נסו שוב.")); } }, opts.timeout || 10 * 60 * 1000);
      if (opts.signal) opts.signal.addEventListener("abort", function () { if (!done) { done = true; cleanup(); reject(err("cancelled", "")); } });
    });
  }

  var mcpApi = {
    callTool: async function (server, tool, input) {
      var res = await runJob("mcp", { server: server, tool: tool, input: input || {} }, { timeout: 5 * 60 * 1000 });
      return res || {};
    },
    // Runs the whole paging on the office Mac. If the page was closed mid-pull, the next open picks up the same job.
    callToolAll: async function (server, tool, input, opts) {
      opts = opts || {};
      var key = "kjob." + APP + "." + server + "." + tool, saved = null;
      try { saved = JSON.parse(localStorage.getItem(key) || "null"); } catch (e) {}
      var payload = { server: server, tool: tool, input: input || {}, keep: opts.keep || null, limit: opts.limit || 60 };
      var sig = JSON.stringify(input || {});
      var res = await runJob("mcp_all", payload, {
        timeout: 45 * 60 * 1000, onPartial: opts.onProgress ? function (t) { opts.onProgress(Number(t) || 0); } : null,
        reuse: saved && saved.sig === sig && Date.now() - saved.at < 2 * 3600 * 1000 ? saved.id : null,
        onQueued: function (id) { try { localStorage.setItem(key, JSON.stringify({ id: id, sig: sig, at: Date.now() })); } catch (e) {} }
      });
      try { localStorage.removeItem(key); } catch (e) {}
      return res || {};
    },
    // Starts a job on the office Mac and returns at once (the Mac writes the results itself). One at a time per key.
    startBackground: async function (kind, payload, key) {
      var k = "kbg." + APP + "." + key, saved = null;
      try { saved = JSON.parse(localStorage.getItem(k) || "null"); } catch (e) {}
      if (saved && Date.now() - saved.at < 60 * 60 * 1000) {
        var old = await sb.from("app_jobs").select("status").eq("id", saved.id).maybeSingle();
        if (old.data && (old.data.status === "queued" || old.data.status === "running")) return { id: saved.id, running: true };
      }
      if (!(await macAlive())) return { offline: true };
      var ins = await sb.from("app_jobs").insert({ app: APP, kind: kind, payload: payload }).select("id").single();
      if (ins.error) return { error: ins.error.message };
      try { localStorage.setItem(k, JSON.stringify({ id: ins.data.id, at: Date.now() })); } catch (e) {}
      return { id: ins.data.id };
    },
    listTools: async function () { return { servers: (MANIFEST.mcp || []).map(function (s) { return { server: s.server, tools: s.tools.map(function (t) { return typeof t === "string" ? { name: t } : t; }) }; }) }; }
  };

  function sampleApi(messages, opts) {
    opts = opts || {};
    return runJob("sample", { messages: messages, system: opts.system || null, model: opts.model || null }, {
      signal: opts.signal, timeout: 8 * 60 * 1000,
      onPartial: function (t) { if (opts.onText) opts.onText({ text: t }); }
    }).then(function (r) { return { text: (r && r.text) || "" }; });
  }

  var me = null;
  var userApi = { can: async function () { return true; }, get: async function () { return me; }, profile: async function () { return me; }, me: function () { return me; } };

  window.claude = {
    use: async function (what) {
      if (what === "db") { await dbReady; return dbApi; }
      if (what === "mcp") return mcpApi;
      if (what === "sample") return sampleApi;
      if (what === "user") return userApi;
      throw err("not_available", what);
    },
    keenest: { sb: sb, app: APP, signOut: async function () { await sb.auth.signOut(); location.reload(); } }
  };

  /* ---------------- login ---------------- */
  var css = "#kLogin{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:#E6E9EC;font-family:Rubik,system-ui,sans-serif;direction:rtl;color:#00203F;padding:24px}" +
    "#kLogin .box{width:100%;max-width:340px;text-align:center}#kLogin img{height:30px;width:auto;margin-bottom:22px}@media (prefers-color-scheme:dark){#kLogin img{filter:brightness(0) invert(1)}}" +
    "#kLogin h1{font-size:20px;font-weight:600;margin:0 0 4px}#kLogin p{margin:0 0 22px;opacity:.65;font-size:14px}" +
    "#kLogin .nm{display:flex;align-items:center;gap:12px;width:100%;padding:13px 16px;margin-bottom:10px;border:1px solid #d3d8dd;border-radius:16px;background:#fff;font:inherit;font-size:16px;color:inherit;cursor:pointer;text-align:right}" +
    "#kLogin .av{width:32px;height:32px;border-radius:50%;background:#06B3E5;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:600}" +
    "#kLogin input{width:100%;box-sizing:border-box;padding:14px 16px;border:1px solid #d3d8dd;border-radius:16px;font:inherit;font-size:18px;text-align:center;letter-spacing:4px;background:#fff;color:inherit;outline:none}" +
    "#kLogin input:focus{border-color:#06B3E5}#kLogin .go{width:100%;margin-top:12px;padding:14px;border:0;border-radius:16px;background:#06B3E5;color:#fff;font:inherit;font-size:16px;font-weight:600;cursor:pointer}" +
    "#kLogin .back{background:none;border:0;color:#06B3E5;font:inherit;margin-top:14px;cursor:pointer}#kLogin .warn{color:#FA1664;min-height:20px;margin:10px 0 0;opacity:1}" +
    "@media (prefers-color-scheme:dark){#kLogin{background:#0b1622;color:#E6E9EC}#kLogin .nm,#kLogin input{background:#13212f;color:#E6E9EC;border-color:#22374b}}";
  function el(html) { var d = document.createElement("div"); d.innerHTML = html; return d.firstChild; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function loginScreen(title) {
    return new Promise(async function (resolve) {
      var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
      var root = el('<div id="kLogin"><div class="box"><img src="../shared/logo.png" alt=""><h1>' + esc(title) + '</h1><p>מי נכנס?</p><div id="kBody"><p>טוען…</p></div></div></div>');
      document.body.appendChild(root);
      var body = root.querySelector("#kBody");
      var r = await sb.rpc("app_login_names", { a: APP });
      if (r.error) { body.innerHTML = "<p>אין חיבור כרגע. נסו לרענן.</p>"; return; }
      if (!r.data.length) { body.innerHTML = "<p>עוד לא הוגדרו משתמשים לאתר הזה.</p>"; return; }
      function names() {
        body.innerHTML = r.data.map(function (x) { return '<button class="nm" data-e="' + esc(x.email) + '" data-n="' + esc(x.name) + '"><span class="av">' + esc(x.name[0]) + "</span>" + esc(x.name) + "</button>"; }).join("");
        body.querySelectorAll(".nm").forEach(function (b) { b.onclick = function () { code(b.dataset.e, b.dataset.n); }; });
        if (r.data.length === 1) code(r.data[0].email, r.data[0].name);
      }
      function code(email, name) {
        root.querySelector("p").textContent = name + ", הקוד האישי שלך (כמו בשעון)";
        body.innerHTML = '<form id="kf"><input type="email" autocomplete="username" value="' + esc(email) + '" hidden><input id="kpw" type="password" inputmode="numeric" autocomplete="current-password" autofocus><button class="go">כניסה</button></form><p class="warn" id="kerr"></p>' + (r.data.length > 1 ? '<button class="back" id="kback">חזרה</button>' : "");
        var bk = body.querySelector("#kback"); if (bk) bk.onclick = function () { root.querySelector("p").textContent = "מי נכנס?"; names(); };
        body.querySelector("#kf").onsubmit = async function (ev) {
          ev.preventDefault();
          var pw = body.querySelector("#kpw").value.trim(); if (!pw) return;
          var s = await sb.auth.signInWithPassword({ email: email, password: pw });
          if (s.error) { body.querySelector("#kerr").textContent = "הקוד לא נכון"; return; }
          root.remove(); resolve(s.data.session);
        };
        setTimeout(function () { var i = body.querySelector("#kpw"); i && i.focus(); }, 50);
      }
      names();
    });
  }

  function runAppScripts() {
    var list = Array.prototype.slice.call(document.querySelectorAll('script[type="text/keenest-app"]'));
    list.forEach(function (old) { var s = document.createElement("script"); s.textContent = old.textContent; old.parentNode.replaceChild(s, old); });
  }

  async function boot() {
    var s = (await sb.auth.getSession()).data.session;
    if (s) { var m = await sb.from("app_members").select("app").eq("app", APP).maybeSingle(); if (m.error || !m.data) { await sb.auth.signOut(); s = null; } }
    if (!s) s = await loginScreen(document.title || "Keenest");
    myId = s.user.id;
    var m2 = await sb.from("app_members").select("app").eq("app", APP).maybeSingle();
    if (!m2.data) { await sb.auth.signOut(); alert("אין לך גישה לאתר הזה"); location.reload(); return; }
    me = { id: s.user.id, email: s.user.email };
    try { var e = await sb.rpc("my_emp"); if (e.data) { var x = Array.isArray(e.data) ? e.data[0] : e.data; if (x && x.name) me.name = x.name; } } catch (er) {}
    dbReady = loadAll();
    dbReady.catch(function (e) { console.error("db load failed", e); });
    runAppScripts();
  }
  dbReady = new Promise(function () {});
  boot();
})();
