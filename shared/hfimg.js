/* Show generated images straight from Higgsfield; our own copy is the fallback.
   Only <img> tags on screen are changed. Code that downloads images (references, PDFs)
   keeps using the copy, so nothing that works today changes.
   A copy is matched to a Higgsfield link only when they were saved together:
   an object that has both `img` (our copy) and `gen.url` (done, an image, not a video). */
(function () {
  var map = {}, back = {}, lastScan = 0, pending = false;
  var IMG = /\.(png|jpe?g|webp)(\?|$)/i;

  function walk(o, seen) {
    if (!o || typeof o !== "object" || seen.has(o)) return;
    seen.add(o);
    if (Array.isArray(o)) { for (var i = 0; i < o.length; i++) walk(o[i], seen); return; }
    var g = o.gen;
    if (typeof o.img === "string" && g && g.state === "done" && typeof g.url === "string" && IMG.test(g.url)) {
      map[o.img] = g.url; back[g.url] = o.img;
    }
    for (var k in o) if (k !== "gen") walk(o[k], seen);
  }
  function scan() {
    lastScan = Date.now();
    try { if (typeof S !== "undefined" && S) walk(S, new Set()); } catch (e) {}
  }
  function idOf(src) { var m = /\/_blob\/([A-Za-z0-9_-]+)$/.exec(src || ""); return m && m[1]; }

  function fix(img) {
    if (img.dataset.hfFb) return;
    var id = idOf(img.getAttribute("src"));
    if (!id) return;
    if (!map[id] && Date.now() - lastScan > 3000) scan();
    var u = map[id];
    if (u) { img.dataset.hfId = id; img.src = u; }
  }
  function sweep() {
    pending = false;
    var list = document.querySelectorAll('img[src*="/_blob/"]');
    for (var i = 0; i < list.length; i++) fix(list[i]);
  }
  // a Higgsfield link that fails falls back to our copy
  document.addEventListener("error", function (e) {
    var t = e.target;
    if (!t || t.tagName !== "IMG" || t.dataset.hfFb) return;
    var id = t.dataset.hfId || back[t.src];
    if (id) { t.dataset.hfFb = "1"; t.src = "/_blob/" + id; }
  }, true);

  new MutationObserver(function () { if (!pending) { pending = true; requestAnimationFrame(sweep); } })
    .observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
})();
