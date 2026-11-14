import { Sim, getRenderer } from "/home/user/makz.space/syndo/web/src/appearance/motion/engine.ts";
import { sceneFor } from "/home/user/makz.space/syndo/web/src/appearance/motion/recipes.ts";
const $ = <T extends HTMLElement = HTMLElement>(html: string): T => { const d = document.createElement("div"); d.innerHTML = html.trim(); return d.firstElementChild as T; };
// ---------------------------------------------------------------- live profile cards & decorations (the real SEND Motion engine)
const r = getRenderer()!;
class Card {
  el: HTMLElement; back: HTMLCanvasElement; front: HTMLCanvasElement; sim: Sim; started = false;
  constructor(id: string, name: string, w: number, h: number, public t0: number, color = "#fff") {
    this.el = $(`<div class="card" style="width:${w}px;height:${h}px"><canvas class="cb"></canvas><div class="banner"></div><div class="av" style="width:${w * .25}px;height:${w * .25}px;left:${w * .045}px;top:${h * .227 - w * .125}px"></div>
      <div class="cbody" style="top:${h * .227 + w * .14}px;left:${w * .05}px;font-size:${w * .062}px"><b style="color:${color}">${name}</b><span>@${name.toLowerCase()}</span><i style="width:${w * .55}px"></i><i style="width:${w * .4}px"></i></div><canvas class="cf"></canvas></div>`);
    this.back = this.el.querySelector(".cb")!; this.front = this.el.querySelector(".cf")!;
    for (const c of [this.back, this.front]) { c.width = w * 1.5; c.height = h * 1.5; }
    this.sim = new Sim(sceneFor(id)!.scene, "card", .41); this.sim.resize(w, h, { x: w * .045 + w * .125, y: h * .227 });
  }
  draw(t: number, dt: number) {
    const lt = t - this.t0; if (lt < 0) return;
    if (!this.started) { this.started = true; this.sim.intro(); }
    this.sim.step(dt);
    const k = Math.min(1, lt / 1.6);
    r.draw(this.sim, "back", this.back.getContext("2d")!, this.back.width, this.back.height, k);
    r.draw(this.sim, "front", this.front.getContext("2d")!, this.front.width, this.front.height, k);
  }
}

const host = document.getElementById("cards")!;
const cs = [new Card("fx-crimson-static", "Makz", 250, 344, 0, "#ff6b6b"), new Card("fx-eternal-eclipse", "Kai", 250, 344, 0, "#ffd9a0")];
cs.forEach((c, i) => { c.el.classList.add("tc" + i); host.append(c.el); });
(window as any).render = () => { for (let k = 0; k < 150; k++) cs.forEach((c) => c.draw(k / 30, 1 / 30)); };
