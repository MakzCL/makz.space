#!/usr/bin/env python3
"""
Builds SEND's company and policy pages (static HTML, same look as the home page) and the shared footer.
Run from syndo/site:  python3 _pages/build.py
Content lives in _pages/content/*.html (body only); this script wraps it with the header and footer.
Writing rule: no long dashes anywhere.
"""
import json, html, os, re, pathlib

SITE = pathlib.Path(__file__).resolve().parent.parent
CONTENT = SITE / "_pages" / "content"
COMPANY = "MAKZ Labs"
ADDRESS = "Office 1, Izabella House, 24-26 Regent Place, Birmingham, B1 3NJ, United Kingdom"
EMAIL = "send@makz.space"
APP = "https://syndo.makz.space"
UPDATED = "13 November 2026"

FOOTER_COLS = [
    ("Product", [("Download", "/#download"), ("Open SEND", APP + "/"), ("Status", "/status"), ("Features", "/#features")]),
    ("Company", [("About", "/about"), ("Brand", "/brand"), ("Company information", "/company"), ("Contact", "mailto:" + EMAIL)]),
    ("Resources", [("Support", "/support"), ("Safety", "/safety"), ("Feedback", "mailto:" + EMAIL + "?subject=SEND%20feedback")]),
    ("Policies", [("Terms", "/terms"), ("Privacy", "/privacy"), ("Cookies", "/cookies"), ("Community Guidelines", "/guidelines"), ("Copyright", "/copyright"), ("Acknowledgements", "/acknowledgements")]),
]

def footer() -> str:
    cols = "".join(
        f'<details class="foot-col" open><summary>{t}</summary><ul>' + "".join(f'<li><a href="{h}">{html.escape(n)}</a></li>' for n, h in links) + "</ul></details>"
        for t, links in FOOTER_COLS)
    return f'''<footer class="foot">
    <div class="foot-top">
      <div class="foot-brand">
        <a href="/" aria-label="SEND home"><img src="/assets/send-wordmark.svg" alt="SEND" width="110" height="38"></a>
        <p>Talk together. Belong together.</p>
      </div>
      <nav class="foot-cols" aria-label="Footer">{cols}</nav>
    </div>
    <div class="foot-bottom">
      <span>© <span class="y">2026</span> {COMPANY}. SEND is made by {COMPANY}, {ADDRESS}. <a href="mailto:{EMAIL}">{EMAIL}</a></span>
      <a href="#top">Back to top ↑</a>
    </div>
  </footer>
  <script>document.querySelectorAll(".y").forEach((e) => e.textContent = new Date().getFullYear());
  // Phones: the footer columns fold up like Discord's; wide screens keep them open.
  const fold = () => document.querySelectorAll(".foot-col").forEach((d) => {{ if (matchMedia("(max-width: 700px)").matches) d.removeAttribute("open"); else d.setAttribute("open", ""); }});
  fold(); addEventListener("resize", fold);</script>'''

def page(slug: str, title: str, desc: str, body: str) -> str:
    return f'''<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{html.escape(title)} | SEND</title>
  <meta name="description" content="{html.escape(desc)}">
  <meta name="theme-color" content="#0E1220">
  <link rel="icon" type="image/svg+xml" href="/assets/send-icon.svg">
  <link rel="icon" href="/assets/favicon-32.png" sizes="32x32">
  <link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
  <link rel="preload" href="/assets/CabinetGrotesk-Family.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <a class="skip" href="#main">Skip to content</a>
  <header class="nav" id="top">
    <a class="brand" href="/" aria-label="SEND home"><img src="/assets/send-wordmark-white.svg" alt="SEND" width="96" height="33"></a>
    <nav aria-label="Main"><ul><li><a href="/#download">Download</a></li><li><a href="/support">Support</a></li><li><a href="/safety">Safety</a></li></ul></nav>
    <a class="btn btn-light btn-sm" href="{APP}/">Open SEND</a>
  </header>
  <main id="main" class="doc">
    <article class="doc-body">
{body}
    </article>
  </main>
  {footer()}
</body>
</html>
'''

def acknowledgements() -> str:
    pkgs = json.load(open(SITE / "_pages" / "npm-licences.json")) + json.load(open(SITE / "_pages" / "cargo-licences.json"))
    extra = [
        {"n": "DeepFilterNet (deep_filter)", "v": "", "lic": "MIT OR Apache-2.0", "url": "https://github.com/Rikorose/DeepFilterNet"},
        {"n": "RNNoise", "v": "", "lic": "BSD-3-Clause", "url": "https://github.com/xiph/rnnoise"},
        {"n": "Cabinet Grotesk (font)", "v": "", "lic": "ITF Free Font License", "url": "https://www.fontshare.com/fonts/cabinet-grotesk"},
        {"n": "Lucide icons", "v": "", "lic": "ISC", "url": "https://lucide.dev"},
    ]
    seen, rows = set(), []
    for p in extra + pkgs:
        key = (p["n"], p.get("v"))
        if key in seen: continue
        seen.add(key)
        url = p.get("url") or ""
        name = html.escape(p["n"]) + (f' <small>{html.escape(p["v"])}</small>' if p.get("v") else "")
        if url.startswith("http"): name = f'<a href="{html.escape(url)}" rel="noopener">{name}</a>'
        rows.append(f"<tr><td>{name}</td><td>{html.escape(str(p['lic']))}</td></tr>")
    return (CONTENT / "acknowledgements.html").read_text().replace("{{ROWS}}", "\n".join(rows)).replace("{{COUNT}}", str(len(rows)))

PAGES = [
    ("terms", "Terms of Service", "The agreement between you and MAKZ Labs for using SEND."),
    ("privacy", "Privacy Policy", "What SEND collects, why, who we share it with and your rights."),
    ("cookies", "Cookie Policy", "The cookies and local storage SEND uses, and your choices."),
    ("guidelines", "Community Guidelines", "The rules for everyone on SEND."),
    ("copyright", "Copyright and Intellectual Property", "How to report content that infringes your rights on SEND."),
    ("safety", "Safety", "The tools and policies that keep SEND safe, and how to get help."),
    ("support", "Support", "Help with your SEND account, and how to contact us."),
    ("about", "About SEND", "SEND is a free place to talk, play and share, made by MAKZ Labs."),
    ("brand", "Brand", "SEND logos and how to use them."),
    ("company", "Company information", "Legal details for MAKZ Labs, the company behind SEND."),
    ("status", "Status", "Is SEND working right now?"),
    ("acknowledgements", "Acknowledgements", "Open-source software that SEND is built with."),
]

def main():
    for slug, title, desc in PAGES:
        body = acknowledgements() if slug == "acknowledgements" else (CONTENT / f"{slug}.html").read_text()
        body = body.replace("{{COMPANY}}", COMPANY).replace("{{ADDRESS}}", ADDRESS).replace("{{EMAIL}}", EMAIL).replace("{{UPDATED}}", UPDATED).replace("{{APP}}", APP)
        if "—" in body or "–" in body: raise SystemExit(f"{slug}: long dash found")
        (SITE / f"{slug}.html").write_text(page(slug, title, desc, body))
    # the home page shares the footer
    idx = (SITE / "index.html").read_text()
    idx = re.sub(r'<footer class="foot">.*?</footer>\s*<script>.*?</script>', footer(), idx, flags=re.S)
    (SITE / "index.html").write_text(idx)
    print("built", len(PAGES), "pages")

if __name__ == "__main__":
    main()
