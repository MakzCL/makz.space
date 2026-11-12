// Shared steps for the browser (examples.mjs) and desktop (desktop.mjs) runs.
import assert from "node:assert/strict";
export async function runExamples(p, SHOTS, step) {
  await p.getByTestId("start").waitFor(); step("empty schematic shows the start panel with examples");
  const open = async (id) => {
    if (!(await p.getByTestId("start").count())) { await p.getByTestId("menu-File").click(); await p.getByRole("menuitem", { name: new RegExp(`Example: ${id}`) }).click(); }
    else await p.getByTestId(`example-${id}`).click();
    await p.getByTestId("sim-state").filter({ hasText: /Solved/ }).waitFor({ timeout: 60000 });
  };
  const dmm = async (net) => { await p.getByTestId("tab-instruments").click(); await p.getByTestId("dmm-pos").selectOption(net); const t = await p.getByTestId("dmm-value").innerText(); return { t, v: parseFloat(t.replace(/[^\d.\-]/g, "")) * (/mV/.test(t) ? 1e-3 : 1) }; };
  p.on("dialog", (d) => d.accept().catch(() => {}));
  await open("divider"); let r = await dmm("OUT"); assert.ok(Math.abs(r.v - 2.5) < 1e-3, r.t); step(`Voltage divider: placed parts and wires loaded, ngspice solved, multimeter OUT = ${r.t}`);
  for (const pal of ["light", "granat", "dark"]) { await p.getByTestId(`theme-${pal}`).click(); await p.waitForTimeout(250); if (SHOTS) await p.screenshot({ path: `${SHOTS}/nucleus-${pal}.png` }); }
  step("palettes Light / Granat / Dark switch the whole interface");
  await p.getByTestId("theme-granat").click();
  await open("LED with series resistor"); r = await dmm("ANODE"); assert.ok(r.v > 1.6 && r.v < 1.9, r.t); step(`LED: anode ${r.t}`);
  await open("RC charging"); await p.getByText("Analysis").first().waitFor(); assert.ok(await p.locator(".n-plot canvas").count()); if (SHOTS) await p.screenshot({ path: `${SHOTS}/nucleus-rc-step.png` });
  step("RC charging: transient solved and the Analysis graph opened");
  await open("RC low-pass"); assert.ok(await p.locator(".n-plot canvas").count() >= 2); if (SHOTS) await p.screenshot({ path: `${SHOTS}/nucleus-rc-ac.png` });
  step("RC low-pass: AC sweep solved; magnitude and phase plots shown");
  await open("Potentiometer"); await p.getByText("Schematic").first().click(); r = await dmm("WIPER"); assert.ok(Math.abs(r.v - 7.5) < 0.05, r.t); step(`Potentiometer: WIPER = ${r.t}`);
  await open("555 timer oscillator"); await p.getByText("Analysis").first().waitFor(); await p.waitForTimeout(800); if (SHOTS) await p.screenshot({ path: `${SHOTS}/nucleus-555-pre.png` }); assert.ok(await p.locator(".n-plot canvas").count()); if (SHOTS) await p.screenshot({ path: `${SHOTS}/nucleus-555.png` });
  step("555 timer oscillator: NE555 transient solved by ngspice and the Analysis graph opened");
}
