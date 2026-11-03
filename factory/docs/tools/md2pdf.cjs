// Markdown → PDF for factory/docs/open-questions.md. Run from factory/: node docs/tools/md2pdf.cjs docs/open-questions.md docs/open-questions.pdf
const fs = require("fs"); const { chromium } = require("playwright");
const [src, out] = process.argv.slice(2);
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const inl = (s) => esc(s).replace(/~~(.+?)~~/g, "<s>$1</s>").replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\*(.+?)\*/g, "<i>$1</i>").replace(/`(.+?)`/g, "<code>$1</code>");
let html = "", inList = false, li = null;
let para = null;
const flush = () => { if (li !== null) { html += `<li>${inl(li).replace(/\u0001/g, "<br>")}</li>`; li = null; } if (para !== null) { html += `<p>${inl(para)}</p>`; para = null; } };
for (const line of fs.readFileSync(src, "utf8").split("\n")) {
  let m;
  if ((m = line.match(/^(#{1,3}) (.*)/))) { flush(); if (inList) { html += "</ol>"; inList = false; } html += `<h${m[1].length}>${inl(m[2])}</h${m[1].length}>`; }
  else if ((m = line.match(/^\d+\. (.*)/))) { flush(); if (!inList) { html += "<ol start=" + line.match(/^\d+/)[0] + ">"; inList = true; } li = m[1]; }
  else if ((m = line.match(/^\s+(.*)/)) && li !== null) { li += (/^[-\d]/.test(m[1]) ? "\u0001" : " ") + m[1]; }
  else if (line.trim() === "") { flush(); }
  else { if (li !== null) flush(); if (inList) { html += "</ol>"; inList = false; } para = para === null ? line : para + " " + line; }
}
flush(); if (inList) html += "</ol>";
const page = `<!doctype html><meta charset=utf-8><style>body{font:11pt/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#141a33;margin:0}h1{font-size:20pt;margin:0 0 6pt;color:#3b2a8f}h2{font-size:13pt;margin:18pt 0 6pt;border-bottom:1px solid #ddd;padding-bottom:3pt}ol{padding-left:20pt}li{margin:0 0 8pt}i{color:#555}s{color:#999}.f{color:#888;font-size:9pt;margin-top:18pt}</style>${html}<p class=f>Skalarki Electronics · Kortana · generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC</p>`;
(async () => { const b = await chromium.launch(); const p = await b.newPage(); await p.setContent(page); await p.pdf({ path: out, format: "A4", margin: { top: "18mm", bottom: "18mm", left: "18mm", right: "18mm" } }); await b.close(); console.log("pdf ok"); })();
