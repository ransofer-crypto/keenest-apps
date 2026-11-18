#!/usr/bin/env python3
"""Once a page's first script waits for login, every later plain inline script waits too (same order),
so add-on scripts that use the app's variables don't run before the app."""
import re, sys, pathlib
def defer_after(html):
    cut = html.find('<script type="application/json" id="keenest-manifest">')
    head, tail = (html[:cut], html[cut:]) if cut >= 0 else (html, "")
    seen = [False]
    def f(m):
        tag, body = m.group(1), m.group(2)
        if 'type="text/keenest-app"' in tag: seen[0] = True; return m.group(0)
        if not seen[0] or "src=" in tag or ("type=" in tag and not re.search(r'type="(text/javascript|module)"', tag)): return m.group(0)
        return '<script type="text/keenest-app">' + body + "</script>"
    return re.sub(r"(<script\b[^>]*>)(.*?)</script>", f, head, flags=re.S) + tail
if __name__ == "__main__":
    for p in sys.argv[1:]:
        p = pathlib.Path(p); s = p.read_text(encoding="utf-8"); t = defer_after(s)
        print(p, s.count('text/keenest-app'), "->", t.count('text/keenest-app'))
        p.write_text(t, encoding="utf-8")
