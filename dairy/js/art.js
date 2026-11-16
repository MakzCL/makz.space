// Original illustrations drawn as inline SVG (no image files, no network): the farm landscape at
// the top of the Today screen and the cow pictures shown for animals without a photo.
import { raw } from './ui.js';

/** Rolling green hills, a red barn, a silo, a fence and a few grazing cows under a morning sky. */
export function farmScene() {
  return raw(`<svg class="farm-svg" viewBox="0 0 400 220" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="fs-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9fcbe6"/><stop offset=".6" stop-color="#d8ecf2"/><stop offset="1" stop-color="#f1f4e4"/></linearGradient>
    <linearGradient id="fs-h1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fbf6a"/><stop offset="1" stop-color="#6fa451"/></linearGradient>
    <linearGradient id="fs-h2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5d9a45"/><stop offset="1" stop-color="#3f7a33"/></linearGradient>
    <linearGradient id="fs-h3" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3f7d34"/><stop offset="1" stop-color="#245a26"/></linearGradient>
    <linearGradient id="fs-shade" x1="0" y1="0" x2="0" y2="1"><stop offset=".45" stop-color="#0b2a17" stop-opacity="0"/><stop offset="1" stop-color="#0b2a17" stop-opacity=".62"/></linearGradient>
  </defs>
  <rect width="400" height="220" fill="url(#fs-sky)"/>
  <circle cx="318" cy="46" r="20" fill="#fff6cf" opacity=".9"/>
  <g fill="#fff" opacity=".85"><ellipse cx="78" cy="40" rx="26" ry="8"/><ellipse cx="98" cy="35" rx="16" ry="8"/><ellipse cx="236" cy="28" rx="20" ry="6"/></g>
  <path d="M0 120 C60 96 120 104 170 112 S280 92 400 108 V220 H0Z" fill="url(#fs-h1)"/>
  <g transform="translate(250 82)">
    <rect x="44" y="0" width="16" height="46" rx="3" fill="#e7e6df"/><path d="M44 2 Q52 -10 60 2Z" fill="#c9c8c0"/>
    <rect x="44" y="12" width="16" height="2" fill="#cfcec6"/><rect x="44" y="26" width="16" height="2" fill="#cfcec6"/>
    <path d="M0 22 L21 6 L42 22 V46 H0Z" fill="#b8402f"/><path d="M-3 23 L21 4 L45 23" fill="none" stroke="#f3efe6" stroke-width="3" stroke-linejoin="round"/>
    <rect x="13" y="28" width="16" height="18" fill="#8f2f22"/><path d="M13 28 L29 46 M29 28 L13 46" stroke="#f3efe6" stroke-width="1.6"/>
    <rect x="17" y="13" width="8" height="7" fill="#f3efe6"/>
  </g>
  <g fill="#3f6f2f"><circle cx="58" cy="104" r="11"/><circle cx="70" cy="100" r="13"/><circle cx="82" cy="106" r="9"/><rect x="68" y="106" width="3" height="10" fill="#5a4630"/></g>
  <path d="M0 150 C80 124 150 134 220 142 S330 126 400 136 V220 H0Z" fill="url(#fs-h2)"/>
  <g stroke="#e9e2cf" stroke-width="2" stroke-linecap="round" opacity=".9">
    <path d="M0 160 L130 150"/><path d="M0 168 L130 158"/>
    <path d="M10 156 V174 M40 154 V172 M70 152 V170 M100 150 V168 M128 148 V166"/>
  </g>
  ${cowSil(170, 150, 1)}${cowSil(214, 146, -1, .9)}${cowSil(300, 140, 1, .75)}
  <path d="M0 184 C90 160 190 176 260 182 S350 170 400 176 V220 H0Z" fill="url(#fs-h3)"/>
  <rect width="400" height="220" fill="url(#fs-shade)"/>
</svg>`);
}

/** A small black-and-white cow standing in the field (dir 1 faces right, -1 faces left). */
function cowSil(x, y, dir = 1, s = 1) {
  return `<g transform="translate(${x} ${y}) scale(${dir * s} ${s})">
    <rect x="-14" y="-10" width="26" height="12" rx="5" fill="#fbfaf6"/>
    <path d="M-8 -10 q5 6 -2 10 h-4 v-10z" fill="#1d1d1b"/><circle cx="4" cy="-5" r="3.2" fill="#1d1d1b"/>
    <rect x="10" y="-14" width="9" height="8" rx="3" fill="#fbfaf6"/><path d="M15 -14 q4 2 4 6 h-3z" fill="#1d1d1b"/>
    <rect x="16" y="-9" width="4" height="3" rx="1.4" fill="#f2b6a8"/>
    <g fill="#1d1d1b"><rect x="-12" y="1" width="2.4" height="7"/><rect x="-6" y="1" width="2.4" height="7"/><rect x="3" y="1" width="2.4" height="7"/><rect x="8" y="1" width="2.4" height="7"/></g>
    <path d="M-14 -8 q-4 3 -3 9" stroke="#1d1d1b" stroke-width="1.4" fill="none"/>
  </g>`;
}

const COAT = {
  cow: { bg: '#e6efe2', body: '#fbfaf6', patch: '#1f1f1d', muzzle: '#f2b9ab', horn: false },
  heifer: { bg: '#f1e7da', body: '#fbf6ee', patch: '#8a4f2a', muzzle: '#f0b4a3', horn: false },
  calf: { bg: '#f5eedd', body: '#e9cfa6', patch: '#fbf6ee', muzzle: '#f1c1b0', horn: false },
  bull: { bg: '#e4e1db', body: '#4a3326', patch: '#2a1c14', muzzle: '#9a7b6c', horn: true },
  steer: { bg: '#ece5dc', body: '#a8724a', patch: '#fbf6ee', muzzle: '#e8b4a1', horn: false },
};

/** A friendly cow face for animals without a photo, coloured by type. */
export function cowArt(type = 'cow') {
  const c = COAT[type] || COAT.cow;
  return raw(`<svg class="cow-art" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
  <rect width="64" height="64" fill="${c.bg}"/>
  ${c.horn ? `<path d="M18 18 q-8 -6 -6 -12 q4 6 10 7z M46 18 q8 -6 6 -12 q-4 6 -10 7z" fill="#e8dcc0"/>` : ''}
  <ellipse cx="14" cy="24" rx="8" ry="4.5" transform="rotate(-20 14 24)" fill="${c.body}" stroke="rgba(0,0,0,.12)"/>
  <ellipse cx="50" cy="24" rx="8" ry="4.5" transform="rotate(20 50 24)" fill="${c.body}" stroke="rgba(0,0,0,.12)"/>
  <path d="M19 18 Q32 10 45 18 L46 40 Q32 48 18 40 Z" fill="${c.body}"/>
  <path d="M19 18 Q24 14 30 14 Q27 22 20 26 Z" fill="${c.patch}"/>
  <path d="M45 30 Q40 32 38 26 Q42 20 45.5 22 Z" fill="${c.patch}"/>
  <circle cx="26" cy="29" r="2.4" fill="#1b1b19"/><circle cx="38" cy="29" r="2.4" fill="#1b1b19"/>
  <circle cx="26.8" cy="28.2" r=".8" fill="#fff"/><circle cx="38.8" cy="28.2" r=".8" fill="#fff"/>
  <rect x="20" y="36" width="24" height="15" rx="7.5" fill="${c.muzzle}"/>
  <ellipse cx="27" cy="43" rx="2" ry="2.6" fill="rgba(0,0,0,.35)"/><ellipse cx="37" cy="43" rx="2" ry="2.6" fill="rgba(0,0,0,.35)"/>
  ${type === 'cow' || type === 'heifer' ? `<rect x="40" y="20" width="7" height="6" rx="1.5" fill="#f2c230" transform="rotate(14 43 23)"/>` : ''}
</svg>`);
}
