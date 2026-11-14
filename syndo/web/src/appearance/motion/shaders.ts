/** GLSL for SEND Motion. One "sky" program paints the atmosphere, the hero object and avatar rings; one instanced program draws sprites. */

export const QUAD_VS = `#version 300 es
in vec2 aP; out vec2 vUv;
void main(){ vUv = vec2(aP.x*.5+.5, .5-aP.y*.5); gl_Position = vec4(aP,0.,1.); }`;

export const SKY_FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform float uTime, uIntensity, uIntro, uFlash, uSeed, uHW, uSpeed, uGlitch;
uniform int uMode, uHero, uRing, uDeco;
uniform vec3 uC1, uC2, uC3;
uniform vec4 uHeroP;   // x, y (uv), radius (width units), spin
uniform vec2 uAnchor;  // avatar centre (uv)
uniform vec2 uFlashP;  // where a flash comes from (uv)

#define TAU 6.2831853
float h21(vec2 p){ p = fract(p*vec2(123.34, 456.21) + uSeed); p += dot(p, p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.-2.*f);
  return mix(mix(h21(i), h21(i+vec2(1,0)), u.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), u.x), u.y); }
float fbm(vec2 p){ float v = 0., a = .5; mat2 m = mat2(1.6, 1.2, -1.2, 1.6); for (int i = 0; i < 5; i++){ v += a*noise(p); p = m*p; a *= .5; } return v; }
float fbm3(vec2 p){ float v = 0., a = .5; mat2 m = mat2(1.6, 1.2, -1.2, 1.6); for (int i = 0; i < 3; i++){ v += a*noise(p); p = m*p; a *= .5; } return v; }
vec2 rot(vec2 p, float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c)*p; }
vec3 screen(vec3 a, vec3 b){ return 1. - (1. - a)*(1. - b); }

// Stars: a jittered grid, twinkling.
float stars(vec2 p, float scale, float t){
  vec2 g = p*scale, i = floor(g), f = fract(g) - .5;
  float h = h21(i), s = 0.;
  if (h > .82){ vec2 o = vec2(h21(i+3.1), h21(i+7.7)) - .5; float d = length(f - o*.7);
    float tw = .55 + .45*sin(t*(1.5 + h*3.) + h*40.);
    s = (smoothstep(.06, 0., d)*.9 + smoothstep(.22, 0., d)*.18)*tw*(h - .82)/.18*1.6; }
  return s;
}
// Soft bokeh discs.
vec4 bokeh(vec2 p, float scale, float t, float drift){
  vec2 g = p*scale + vec2(t*drift, -t*drift*.4), i = floor(g), f = fract(g) - .5;
  float h = h21(i); if (h < .7) return vec4(0);
  vec2 o = (vec2(h21(i+1.3), h21(i+5.1)) - .5)*.5; float r = .08 + .12*h21(i+9.);
  float d = length(f - o); float disc = smoothstep(r, r*.35, d); float rim = smoothstep(.03, 0., abs(d - r*.8))*.25;
  float a = (disc*.3 + rim*.2)*(.5 + .5*sin(t*.8 + h*30.));
  vec3 c = mix(uC1, uC2, h21(i+2.2)); return vec4(c*a, a);
}

// ---- atmospheres (premultiplied colour + alpha) ----
vec4 vortex(vec2 p, vec2 c, float t){
  vec2 d = p - c; float r = length(d); float a = atan(d.y, d.x);
  float tw = a + .9/(r + .18) + t*.07;
  vec2 q = vec2(cos(tw), sin(tw))*r*vec2(1., 1.25);
  float n = fbm(q*3.2 + vec2(t*.03, -t*.02)); float n2 = fbm(q*7. + n*1.7 - t*.05);
  float cloud = smoothstep(.28, .9, n*.65 + n2*.5);
  float wisp = smoothstep(.55, .95, fbm(q*12. + n2*2. + t*.04));
  vec3 col = mix(uC3*.55, mix(uC2, uC1, .55), cloud); col = mix(col, uC1*1.15 + .08, wisp*.6);
  col += uC1*exp(-r*6.)*.5;
  float alpha = mix(.55, 1., cloud)*.95;
  return vec4(col*alpha, alpha);
}
vec4 nebula(vec2 p, float t){
  vec2 q = vec2(fbm(p*1.6 + t*.02), fbm(p*1.6 + vec2(5.2, 1.3) - t*.015));
  vec2 r = vec2(fbm(p*2.2 + 3.5*q + vec2(1.7, 9.2) + t*.025), fbm(p*2.2 + 3.5*q + vec2(8.3, 2.8)));
  float f = fbm(p*2.2 + 3.5*r);
  vec3 col = mix(uC3*.7, uC2*.8, clamp(f*f*1.8, 0., 1.));
  col = mix(col, uC1, clamp(length(q)*.55, 0., 1.)*smoothstep(.55, .95, f)*.8);
  col *= .45 + f*.95;
  col += vec3(stars(p, 34., t) + stars(p + 3.7, 61., t)*.7);
  float a = clamp(.55 + f*.6, 0., 1.);
  return vec4(col*a, a);
}
vec4 space(vec2 p, float t){
  float band = exp(-pow((p.y - p.x*.45 - .1)*3., 2.));
  float n = fbm(p*3. + vec2(t*.01, 0.));
  vec3 col = uC3*.5 + mix(uC2, uC1, n)*band*n*.55;
  float s = stars(p, 28., t) + stars(p + 1.3, 47., t)*.8 + stars(p + 7.1, 80., t)*.6;
  col += vec3(s)*mix(vec3(1.), uC1, .25);
  return vec4(col*.95, .95);
}
vec4 aurora(vec2 p, float t){
  vec3 col = uC3*.45; float acc = 0.;
  for (int i = 0; i < 3; i++){ float k = float(i);
    float wave = fbm3(vec2(p.x*1.6 + k*3.1, t*.07 + k));
    float yc = .18 + .11*k + (wave - .5)*.32;
    float d = p.y - yc;
    float streak = .45 + .55*pow(noise(vec2(p.x*38. + k*11. + wave*6., t*.25)), 1.6);
    float curtain = d < 0. ? exp(d*7.)*streak : exp(-d*55.);
    vec3 cc = mix(uC1, uC2, clamp(-d*4. + k*.3, 0., 1.));
    col += cc*curtain*(.75 - k*.15); acc += curtain*(.6 - k*.12);
  }
  col += vec3(stars(p, 40., t))*.7;
  float a = clamp(.6 + acc*.4, 0., 1.);
  return vec4(col*a, a);
}
vec4 fire(vec2 p, float t, float hw){
  float fromBottom = hw - p.y; float side = min(p.x, 1. - p.x);
  float n = fbm(vec2(p.x*4.5, p.y*2.6 + t*1.3)); float n2 = fbm(vec2(p.x*10., p.y*5.5 + t*2.2) + n*1.3);
  float ridge = 1. - abs(n2*2. - 1.);
  float h = (n*.7 + ridge*.45) - fromBottom*2.6 - .38;
  float hs = (n*.7 + ridge*.4) - side*8. - .5;
  float f = clamp(max(h, hs)*2.6, 0., 1.);
  vec3 col = mix(uC2*.45, uC2, smoothstep(0., .4, f)); col = mix(col, uC1, smoothstep(.45, .85, f)); col = mix(col, vec3(1., .96, .85), smoothstep(.93, 1., f)*.5);
  float glow = exp(-fromBottom*2.6)*.6 + exp(-side*9.)*.25;
  vec3 base = uC3*.55 + uC2*glow*.45;
  float a = mix(.6, .95, smoothstep(0., .3, f)); vec3 c = mix(base, col, smoothstep(0., .3, f));
  return vec4(c*a, a);
}
vec4 fog(vec2 p, float t, float hw){
  float n = fbm(p*vec2(2., 3.5) + vec2(t*.05, t*.01)); n = fbm(p*2.6 + n*1.6 + vec2(t*.035, 0.));
  float dens = smoothstep(.25, .85, n)*(.35 + .65*smoothstep(.1, hw, p.y));
  vec3 col = mix(uC3*.7, mix(uC2, uC1, .35) + .05, n);
  float a = .5 + dens*.45;
  return vec4(col*a, a);
}
vec4 neonrain(vec2 p, float t, float hw){
  vec3 col = mix(uC3*.35, uC3*.9 + uC2*.12, p.y/hw);
  vec4 b1 = bokeh(p, 6., t, .03), b2 = bokeh(p + 9.1, 10., t, .05), b3 = bokeh(p + 3.3, 4., t, .02);
  col = col + b1.rgb*2.2 + b2.rgb*1.6 + b3.rgb*1.4;
  float glass = fbm(p*vec2(30., 6.) + vec2(0., t*.5));
  col += uC1*smoothstep(.62, .8, glass)*.12;
  return vec4(col*.92, .92);
}
vec4 rays(vec2 p, vec2 c, float t, float hw){
  vec2 d = p - c; float a = atan(d.y, d.x), r = length(d);
  float ray = pow(noise(vec2(a*7., t*.12)), 2.2)*.8 + pow(noise(vec2(a*17. + 3., -t*.18)), 3.)*.5;
  float fall = exp(-r*1.6);
  vec3 sky = mix(mix(uC2, uC1, .35), uC3*.6, smoothstep(0., hw, p.y));
  vec3 col = sky + mix(uC1, vec3(1., .95, .8), .45)*ray*fall*1.1 + uC1*exp(-r*5.)*.6;
  return vec4(col*.94, .94);
}
vec4 caustics(vec2 p, float t, float hw){
  vec2 q = mod(p*TAU*1.4, TAU) - 250.; vec2 i = q; float c = 1., inten = .005;
  for (int n = 0; n < 4; n++){ float tt = t*.6*(1. - (3.5/float(n + 1))); i = q + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1./length(vec2(q.x/(sin(i.x + tt)/inten), q.y/(cos(i.y + tt)/inten))); }
  c /= 4.; c = 1.17 - pow(c, 1.4); float v = pow(abs(c), 7.);
  vec3 deep = mix(uC2*.75, uC3*.5, smoothstep(0., hw, p.y));
  float shafts = pow(noise(vec2(p.x*6. - p.y*2., t*.1)), 3.)*exp(-p.y*1.8);
  vec3 col = deep + mix(uC1, vec3(1.), .3)*v*.55 + uC1*shafts*.6;
  return vec4(col*.94, .94);
}
vec4 synth(vec2 p, float t, float hw){
  float hz = hw*.3;
  if (p.y < hz){ float k = p.y/hz; vec3 col = mix(uC3*.6, mix(uC2, uC1, .3), k*k); col += vec3(stars(p, 40., t))*(1. - k);
    return vec4(col*.95, .95); }
  float y = p.y - hz; float z = .18/(y + .012); float x = (p.x - .5)*z;
  float gx = abs(fract(x*5.) - .5), gz = abs(fract(z*1.4 + t*.8) - .5);
  float w = .02*z; float line = smoothstep(w + .03, w, gx) + smoothstep(w*.5 + .04, w*.5, gz);
  vec3 col = mix(uC3*.25, uC3*.55, y/hw*2.) + uC1*line*smoothstep(3., .3, z)*.55*smoothstep(.0, .03, y) + uC2*exp(-y*28.)*.9;
  return vec4(col*.95, .95);
}
vec4 digital(vec2 p, float t, float hw){
  vec3 col = uC3*.5;
  float cols = 46.; float cx = floor(p.x*cols); float sp = .25 + h21(vec2(cx, 1.))*.6;
  float y = p.y*18. + t*sp*6. + h21(vec2(cx, 9.))*10.; float cell = floor(y); float fy = fract(y);
  float head = fract(-t*sp*.5 + h21(vec2(cx, 4.)));
  float trail = pow(fract(p.y/hw*.9 - head), 6.);
  float fx = fract(p.x*cols); float gh = h21(vec2(cx, cell + floor(t*2. + h21(vec2(cx, cell))*4.)));
  float glyph = step(.4, gh)*(step(.2, fx)*step(fx, .8)*step(.15, fy)*step(fy, .85))*(.5 + .5*step(.5, fract(gh*7.3 + floor(fy*3.)*.37 + floor(fx*3.)*.61)));
  col += mix(uC2, uC1, trail)*glyph*trail*.95;
  float scan = .9 + .1*sin(p.y*hw*900.);
  float band = step(.965, h21(vec2(floor(p.y*24.), floor(t*7.))));
  col += band*uC1*.18;
  col *= scan;
  return vec4(col*.94, .94);
}
vec4 storm(vec2 p, float t){
  vec2 q = p*vec2(2.2, 3.) + vec2(t*.04, 0.);
  float n = fbm(q + fbm(q*1.7 - t*.03)*1.4);
  vec3 col = mix(uC3*.4, uC2*.55 + .04, smoothstep(.3, .85, n));
  float fl = uFlash*exp(-length(p - uFlashP)*2.2);
  col += (uC1*.6 + .5)*fl*smoothstep(.25, .9, n)*1.6 + uFlash*.06;
  return vec4(col*.95, .95);
}
vec4 sand(vec2 p, float t, float hw){
  float n = fbm(vec2(p.x*1.4 - t*.35, p.y*7.)); float n2 = fbm(vec2(p.x*4. - t*.8, p.y*18.) + n);
  float dens = smoothstep(.3, .9, n*.6 + n2*.5)*(.4 + .6*p.y/hw);
  vec3 sky = mix(mix(uC1, uC2, .4), uC3*.7, p.y/hw);
  vec3 col = mix(sky, uC1*1.1 + .05, dens*.7);
  return vec4(col*.94, .94);
}
vec4 holo(vec2 p, float t, float hw){
  float n = fbm(p*2.5 + t*.04);
  vec3 iri = .5 + .5*cos(TAU*(vec3(0., .33, .67) + dot(p, vec2(1.2, .8))*1.1 + t*.06 + n*.7));
  vec3 base = mix(uC3*.7, mix(uC1, uC2, n)*.75, .45 - p.y/hw*.25);
  float sweep = exp(-pow((p.x + p.y*.7 - mod(t*.22, 3.) + .6)*6., 2.));
  float grain = fbm(p*vec2(3., 40.) + n);
  vec3 col = mix(base, iri*mix(uC1, vec3(1.), .4), .12 + .1*grain) + sweep*mix(uC1, vec3(1.), .6)*.4;
  return vec4(col*.92, .92);
}
vec4 ink(vec2 p, float t, float hw){
  float n = fbm(p*2.8 + vec2(t*.015, -t*.01)); float edge = max(smoothstep(.55, .0, p.y) , smoothstep(.12, 0., min(p.x, 1. - p.x))*.7);
  float m = smoothstep(.42, .62, n*.9 + edge*.55);
  float bleed = smoothstep(.0, .06, abs(n*.9 + edge*.55 - .52));
  vec3 paper = mix(uC1*.25 + uC3*.6, uC3*.85, p.y/hw);
  vec3 col = mix(paper, uC3*.15, m); col += uC1*(1. - bleed)*.45;
  col += uC2*exp(-pow((p.y - .08 - sin(p.x*3. + t*.3)*.03)*12., 2.))*.35;
  return vec4(col*.95, .95);
}
vec4 dreamy(vec2 p, float t, float hw){
  vec3 col = mix(mix(uC1, uC2, .45)*.85, uC3*.8, smoothstep(0., hw, p.y));
  col += bokeh(p, 5., t, .02).rgb*.55 + bokeh(p + 4.4, 9., t, .035).rgb*.45;
  col += uC1*exp(-pow(p.y*3., 2.))*.25;
  return vec4(col*.94, .94);
}


vec4 film(vec2 p, float t, float hw, vec2 uv){
  float fl = .9 + .1*h21(vec2(floor(t*18.), 3.));
  float grain = h21(uv*vec2(613., 419.) + floor(t*24.));
  float scratch = smoothstep(.003, 0., abs(uv.x - h21(vec2(floor(t*6.), 1.))))*step(.6, h21(vec2(floor(t*6.), 2.)));
  float vig = smoothstep(1.1, .25, length((uv - .5)*vec2(1., .8)));
  vec3 base = mix(uC3*.3, mix(uC2, uC1, .5)*.8, vig*vig*(.55 + .45*fbm(p*3. + t*.05)));
  vec3 col = base*fl + (grain - .5)*.12 + scratch*.35;
  return vec4(col*.94, .94);
}
vec4 comic(vec2 p, float t, float hw, vec2 ac){
  vec2 d = p - ac; float a = atan(d.y, d.x), r = length(d);
  float rays = step(.5, fract(a*7./TAU*4. + t*.05))*smoothstep(.05, .5, r);
  vec2 g = rot(p, .5)*55.; float dotR = .25 + .2*sin(p.x*3. + t)*sin(p.y*2.);
  float dots = smoothstep(dotR + .06, dotR, length(fract(g) - .5));
  vec3 col = mix(uC2*.55, uC1*.75, rays*.45); col = mix(col*.8, col*1.12, dots*.7);
  col = mix(col, uC3*.6, smoothstep(.0, hw, p.y)*.55);
  return vec4(col*.94, .94);
}
vec4 crt(vec2 p, float t, float hw, vec2 uv){
  vec2 c = uv - .5; vec2 cu = uv + c*dot(c, c)*.15;
  float scan = .7 + .3*sin(cu.y*hw*520.); float roll = smoothstep(.06, 0., abs(fract(cu.y - t*.15) - .5))*.25;
  float n = fbm(p*vec2(4., 30.) + t*.4)*.15;
  float vig = smoothstep(.75, .2, length(c*vec2(1.1, .9)));
  vec3 col = mix(uC3*.4, uC1*.75, .25 + n + roll)*scan*vig + uC1*.06;
  return vec4(col*.95, .95);
}
vec4 stage(vec2 p, float t, float hw){
  vec3 col = uC3*.45 + uC2*.15*fbm(p*2. + t*.08);
  for (int i = 0; i < 5; i++){ float k = float(i);
    vec2 o = vec2(.1 + k*.2, hw + .05); float ang = -1.5708 + sin(t*.6 + k*1.7)*.55;
    vec2 d = p - o; float al = atan(d.y, d.x) - ang; al = mod(al + 3.14159, TAU) - 3.14159;
    float beam = exp(-al*al*90.)*smoothstep(1.4, .1, length(d))*(.6 + .4*fbm(p*4. + t*.3));
    col += mix(uC1, uC2, mod(k, 2.))*beam*.75; }
  col += uC1*exp(-(hw - p.y)*4.)*.2;
  return vec4(col*.95, .95);
}
vec4 police(vec2 p, float t, float hw){
  // Photosensitivity: a soft, slow alternation (about 0.4 Hz), never a hard strobe.
  float ph = smoothstep(-.6, .6, sin(t*2.6)); float strobe = .8 + .2*sin(t*1.3);
  vec3 red = vec3(1., .12, .15), blue = vec3(.15, .35, 1.);
  float l = exp(-length(p - vec2(0., .05))*2.6), r = exp(-length(p - vec2(1., .05))*2.6);
  vec3 col = uC3*.5 + fbm(p*3. + t*.1)*uC3*.3 + red*l*(ph*strobe)*.9 + blue*r*((1. - ph)*strobe)*.9;
  return vec4(col*.95, .95);
}
vec4 tunnel(vec2 p, vec2 c, float t){
  vec2 d = p - c; float r = length(d), a = atan(d.y, d.x);
  float z = .25/(r + .02) + t*1.2; float tw = a + z*.25;
  float n = fbm(vec2(cos(tw), sin(tw))*1.5 + vec2(z*.6, 0.));
  float bands = .5 + .5*sin(z*6. + n*4.);
  vec3 col = mix(uC3*.6, mix(uC2, uC1, bands), smoothstep(.0, .8, n))*smoothstep(0., .25, r)*(.6 + .6*n);
  col += uC1*exp(-r*7.)*.8;
  return vec4(col*.95, .95);
}
vec4 clouds(vec2 p, float t, float hw){
  vec3 sky = mix(mix(mix(uC1, vec3(.5, .72, 1.), .55), vec3(1.), .15), mix(uC2, vec3(.3, .5, .9), .4), smoothstep(0., hw, p.y));
  float c1 = smoothstep(.5, .75, fbm(p*vec2(2.2, 4.) + vec2(t*.03, 0.)));
  float c2 = smoothstep(.55, .8, fbm(p*vec2(3.5, 6.) + vec2(t*.05, 3.)));
  vec3 col = mix(sky, vec3(1.), c1*.85); col = mix(col, vec3(.97), c2*.6);
  col = mix(col, uC3*.8, smoothstep(.45*hw, hw, p.y)*.75);
  return vec4(col*.94, .94);
}
vec4 lava(vec2 p, float t, float hw){
  float n = fbm(p*3. + vec2(0., t*.06)); float n2 = fbm(p*7. - t*.04 + n);
  float crack = smoothstep(.04, 0., abs(n2 - .5))*(.6 + .4*sin(t*1.5 + n*9.));
  float pool = smoothstep(.62, .75, n)*.8;
  vec3 col = uC3*(.35 + n2*.3) + mix(uC2, uC1, crack)*(crack + pool)*1.2;
  col += uC2*exp(-(hw - p.y)*3.)*.35;
  return vec4(col*.95, .95);
}
vec4 hexgrid(vec2 p, float t, float hw){
  vec2 q = p*14.; vec2 r = vec2(1., 1.732); vec2 h = r*.5;
  vec2 a = mod(q, r) - h, b = mod(q - h, r) - h; vec2 g = dot(a, a) < dot(b, b) ? a : b;
  vec2 id = q - g;
  float edge = smoothstep(.06, 0., .5 - max(abs(g.x)*.866 + abs(g.y)*.5, abs(g.y)));
  float pulse = pow(.5 + .5*sin(length(id)*.4 - t*2.5 + h21(id)*2.), 6.);
  vec3 col = uC3*.6 + mix(uC2, uC1, pulse)*(edge*(.18 + pulse*.5) + pulse*.1*(1. - edge));
  col *= .7 + .3*fbm(p*2. + t*.1);
  return vec4(col*.95, .95);
}
vec4 split(vec2 p, float t, float hw){
  float s = p.x + p.y*.55 - .55 - hw*.1 + (fbm(vec2(p.y*4., t*.3)) - .5)*.12;
  vec3 col = s < 0. ? uC1*.55 : uC2*.55; col *= .7 + .4*fbm(p*3. + t*.05);
  col += mix(uC1, uC2, step(0., s))*exp(-abs(s)*35.)*1.2 + vec3(1.)*exp(-abs(s)*140.)*.8;
  col = mix(col, uC3*.6, smoothstep(.4*hw, hw, p.y)*.6);
  return vec4(col*.95, .95);
}
vec4 glass(vec2 p, float t, float hw){
  vec2 q = p*7.; vec2 i = floor(q), f = fract(q); float md = 8., md2 = 8.; vec2 mid = vec2(0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){ vec2 g = vec2(x, y); vec2 o = vec2(h21(i + g), h21(i + g + 7.)); float d = length(g + o - f);
    if (d < md){ md2 = md; md = d; mid = i + g; } else if (d < md2) md2 = d; }
  float lead = smoothstep(.06, .02, md2 - md);
  float hsel = h21(mid);
  vec3 c = hsel < .33 ? uC1 : hsel < .66 ? uC2 : mix(uC1, vec3(1.), .5);
  float light = .55 + .45*sin(t*.6 + hsel*6.);
  vec3 col = mix(c*light*.6, uC3*.12, lead);
  col *= mix(1., .55, smoothstep(.35*hw, hw, p.y));
  return vec4(col*.95, .95);
}


// ---- premium atmospheres ----
// Liquid platinum: a slowly flowing metal surface lit by studio strip lights.
float liquid(vec2 q, float t){ return fbm3(q + vec2(fbm3(q*1.3 + vec2(t*.05, 0.)), fbm3(q*1.3 + vec2(3.1, t*.04)))*1.3); }
vec4 chrome(vec2 p, float t, float hw){
  vec2 q = p*1.6 + vec2(0., t*.02); float e = .012;
  float h = liquid(q, t), hx = liquid(q + vec2(e, 0.), t), hy = liquid(q + vec2(0., e), t);
  vec3 n = normalize(vec3((h - hx)/e*.32, (h - hy)/e*.32, 1.));
  vec3 r = reflect(vec3(0., 0., -1.), n);
  float strip1 = exp(-pow((r.x - .3 + sin(t*.17)*.12)*8., 2.)), strip2 = exp(-pow((r.x + .5 + cos(t*.13)*.08)*12., 2.))*.6;
  float sky = smoothstep(-.3, .8, -r.y)*.5;
  float key = pow(max(0., dot(r, normalize(vec3(.35, -.6, .72)))), 36.)*1.4;
  float env = sky + strip1*.85 + strip2 + key;
  vec3 metal = mix(uC3*.45, mix(uC2, uC1, .65), clamp(env, 0., 1.)) + vec3(1.)*pow(clamp(env - .75, 0., 1.), 2.)*.9;
  metal *= .78 + .3*h;
  metal = mix(metal, uC3*.55 + metal*.25, smoothstep(.3*hw, .75*hw, p.y)*.7); // keep the text area quiet
  return vec4(metal*.95, .95);
}
// Gothic windows: three pointed arches of stained glass, light shafts falling through dusty air.
float arch(vec2 d, float w, float ys, float yb){
  float inBox = step(abs(d.x), w)*step(d.y, yb);
  float above = step(d.y, ys)*step(length(d - vec2(-w, ys)), 2.*w)*step(length(d - vec2(w, ys)), 2.*w);
  return inBox*max(step(ys, d.y), above);
}
vec3 stained(vec2 p, float t){
  vec2 q = p*34.; vec2 i = floor(q), f = fract(q); float md = 8., md2 = 8.; vec2 mid = vec2(0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){ vec2 g = vec2(x, y); vec2 o = vec2(h21(i + g), h21(i + g + 7.))*.85 + .075; float dd = length(g + o - f);
    if (dd < md){ md2 = md; md = dd; mid = i + g; } else if (dd < md2) md2 = dd; }
  float lead = smoothstep(.13, .05, md2 - md); float hs = h21(mid);
  vec3 c = hs < .35 ? uC2*.9 : hs < .62 ? uC1*.85 : hs < .85 ? mix(uC2, vec3(.1, .2, .7), .5) : mix(uC1, vec3(.8, .1, .15), .5);
  float sheen = .62 + .38*sin(t*.4 + hs*9. + p.y*6.);
  return mix(c*sheen*(.7 + .5*fbm3(p*60.)), vec3(.015), lead);
}
vec4 cathedral(vec2 p, float t, float hw){
  vec3 col = uC3*.32*(.8 + .2*fbm(p*4.));
  float shaft = 0.; vec3 tint = vec3(0);
  for (int k = 0; k < 3; k++){ float fk = float(k);
    vec2 c = vec2(.18 + fk*.32, 0.); float w = fk == 1. ? .085 : .065; float ys = fk == 1. ? .17 : .2, yb = fk == 1. ? .5 : .45;
    float m = arch(p - c, w, ys, yb);
    col = mix(col, stained(p + fk*3.7, t)*1.25, m);
    float frame = arch(p - c, w + .012, ys, yb + .012) - m; col = mix(col, uC3*.15 + uC2*.08, clamp(frame, 0., 1.));
    // shaft: light leaving the window bottom and slanting down to the right
    float sx = p.x - (p.y - yb)*.35 - c.x; float below = smoothstep(yb, yb + .05, p.y);
    float s = smoothstep(w, w*.4, abs(sx))*below*exp(-(p.y - yb)*1.6);
    shaft += s; tint += mix(uC1, uC2, fk*.5)*s; }
  float dust = .55 + .45*fbm(p*9. + vec2(t*.05, -t*.12));
  col += tint*.35*dust;
  float rose = 0.; // candle glow from below
  col += vec3(1., .6, .25)*exp(-(hw - p.y)*5.)*(.18 + .05*sin(t*7.)*sin(t*3.1));
  return vec4(col*.96, .96);
}
// Circuit board: traces and pads, with light pulses running along them.
vec4 circuit(vec2 p, float t, float hw){
  vec2 g = p*34.; vec2 i = floor(g), f = fract(g);
  float hRow = h21(vec2(i.y, 11.)), hCol = h21(vec2(i.x, 23.));
  float spanH = step(.42, h21(vec2(floor(i.x/5. + hRow*3.), i.y + 2.)))*step(.3, hRow);
  float spanV = step(.62, h21(vec2(i.x + 5., floor(i.y/6. + hCol*3.))))*step(.5, hCol);
  float lineH = smoothstep(.07, .025, abs(f.y - .5))*spanH, lineV = smoothstep(.07, .025, abs(f.x - .5))*spanV;
  float pad = smoothstep(.24, .17, length(f - .5))*step(.9, h21(i + 4.))*clamp(spanH + spanV, 0., 1.);
  float via = smoothstep(.12, .08, length(f - .5))*step(.97, h21(i + 9.));
  float trace = clamp(max(max(lineH, lineV), pad) + via, 0., 1.);
  float px = fract(t*.09 + hRow*5.)*44. - 6., py = fract(t*.07 + hCol*3.)*60. - 6.;
  float pulseH = smoothstep(4., 0., px - g.x)*step(g.x, px)*lineH, pulseV = smoothstep(5., 0., py - g.y)*step(g.y, py)*lineV;
  float pulse = clamp(pulseH + pulseV, 0., 1.);
  vec3 col = uC3*.55 + uC2*.06*fbm(p*6.);
  float depth = mix(1., .45, smoothstep(.25*hw, .8*hw, p.y));
  col += (uC2*trace*.2 + uC1*pulse*1.5 + uC1*pad*.12)*depth;
  col += uC1*exp(-pow((p.y - fract(t*.07)*hw*1.4 + .2)*30., 2.))*.06; // a faint scan line
  return vec4(col*.95, .95);
}
// Motorsport: track-light streaks at three depths, heat shimmer, a low sun of pit lights.
vec4 track(vec2 p, float t, float hw){
  vec2 hp = p + vec2(0., (noise(p*vec2(20., 6.) + vec2(0., t*3.)) - .5)*.006*smoothstep(.4*hw, hw, p.y));
  vec3 col = mix(uC3*.55, uC3*.18, smoothstep(0., hw, hp.y));
  for (int i = 0; i < 3; i++){ float k = float(i); float sc = 7. + k*10.;
    float row = floor(hp.y*sc); float h = h21(vec2(row, k + 1.));
    float x = fract(hp.x*(.5 + h*.6) + t*(.9 + k*1.1)*(.6 + h) + h*7.);
    float streak = smoothstep(0., .03, x)*smoothstep(.6, .03, x)*step(.7, h)*smoothstep(.5, .1, abs(fract(hp.y*sc) - .5));
    col += mix(uC2, uC1, h)*streak*(.22 + k*.22); }
  float apex = exp(-length((hp - vec2(.82, .1))*vec2(1., 1.8))*4.);
  col += uC1*apex*.35;
  col += vec3(1.)*smoothstep(.003, 0., abs(hp.y - hw*.86))*.08; // a kerb line
  return vec4(col*.95, .95);
}
// Crimson Static: rolling fog, a distant red storm that pulses at irregular times, organic shadow, analog noise.
vec4 crimson(vec2 p, float t, float hw, vec2 uv){
  float f1 = fbm(p*vec2(1.5, 2.3) + vec2(t*.045, t*.012));
  float f2 = fbm(p*vec2(3.1, 4.6) + vec2(-t*.07, t*.02) + f1*1.2);
  float fogd = smoothstep(.32, .95, f1*.6 + f2*.55);
  float slot = floor(t/2.7); float ph = fract(t/2.7);
  float on = step(.5, h21(vec2(slot, 7.))); float when = h21(vec2(slot, 9.))*.5;
  float pulse = on*exp(-max(ph - when, 0.)*7.)*step(when, ph);
  vec2 src = vec2(.15 + .7*h21(vec2(slot, 3.)), .02);
  float glowR = exp(-length((p - src)*vec2(1., 1.5))*2.4);
  float ambient = .55 + .45*sin(t*.35); // the whole sky breathes red
  vec3 col = uC3*.7 + uC2*fogd*(.55 + ambient*.25) + uC1*glowR*(.22 + pulse*.9) + uC1*fogd*pulse*.35 + uC2*.12*exp(-p.y*3.)*ambient;
  float sil = smoothstep(.55, .75, fbm(vec2(p.x*2.6, p.y*1.4 - t*.015)) + smoothstep(.6*hw, hw, p.y)*.55 - .25);
  col *= 1. - sil*.75*smoothstep(.35*hw, hw, p.y);
  float tear = step(.988, h21(vec2(floor(uv.y*160.), floor(t*14.))));
  col += uC1*tear*.06 + (h21(uv*vec2(500., 700.) + floor(t*20.)) - .5)*.035;
  return vec4(col*.96, .96);
}
// Concert lasers through haze.
vec4 lasers(vec2 p, float t, float hw){
  vec3 col = uC3*.38 + uC2*.1*fbm(p*2. + t*.1);
  vec2 o = vec2(.5, hw*.98); vec2 d = p - o; float a = atan(d.x, -d.y); float r = length(d);
  float fan = 0.; for (int i = 0; i < 9; i++){ float k = float(i) - 4.; float ang = k*.15 + sin(t*.55)*.4*sin(t*.21 + 1.); fan += exp(-pow((a - ang)*r*160., 2.)); }
  float haze = .35 + .65*fbm(p*3. + vec2(0., -t*.18));
  col += mix(uC1, uC2, .5 + .5*sin(t*.4))*fan*haze*smoothstep(1.5, .1, r)*.9;
  col += uC1*exp(-r*5.)*.35;
  return vec4(col*.95, .95);
}
// Clockwork: three meshed gears, their speeds set by their tooth counts.
float gearMask(vec2 q, float R, float teeth, float ang){
  float a = atan(q.y, q.x) + ang, r = length(q);
  float rr = R*(1. + .1*smoothstep(-.25, .25, cos(a*teeth)));
  float body = smoothstep(rr + .003, rr - .003, r)*smoothstep(R*.3 - .003, R*.3 + .003, r);
  float holes = 0.; for (int k = 0; k < 5; k++){ float ha = float(k)*1.2566 - ang; holes += smoothstep(R*.16, R*.13, length(q - vec2(cos(ha), sin(ha))*R*.6)); }
  return body*(1. - clamp(holes, 0., 1.));
}
vec4 clockwork(vec2 p, float t, float hw){
  vec3 col = uC3*.45*(.85 + .15*fbm(p*5.));
  float w = t*.25;
  vec2 c1 = vec2(.58, .07), c2 = c1 + vec2(.155*.98 + .1*.98, .07), c3 = c1 + vec2(-.04, .2);
  float g1 = gearMask(p - c1, .155, 20., w), g2 = gearMask(p - c2, .1, 13., -w*20./13. + .12), g3 = gearMask(p - c3, .07, 9., -w*20./9. + .3);
  float g = max(max(g1, g2), g3);
  vec2 l = normalize(vec2(-.6, -.8)); float shade = .55 + .45*dot(normalize(p - (g1 > 0. ? c1 : g2 > 0. ? c2 : c3) + 1e-4), l);
  vec3 brass = mix(uC2*.7, uC1, shade) + vec3(1.)*pow(max(0., shade), 12.)*.25;
  col = mix(col, brass*.62, g*.85);
  col += uC1*.05*exp(-length(p - c1)*6.);
  return vec4(col*.95, .95);
}
// Rain on glass over a blurred night city.
vec4 rainglass(vec2 p, float t, float hw){
  vec3 col = uC3*.5 + mix(uC2, uC1, .3)*.08*fbm(p*2.);
  col += bokeh(p, 4., t*.4, .015).rgb*1.6 + bokeh(p + 3.1, 7., t*.4, .025).rgb;
  vec2 g = p*vec2(12., 6.); vec2 i = floor(g), f = fract(g) - .5; float h = h21(i);
  float slide = fract(t*.07*(.4 + h) + h); vec2 dp = vec2((h21(i + 2.) - .5)*.6, slide*.9 - .45);
  float drop = smoothstep(.13, .08, length((f - dp)*vec2(1., 1.35)))*step(.55, h);
  float trail = smoothstep(.035, .0, abs(f.x - dp.x))*step(f.y, dp.y)*step(.55, h)*.4;
  float bead = smoothstep(.05, .02, length(fract(p*vec2(40., 30.)) - .5))*step(.82, h21(floor(p*vec2(40., 30.))));
  col = col*(1. - drop*.25) + (uC1*.55 + .35)*(drop*.55 + bead*.25) + uC2*trail*.25;
  return vec4(col*.95, .95);
}
// Bioluminescent forest: layered tree silhouettes in mist, glowing undergrowth.
vec4 grove(vec2 p, float t, float hw){
  vec3 col = mix(uC2*.25, uC3*.4, smoothstep(0., hw, p.y));
  for (int i = 0; i < 3; i++){ float k = float(i);
    float x = p.x*(2.5 + k*2.) + k*7.3; float trunk = smoothstep(.5, .46, abs(fract(x) - .5) + .4 - noise(vec2(floor(x), k))*.12);
    float mist = .35 + .2*fbm(vec2(p.x*3., p.y*2. - t*.03) + k);
    col = mix(col, uC3*(.15 + k*.08), trunk*(.55 + k*.15)*mist*2.); }
  float glow = smoothstep(.62, .9, fbm(p*vec2(8., 5.) + vec2(t*.04, 0.)))*smoothstep(.55*hw, hw, p.y);
  col += uC1*glow*(.6 + .4*sin(t*1.3 + p.x*20.));
  col += uC1*.08*exp(-(hw - p.y)*3.);
  return vec4(col*.95, .95);
}

// ---- hero objects ----
vec4 hero(vec2 p, vec2 c, float r, float t){
  vec2 d = (p - c)/r; float l = length(d); vec4 o = vec4(0);
  if (uHero == 1){ // moon
    vec3 glow = mix(uC1, vec3(.85, .9, 1.), .5)*exp(-max(l - 1., 0.)*5.)*.55*step(1., l);
    if (l < 1.){ vec3 n = vec3(d, sqrt(1. - l*l)); vec3 L = normalize(vec3(-.55, -.45, .7));
      vec2 tc = rot(d, uHeroP.w*t)*2.4;
      float maria = smoothstep(.45, .7, fbm(tc*.55 + 3.));
      float tex = fbm(tc*2.2 + 7.)*.6 + fbm(tc*6. + 2.)*.4; float cr = 0., rim = 0.;
      for (int k = 0; k < 9; k++){ vec2 cc = vec2(h21(vec2(float(k), 1.)), h21(vec2(float(k), 2.)))*2.4 - 1.2; float rr = .08 + h21(vec2(float(k), 3.))*.2;
        vec2 dv = tc*.5 - cc; float dd = length(dv);
        cr += smoothstep(rr, rr*.2, dd)*.22;
        rim += smoothstep(rr*1.25, rr, dd)*smoothstep(rr*.75, rr, dd)*clamp(dot(normalize(dv + 1e-4), vec2(.55, .45)), 0., 1.)*.35; }
      float diff = clamp(dot(n, L), 0., 1.);
      vec3 base = mix(vec3(.8, .82, .87), mix(uC1, vec3(1.), .6), .3)*(.72 + tex*.38 - cr - maria*.22 + rim);
      vec3 col = base*(.12 + diff*1.05) + pow(1. - n.z, 3.)*mix(uC1, vec3(1.), .5)*.6;
      float a = smoothstep(1., .985, l); o = vec4(col*a, a);
    }
    o.rgb += glow; o.a = max(o.a, length(glow)*.5);
  } else if (uHero == 2){ // sun / sunrise
    float ang = atan(d.y, d.x);
    float corona = pow(noise(vec2(ang*8., t*.4)), 2.)*exp(-(l - 1.)*2.2)*step(1., l);
    vec3 col = mix(uC1, vec3(1., .96, .85), smoothstep(1., .2, l))*smoothstep(1.02, .96, l);
    vec3 g = (uC1*.8 + uC2*.25)*(exp(-max(l - 1., 0.)*2.5)*.55 + corona*.7)*smoothstep(.9, 1.05, l);
    o = vec4(col + g, max(smoothstep(1.02, .96, l), length(g)*.55));
  } else if (uHero == 3){ // black hole
    vec2 dd = rot(d, -.22); vec2 disk = vec2(dd.x, dd.y*3.4); float dl = length(disk);
    float ang = atan(disk.y, disk.x);
    float swirl = fbm(vec2(ang*3. - t*1.8, dl*5.)); float ringA = smoothstep(.72, .9, dl)*smoothstep(1.85, 1.1, dl);
    float dop = .6 + .55*cos(ang + .3);
    vec3 dc = mix(uC2, mix(uC1, vec3(1., .95, .85), .5), swirl)*ringA*(.45 + swirl*1.1)*dop*1.5;
    float front = step(0., dd.y); // lower half of the disk passes in front of the hole
    float photon = exp(-pow((l - .62)*28., 2.))*1.2; float lens = exp(-pow((length(vec2(dd.x, (dd.y + .05)*1.)) - .78)*9., 2.))*smoothstep(.1, -.6, dd.y)*.8;
    float hole = smoothstep(.57, .53, l);
    vec3 col = dc*mix(1. - hole, 1., front) + (uC1*.7 + .3)*(photon + lens*swirl);
    float a = clamp(max(hole, length(col)*.6), 0., 1.);
    col = mix(col, vec3(0.), hole*(1. - front*ringA));
    o = vec4(col, a);
    o.rgb += uC2*exp(-l*1.4)*.25*(1. - hole); o.a = max(o.a, exp(-l*1.4)*.2);
  } else if (uHero == 4){ // ringed planet
    vec2 dd = rot(d, -.35); vec2 rp = vec2(dd.x, dd.y*4.); float rl = length(rp);
    float ring = smoothstep(1.3, 1.36, rl)*smoothstep(2.1, 1.95, rl)*(.55 + .45*noise(vec2(rl*30., 1.)));
    vec3 rc = mix(uC1, uC2, .4)*ring;
    float behind = step(dd.y, 0.);
    vec4 planet = vec4(0);
    if (l < 1.){ vec3 n = vec3(d, sqrt(1. - l*l)); float bands = fbm(vec2(n.y*6. + fbm(n.xy*3. + t*.02)*1.5, t*.01));
      vec3 col = mix(uC2, uC1, bands)*(.15 + .95*clamp(dot(n, normalize(vec3(-.6, -.4, .7))), 0., 1.));
      planet = vec4(col, smoothstep(1., .985, l)); }
    vec3 col = planet.rgb*planet.a + rc*(behind > .5 ? (1. - planet.a) : 1.);
    o = vec4(col, max(planet.a, ring*.9));
    o.rgb += uC1*exp(-max(l - 1., 0.)*6.)*.3*step(1., l); o.a = max(o.a, exp(-max(l - 1., 0.)*6.)*.2*step(1., l));
  } else if (uHero == 5){ // portal
    float ang = atan(d.y, d.x); float tw = ang + 2./(l + .2) - t*1.4;
    float n = fbm(vec2(cos(tw), sin(tw))*l*3. + t*.2);
    float ringv = exp(-pow((l - .82 - n*.12)*7., 2.));
    float inner = smoothstep(.85, .2, l);
    vec3 col = mix(uC2, uC1, n)*ringv*1.6 + mix(uC3, uC2, n)*inner*(.5 + n);
    o = vec4(col, clamp(max(ringv, inner*.9), 0., 1.));
  } else if (uHero == 6){ // energy orb
    float n = fbm(rot(d, t*.3)*2.5 + t*.3); float rim = pow(clamp(l, 0., 1.), 4.);
    float body = smoothstep(1., .96, l);
    vec3 col = mix(uC2, uC1, n)*(.5 + n) + rim*mix(uC1, vec3(1.), .5);
    vec3 g = uC1*exp(-max(l - 1., 0.)*4.)*.6*step(1., l);
    o = vec4(col*body + g, max(body*.9, length(g)*.5));
  } else if (uHero == 7){ // eclipse
    float ang = atan(d.y, d.x);
    float breathe = .85 + .15*sin(t*.6);
    float streamers = pow(noise(vec2(ang*5., t*.12)), 3.)*exp(-(l - 1.)*1.1)*1.4;
    float cor = (exp(-(l - 1.)*2.6)*(.75 + .7*pow(noise(vec2(ang*11., t*.3)), 2.)) + streamers)*step(.985, l)*breathe;
    float inner = exp(-pow((l - 1.)*18., 2.))*1.4;
    float bead = exp(-pow(length(d - vec2(.62, -.78))*8., 2.))*1.8*(.7 + .3*sin(t*1.7));
    vec3 col = mix(uC1, vec3(1.), .45)*(cor + bead + inner) + uC2*exp(-(l - 1.)*1.)*.35*step(1., l);
    float disk = smoothstep(1.01, .99, l);
    o = vec4(col*(1. - disk) + uC3*.08*disk, max(disk, clamp(cor + bead, 0., 1.)*.9));
  }
  else if (uHero == 8){ // glowing ring
    float ring = exp(-pow((l - .8)*14., 2.)); float ins = fbm(vec2(atan(d.y, d.x)*4. - t*.8, 1.));
    vec3 col = mix(uC2, mix(uC1, vec3(1.), .5), ins)*ring*1.4 + uC1*exp(-max(l - .9, 0.)*4.)*.25*step(.9, l);
    o = vec4(col, clamp(ring + exp(-max(l - .9, 0.)*4.)*.15*step(.9, l), 0., 1.));
  } else if (uHero == 9){ // flaming eye
    vec2 e = vec2(d.x, d.y*1.9); float el = length(e); float ang = atan(e.y, e.x);
    float n = fbm(vec2(ang*3. - t*.6, el*3. - t*1.5));
    float fire = smoothstep(1.15 + n*.35, .3, el);
    float slit = smoothstep(.09, .03, abs(d.x))*smoothstep(.6, .2, abs(d.y));
    vec3 col = mix(uC2, uC1, fire)*fire*1.4; col = mix(col, vec3(1., .95, .7), smoothstep(.6, .95, fire)*.5); col = mix(col, vec3(0.), slit);
    o = vec4(col, clamp(fire*1.1, 0., 1.));
  }
  else if (uHero == 10){ // rose window: rotating stone tracery over stained glass
    if (l < 1.){ float a = atan(d.y, d.x) + t*.03; float petals = .5 + .5*cos(a*12.);
      float ringT = smoothstep(.03, .0, abs(l - .38)) + smoothstep(.03, .0, abs(l - .72)) + smoothstep(.04, .01, abs(l - .98));
      float spokes = smoothstep(.05, .02, abs(sin(a*6.))*l)*step(.38, l);
      float lobes = smoothstep(.02, 0., abs(l - (.55 + .17*petals)))*step(.38, l);
      vec3 glassC = stained(d*.5 + 4., t);
      float tracery = clamp(ringT + spokes + lobes, 0., 1.);
      vec3 col = mix(glassC*1.3, uC3*.25 + vec3(.06), tracery);
      o = vec4(col, smoothstep(1.02, .98, l)); }
    o.rgb += mix(uC1, uC2, .5)*exp(-max(l - 1., 0.)*4.)*.35*step(1., l); o.a = max(o.a, exp(-max(l - 1., 0.)*4.)*.25*step(1., l));
  } else if (uHero == 11){ // clock face: dial, ticking second hand, an open tourbillon cage
    if (l < 1.){ float a = atan(d.x, -d.y); float r = l;
      float idx = smoothstep(.04, .0, abs(fract(a/TAU*12. + .5) - .5)*r*1.6)*step(.78, r)*step(r, .9);
      float mins = smoothstep(.015, .0, abs(fract(a/TAU*60. + .5) - .5)*r*1.6)*step(.86, r)*step(r, .9);
      float sec = floor(t)*TAU/60. + smoothstep(.0, .12, fract(t))*TAU/60.; // ticks, with a little settle
      vec2 sd = vec2(sin(sec), -cos(sec)); float hand = smoothstep(.012, .0, abs(dot(d, vec2(-sd.y, sd.x))))*step(0., dot(d, sd))*step(r, .82);
      float mh = t*TAU/3600.*20.; vec2 md = vec2(sin(mh), -cos(mh)); float minute = smoothstep(.025, .0, abs(dot(d, vec2(-md.y, md.x))))*step(0., dot(d, md))*step(r, .7);
      vec2 tc = d - vec2(0., .42); float cage = gearMask(rot(tc, t*.9), .22, 10., 0.)*.9 + smoothstep(.02, 0., abs(length(tc) - .25))*.6;
      vec3 dial = mix(uC3*.6 + vec3(.04), mix(uC2, uC1, .3)*.5, smoothstep(1., .2, r)*.6) + vec3(1.)*pow(max(0., dot(normalize(vec3(d, .6)), normalize(vec3(-.4, -.6, .7)))), 20.)*.25;
      vec3 metal = mix(uC1, vec3(1.), .4);
      vec3 col = dial; col = mix(col, metal, clamp(idx + mins*.6 + minute + cage*.8, 0., 1.)); col = mix(col, uC2*1.2 + .2, hand);
      float bezel = smoothstep(.93, .97, r);
      col = mix(col, metal*(.6 + .4*cos(a*2. + 1.)), bezel);
      o = vec4(col, smoothstep(1.01, .99, l)); }
    o.rgb += uC1*exp(-max(l - 1., 0.)*5.)*.3*step(1., l); o.a = max(o.a, exp(-max(l - 1., 0.)*5.)*.2*step(1., l));
  }
  return o;
}

// ---- avatar rings (uDeco == 1). p is in the decoration canvas (0…1, centre .5); the avatar edge sits at r≈.714 ----
vec4 ring(vec2 uv, float t){
  vec2 d = (uv - .5)*2.; float r = length(d); float a = atan(d.y, d.x); vec2 q = vec2(cos(a), sin(a));
  float inner = .70; vec3 col = vec3(0); float al = 0.;
  if (uRing == 1){ // flame
    float n = fbm(q*1.8 + vec2(r*3.2 - t*1.6, t*.4)); float n2 = fbm(q*4. + vec2(r*6. - t*2.6, 0.));
    float outer = .83 + (n*.7 + n2*.5 - .45)*.55 + max(0., -d.y)*.1;
    float f = smoothstep(outer, inner, r)*smoothstep(inner - .02, inner + .015, r);
    float heat = clamp((outer - r)/(outer - inner), 0., 1.);
    col = mix(uC2, uC1, heat); col = mix(col, vec3(1., .96, .8), smoothstep(.75, 1., heat)); al = f;
  } else if (uRing == 2){ // electric
    for (int i = 0; i < 3; i++){ float k = float(i);
      float off = (fbm3(q*2.2 + vec2(t*3.1 + k*7., k)) - .5)*.16; float dl = abs(r - (.76 + off));
      float v = .0028/(dl + .002); col += mix(uC1, uC2, k*.5)*v*.6; al += v*.45; }
    col += uC1*smoothstep(.2, 0., abs(r - .76))*.3; al += smoothstep(.2, 0., abs(r - .76))*.25;
    al *= smoothstep(inner - .02, inner + .02, r);
  } else if (uRing == 3){ // ice
    float seg = floor((a/TAU + .5)*18.); float h = h21(vec2(seg, 3.));
    float outer = .78 + h*.12*(.6 + .4*sin(t*.8 + h*20.)); float fac = fract((a/TAU + .5)*18.);
    float tooth = outer - abs(fac - .5)*(outer - .78)*1.6;
    float f = smoothstep(tooth + .005, tooth - .01, r)*smoothstep(inner - .01, inner + .01, r);
    col = mix(uC2, mix(uC1, vec3(1.), .5), .4 + .6*h)*(.7 + .5*step(.5, fac)) + vec3(1.)*exp(-pow((a - mod(t*.9, TAU) + 3.14159)*3., 2.))*.5;
    al = f*.95;
  } else if (uRing == 4){ // nebula swirl
    float n = fbm(rot(d, t*.25)*2.6 + vec2(0., t*.1)); float band = smoothstep(.98 + n*.1, .76, r)*smoothstep(inner - .02, inner + .03, r);
    col = mix(uC2, uC1, n)*(.6 + n*.9) + vec3(stars(uv*1.3, 22., t))*1.2; al = band*(.55 + n*.5);
  } else if (uRing == 5){ // polished metal / gold
    float w = smoothstep(.83, .8, r)*smoothstep(inner - .01, inner + .01, r);
    float spec = pow(.5 + .5*cos(a*2. - t*.9), 12.) + pow(.5 + .5*cos(a*3. + t*.6 + 1.), 20.)*.6;
    float bevel = 1. - abs((r - .765)/.065);
    col = mix(uC2*.6, uC1, .5 + .5*cos(a*2. + 1.))*(.55 + bevel*.6) + vec3(1.)*spec*.85; al = w;
    float gem = 0.; for (int i = 0; i < 4; i++){ float ga = float(i)*1.5708 + .785; vec2 gp = vec2(cos(ga), sin(ga))*.765; gem += smoothstep(.07, .05, length(d - gp)); }
    col = mix(col, mix(uC2, vec3(1.), .25)*(1.1 + .3*sin(t*2.)), clamp(gem, 0., 1.)); al = max(al, clamp(gem, 0., 1.));
  } else if (uRing == 6){ // shadow / smoke
    float n = fbm(q*2. + vec2(r*2.5 - t*.6, t*.2)); float n2 = fbm(q*5. + vec2(r*5. - t*1.1, 0.)); float outer = .84 + (n*.7 + n2*.4 - .5)*.6;
    al = smoothstep(outer, inner, r)*smoothstep(inner - .02, inner + .02, r)*(.55 + n2*.45);
    col = mix(uC2*.55, mix(uC2, uC1, .55), n*1.1) + uC1*exp(-pow((r - inner - .015)*40., 2.))*.9 + uC1*smoothstep(.03, 0., abs(r - outer + .02))*.25;
  } else if (uRing == 7){ // water
    float outer = .79 + sin(a*7. + t*1.6)*.025 + sin(a*13. - t*2.1)*.015;
    al = smoothstep(outer, outer - .02, r)*smoothstep(inner - .01, inner + .01, r);
    float cst = pow(noise(q*4. + vec2(t*.7, r*9.)), 3.);
    col = mix(uC2, uC1, .3 + cst*1.4) + vec3(1.)*smoothstep(.012, 0., abs(r - outer + .012))*.7;
  } else if (uRing == 8){ // neon
    float l1 = exp(-pow((r - .74)*90., 2.)), l2 = exp(-pow((r - .8)*120., 2.)); float hz = .7 + .3*sin(t*3. + a*2.);
    vec3 cc = mix(uC1, uC2, .5 + .5*sin(a + t*.8));
    col = cc*(l1 + l2*.8)*1.4*hz + cc*exp(-pow((r - .77)*14., 2.))*.35; al = clamp((l1 + l2)*hz + exp(-pow((r - .77)*14., 2.))*.3, 0., 1.);
  } else if (uRing == 10){ // clockwork: a toothed gear turning, the light catching its teeth
    float ga = a - t*.22; float tooth = .785 + .04*smoothstep(-.25, .25, cos(ga*26.));
    float body = smoothstep(tooth + .006, tooth - .006, r)*smoothstep(inner - .01, inner + .01, r);
    float holes = 0.; for (int i = 0; i < 8; i++){ float ha = float(i)*.785 + t*.22; holes += smoothstep(.03, .022, length(d - vec2(cos(ha), sin(ha))*.748)); }
    float shade = .55 + .45*cos(a + 2.2);
    col = mix(uC2*.65, uC1, shade) + vec3(1.)*pow(max(0., cos(a + 2.2)), 16.)*.45 + uC1*smoothstep(.006, 0., abs(r - tooth + .004))*.3;
    al = body*(1. - clamp(holes, 0., 1.));
  } else if (uRing == 11){ // liquid platinum: a flowing metal band with moving reflections
    float n = fbm3(vec2(a*2. - t*.35, r*9.)); float outer = .8 + (n - .5)*.05;
    al = smoothstep(outer, outer - .012, r)*smoothstep(inner - .008, inner + .008, r);
    float bev = 1. - abs((r - (inner + outer)*.5)/((outer - inner)*.5));
    float refl = pow(.5 + .5*cos(a*3. + n*5. - t*.6), 6.) + pow(.5 + .5*cos(a - t*.25 + 2.), 30.)*1.2;
    col = mix(uC3*.4 + uC2*.25, mix(uC1, vec3(1.), .5), clamp(bev*.6 + refl*.7, 0., 1.)) + vec3(1.)*refl*.35;
  } else if (uRing == 12){ // circuit: segmented traces with light running round them
    float seg = fract((a/TAU + .5)*24.); float sid = floor((a/TAU + .5)*24.); float hs = h21(vec2(sid, 5.));
    float lane = hs < .5 ? .745 : .785; float trace = smoothstep(.009, .003, abs(r - lane))*step(.12, seg)*step(seg, .88 + hs*.12);
    float pad = smoothstep(.022, .014, length(d - vec2(cos(a), sin(a))*lane))*0.;
    float run = fract((a/TAU + .5) - t*.18 + hs*.05); float pulse = smoothstep(.06, 0., run)*trace;
    col = uC2*trace*.7 + uC1*pulse*2.2 + mix(uC1, uC2, .5)*smoothstep(.06, 0., abs(r - .765))*.08;
    al = clamp(trace*.75 + pulse, 0., 1.);
  } else if (uRing == 13){ // crimson static: red current that crackles at irregular moments
    float slot = floor(t*1.7); float burst = step(.55, h21(vec2(slot, 2.)))*exp(-fract(t*1.7)*5.);
    for (int i = 0; i < 3; i++){ float k = float(i);
      float off = (fbm3(q*2.6 + vec2(t*4.2 + k*7., k)) - .5)*(.1 + burst*.12); float dl = abs(r - (.765 + off));
      float v = .0022/(dl + .0018)*(.35 + burst*1.2); col += mix(uC1, vec3(1., .85, .8), k*.3)*v*.55; al += v*.4; }
    col += uC2*smoothstep(.12, 0., abs(r - .765))*.35; al += smoothstep(.12, 0., abs(r - .765))*.22;
    al *= smoothstep(inner - .02, inner + .02, r);
  } else if (uRing == 14){ // crown of light: spires rising above the head
    float up = clamp(-d.y/r, 0., 1.); float spires = pow(.5 + .5*cos(a*14.), 6.)*smoothstep(.2, .9, up);
    float h = .78 + spires*.14*(.85 + .15*sin(t*1.4 + a*5.));
    al = smoothstep(h, h - .02, r)*smoothstep(inner - .01, inner + .01, r)*(.55 + .45*up);
    col = mix(uC2, mix(uC1, vec3(1.), .5), smoothstep(.76, h, r)) + vec3(1.)*pow(spires, 4.)*.3*(.7 + .3*sin(t*2. + a*9.));
  } else if (uRing == 15){ // pixel: a stepped ring drawn on a coarse grid, colours cycling
    vec2 g = floor(uv*28.)/28. + .5/28.; vec2 gd = (g - .5)*2.; float gr = length(gd); float ga2 = atan(gd.y, gd.x);
    float band = step(inner + .01, gr)*step(gr, .82);
    float k = fract((ga2/TAU + .5)*6. - t*.4);
    col = mix(uC1, uC2, step(.5, k))*(.8 + .2*step(.79, gr)); al = band;
  } else if (uRing == 9){ // floral vine (petal lobes)
    float lobes = .5 + .5*cos(a*9. + sin(t*.6)*.4); float outer = .76 + lobes*.07;
    al = smoothstep(outer, outer - .015, r)*smoothstep(inner - .01, inner + .01, r);
    col = mix(uC2, uC1, lobes)*(.75 + .35*smoothstep(outer - .06, outer, r)) + vec3(1.)*pow(lobes, 10.)*.25;
  }
  // soft outer glow for every ring
  float glow = exp(-max(r - .8, 0.)*9.)*step(inner, r)*.35;
  col += uC1*glow*(1. - al); al = max(al, glow*.6);
  al *= smoothstep(inner - .03, inner, r);
  return vec4(col*al, al);
}

void main(){
  float t = uTime*uSpeed;
  if (uDeco == 1){ o = ring(vUv, uTime); o *= uIntensity; return; }
  vec2 uv0 = vUv;
  // Analog tearing during a glitch event: rows slide sideways and the signal rolls.
  if (uGlitch > 0.){ float row = floor(uv0.y*48.); float hh = h21(vec2(row, floor(uTime*24.)));
    uv0.x += (hh - .5)*.09*uGlitch*step(.55, hh); uv0.y += sin(uTime*40.)*.004*uGlitch; }
  vec2 p = vec2(uv0.x, uv0.y*uHW);
  vec2 hc = vec2(uHeroP.x, uHeroP.y*uHW);
  vec4 s = vec4(0);
  if (uMode == 1) s = vortex(p, uHero > 0 ? hc : vec2(.62, .12*uHW), t);
  else if (uMode == 2) s = nebula(p, t);
  else if (uMode == 3) s = aurora(p, t);
  else if (uMode == 4) s = fire(p, t, uHW);
  else if (uMode == 5) s = fog(p, t, uHW);
  else if (uMode == 6) s = neonrain(p, t, uHW);
  else if (uMode == 7) s = rays(p, uHero > 0 ? hc : vec2(.7, -.05), t, uHW);
  else if (uMode == 8) s = caustics(p, t, uHW);
  else if (uMode == 9) s = synth(p, t, uHW);
  else if (uMode == 10) s = digital(p, t, uHW);
  else if (uMode == 11) s = storm(p, t);
  else if (uMode == 12) s = sand(p, t, uHW);
  else if (uMode == 13) s = holo(p, t, uHW);
  else if (uMode == 14) s = ink(p, t, uHW);
  else if (uMode == 15) s = dreamy(p, t, uHW);
  else if (uMode == 16) s = space(p, t);
  else if (uMode == 17) s = film(p, t, uHW, vUv);
  else if (uMode == 18) s = comic(p, t, uHW, vec2(uAnchor.x, uAnchor.y*uHW));
  else if (uMode == 19) s = crt(p, t, uHW, vUv);
  else if (uMode == 20) s = stage(p, t, uHW);
  else if (uMode == 21) s = police(p, t, uHW);
  else if (uMode == 22) s = tunnel(p, uHero > 0 ? hc : vec2(.6, .14*uHW), t);
  else if (uMode == 23) s = clouds(p, t, uHW);
  else if (uMode == 24) s = lava(p, t, uHW);
  else if (uMode == 25) s = hexgrid(p, t, uHW);
  else if (uMode == 26) s = split(p, t, uHW);
  else if (uMode == 27) s = glass(p, t, uHW);
  else if (uMode == 28) s = chrome(p, t, uHW);
  else if (uMode == 29) s = cathedral(p, t, uHW);
  else if (uMode == 30) s = circuit(p, t, uHW);
  else if (uMode == 31) s = track(p, t, uHW);
  else if (uMode == 32) s = crimson(p, t, uHW, uv0);
  else if (uMode == 33) s = lasers(p, t, uHW);
  else if (uMode == 34) s = clockwork(p, t, uHW);
  else if (uMode == 35) s = rainglass(p, t, uHW);
  else if (uMode == 36) s = grove(p, t, uHW);
  if (uGlitch > 0.){ float sl = step(.97, h21(vec2(floor(uv0.y*90.), floor(uTime*30.)))); s.rgb += uC1*sl*.25*uGlitch; s.rgb *= 1. - uGlitch*.25*step(.5, h21(vec2(floor(uv0.y*12.), floor(uTime*18.)))); }
  // Keep the text area calm: the atmosphere is strongest across the banner and eases off down the card.
  float calm = mix(1., .5, smoothstep(.2*uHW, .42*uHW, p.y)); // name, status and bio stay readable over any atmosphere
  s *= uIntensity*calm;
  if (uHero > 0){ vec4 h = hero(p, hc, uHeroP.z, t); s = h + s*(1. - h.a); }
  // Entrance: the effect blooms outward from the avatar.
  vec2 ac = vec2(uAnchor.x, uAnchor.y*uHW);
  float reveal = uIntro*2.4 - length(p - ac);
  float rv = smoothstep(0., .25, reveal);
  float edgeGlow = exp(-pow(reveal*9., 2.))*(1. - uIntro)*1.2;
  s = s*rv + vec4(mix(uC1, vec3(1.), .4)*edgeGlow, edgeGlow*.8)*step(.001, uIntro)*(1. - step(.999, uIntro));
  o = s;
}`;

export const SPRITE_VS = `#version 300 es
in vec2 aP;
in vec4 aXYS;   // x, y, half-width, half-height (px)
in vec4 aRAF;   // rotation, alpha, atlas cell, unused
in vec3 aC;
uniform vec2 uRes; uniform float uGrid;
out vec2 vT; out vec4 vC;
void main(){
  float c = cos(aRAF.x), s = sin(aRAF.x);
  vec2 q = vec2(aP.x*aXYS.z, aP.y*aXYS.w); q = vec2(c*q.x - s*q.y, s*q.x + c*q.y);
  vec2 px = aXYS.xy + q;
  gl_Position = vec4(px.x/uRes.x*2. - 1., 1. - px.y/uRes.y*2., 0., 1.);
  float cell = aRAF.z; vec2 cc = vec2(mod(cell, uGrid), floor(cell/uGrid));
  vT = (cc + (aP*.5 + .5)*.992 + .004)/uGrid;
  vC = vec4(aC, aRAF.y);
}`;

export const SPRITE_FS = `#version 300 es
precision mediump float;
in vec2 vT; in vec4 vC; uniform sampler2D uTex; out vec4 o;
void main(){ vec4 t = texture(uTex, vT); o = vec4(t.rgb*vC.rgb, t.a)*vC.a; }`;
