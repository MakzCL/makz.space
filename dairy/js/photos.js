// Animal photos: a small square thumbnail (360 px JPEG, ~25 KB) made on the
// phone, stored in the `photos` store keyed by animal id, synced like any record.
import * as db from './db.js';
import { html, openSheet, closeSheet, toast } from './ui.js';
import { t } from './i18n.js';
import { icon } from './icons.js';
import { animalLabel } from './logic.js';

const SIZE = 360;

export const photoOf = (animalId) => db.get('photos', animalId)?.data || null;

/** Thumbnail image or a placeholder, for rows and headers. */
export function thumb(a, cls = 'thumb') {
  const src = photoOf(a.id);
  return src
    ? html`<img class="${cls}" src="${src}" alt="${t('Photo of {code}', { code: animalLabel(a) })}" loading="lazy" decoding="async">`
    : html`<span class="${cls} thumb-empty" aria-hidden="true">${icon('tag')}</span>`;
}

async function loadImage(file) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* fall back */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

/** Centre-crop to a square and shrink. */
export async function makeThumb(file) {
  const img = await loadImage(file);
  const w = img.width; const h = img.height;
  const side = Math.min(w, h);
  const canvas = document.createElement('canvas');
  canvas.width = SIZE; canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, SIZE, SIZE);
  return canvas.toDataURL('image/jpeg', 0.78);
}

function pick(capture) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (capture) input.setAttribute('capture', 'environment');
    input.style.display = 'none';
    input.onchange = () => { resolve(input.files[0] || null); input.remove(); };
    document.body.append(input);
    input.click();
  });
}

export async function choosePhoto(a, capture) {
  const file = await pick(capture);
  if (!file) return;
  try {
    const data = await makeThumb(file);
    await db.put('photos', { id: a.id, animalId: a.id, data, sample: a.sample || undefined });
    navigator.vibrate?.(12);
    toast(t('Photo saved'));
  } catch (err) {
    toast(t('Could not read that picture: {m}', { m: err.message }), { kind: 'err' });
  }
}

/** Sheet with the big photo and take / choose / remove. */
export function photoSheet(a) {
  const src = photoOf(a.id);
  openSheet(t('Photo of {code}', { code: animalLabel(a) }), html`
    <div class="photo-view">${src ? html`<img src="${src}" alt="${t('Photo of {code}', { code: animalLabel(a) })}">` : html`<div class="photo-none">${icon('tag')}<p>${t('No photo yet')}</p></div>`}</div>
    <div class="photo-actions">
      <button type="button" class="btn primary big" data-photo="camera" data-testid="photo-camera">${icon('plus')}${t('Take photo')}</button>
      <button type="button" class="btn big" data-photo="gallery" data-testid="photo-gallery">${t('Choose from gallery')}</button>
      ${src ? html`<button type="button" class="btn danger big" data-photo="remove">${t('Remove photo')}</button>` : ''}
    </div>`, {
    onMount(el) {
      for (const b of el.querySelectorAll('[data-photo]')) {
        b.onclick = async () => {
          const what = b.dataset.photo;
          if (what === 'remove') {
            if (!confirm(t('Remove this photo?'))) return;
            await db.del('photos', a.id);
            await closeSheet();
            toast(t('Photo removed'));
            return;
          }
          await closeSheet();
          await choosePhoto(a, what === 'camera');
        };
      }
    },
  });
}
