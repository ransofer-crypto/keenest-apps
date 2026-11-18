#!/usr/bin/env python3
"""Turn a site that was built as a Claude artifact into a Keenest app page.
usage: port.py <artifact.html> <app-id> <out-dir> [manifest.json]
- scripts that use window.claude wait for login (type="text/keenest-app")
- adds the bridge (Supabase login, data, and the office Mac for Claude/connectors)
- adds home-screen app tags."""
import json, re, sys, pathlib
src, app, out = sys.argv[1], sys.argv[2], pathlib.Path(sys.argv[3])
manifest = json.loads(pathlib.Path(sys.argv[4]).read_text()) if len(sys.argv) > 4 else {}
html = pathlib.Path(src).read_text(encoding="utf-8")

def fix(m):
    tag, body = m.group(1), m.group(2)
    if "src=" in tag or ("window.claude" not in body and "claude.use" not in body):
        return m.group(0)
    return '<script type="text/keenest-app">' + body + "</script>"
html = re.sub(r"(<script\b[^>]*>)(.*?)</script>", fix, html, flags=re.S)
sys.path.insert(0, str(pathlib.Path(__file__).parent)); from defer_after import defer_after

title = re.search(r"<title>(.*?)</title>", html, re.S)
title = title.group(1).strip() if title else app
head_add = ('<link rel="manifest" href="manifest.webmanifest">'
            '<meta name="apple-mobile-web-app-capable" content="yes">'
            '<meta name="mobile-web-app-capable" content="yes">'
            '<meta name="apple-mobile-web-app-status-bar-style" content="default">'
            f'<meta name="apple-mobile-web-app-title" content="{title}">'
            '<link rel="apple-touch-icon" href="../shared/logo.png">')
html = html.replace("</title>", "</title>" + head_add, 1)
tail = (f'<script type="application/json" id="keenest-manifest">{json.dumps(manifest, ensure_ascii=False)}</script>'
        f'<script>window.KEENEST_APP={json.dumps(app)};</script>'
        '<script src="../shared/supabase.js"></script><script src="../shared/bridge.js?v=8"></script>')
if "</body>" in html:
    html = html.replace("</body>", tail + "</body>", 1)
else:
    html = html.replace("</html>", tail + "</html>", 1)
html = defer_after(html)
out.mkdir(parents=True, exist_ok=True)
(out / "index.html").write_text(html, encoding="utf-8")
(out / "manifest.webmanifest").write_text(json.dumps({
    "name": title, "short_name": title, "lang": "he", "dir": "rtl", "start_url": "./", "scope": "./",
    "display": "standalone", "background_color": "#E6E9EC", "theme_color": "#E6E9EC",
    "icons": [{"src": "../shared/logo.png", "sizes": "512x512", "type": "image/png"}]}, ensure_ascii=False, indent=1), encoding="utf-8")
print("ok", out / "index.html")
