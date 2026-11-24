import "./styles/splash.css";

const lines = ["Igniting core", "Scanning USB devices", "Connecting to OpenRGB", "Loading profiles", "Calibrating canvas"];
const el = document.getElementById("status")!;
let i = 0;
setInterval(() => {
  i = (i + 1) % lines.length;
  el.classList.remove("in");
  void el.offsetWidth;
  el.textContent = lines[i];
  el.classList.add("in");
}, 520);
