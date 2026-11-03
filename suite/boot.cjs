// SK Suite bootstrap (never updated itself). Starts the newest verified app code: an installed update from
// <userData>/updates when it is newer than the code shipped in this folder, otherwise the shipped code.
// If an update starts but never reports healthy (crash on start), the next launch rolls back to the shipped code.
const { app } = require("electron");
const path = require("node:path"); const fs = require("node:fs");
if (process.env.SK_SUITE_USER_DATA) app.setPath("userData", process.env.SK_SUITE_USER_DATA); // tests and portable profiles
const shipped = JSON.parse(fs.readFileSync(path.join(__dirname, "version.json"), "utf8")).version;
const newer = (a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
function start() {
  const file = path.join(app.getPath("userData"), "updates", "current.json");
  try {
    const c = JSON.parse(fs.readFileSync(file, "utf8"));
    if (c && !c.failed && newer(c.version, shipped) && fs.existsSync(path.join(c.dir, "main.cjs"))) {
      if (c.pending) { c.failed = true; fs.writeFileSync(file, JSON.stringify(c)); } // last start never got healthy
      else {
        fs.writeFileSync(file, JSON.stringify({ ...c, pending: true }));
        global.__suite = { root: c.dir, version: c.version, shipped, updated: true, stateFile: file };
        require(path.join(c.dir, "main.cjs")); return;
      }
    }
  } catch { /* no update installed */ }
  global.__suite = { root: __dirname, version: shipped, shipped, updated: false, stateFile: file };
  require("./main.cjs");
}
start();
