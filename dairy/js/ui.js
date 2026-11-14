// Tiny view toolkit: auto-escaping templates, sheets, toasts and a generic form.

import { toInputDateTime, fromInputDateTime, todayKey, addDays } from './time.js';
import { uid } from './db.js';

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(String(s));
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function fmt(v) {
  if (v == null || v === false || v === true) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(fmt).join('');
  return esc(v);
}
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s; if (i < vals.length) out += fmt(vals[i]); });
  return new Raw(out);
}

// ---------- toast ----------
let toastTimer;
export function toast(msg, { action, kind = 'ok', ms = 5000 } = {}) {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); document.body.append(el); }
  el.className = `toast show ${kind}`;
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button" class="toast-btn">${esc(action.label)}</button>` : ''}`;
  if (action) el.querySelector('button').onclick = () => { el.className = 'toast'; action.fn(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, ms);
}

// ---------- sheet (full-screen on phones) ----------
// Opening a sheet pushes one history entry so the phone's Back button closes it.
let current = null;
let popWaiters = [];
let ignorePop = 0;
window.addEventListener('popstate', () => {
  if (ignorePop) { ignorePop--; const w = popWaiters; popWaiters = []; w.forEach((f) => f()); return; }
  if (current) dropSheet();
});

export function openSheet(title, body, { onMount } = {}) {
  const reuse = !!current;
  if (current) current.remove();
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<section class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <header class="sheet-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Close">✕</button></header>
    <div class="sheet-body">${fmt(body)}</div></section>`;
  document.body.append(wrap);
  document.body.classList.add('sheet-open');
  wrap.querySelector('[data-close]').onclick = () => closeSheet();
  current = wrap;
  if (!reuse) history.pushState({ sheet: true }, '');
  onMount?.(wrap.querySelector('.sheet-body'));
  return wrap;
}

/** Close the sheet and step back over its history entry. Resolves once history has settled. */
export function closeSheet() {
  if (!current) return Promise.resolve();
  dropSheet();
  if (!history.state?.sheet) return Promise.resolve();
  return new Promise((res) => {
    ignorePop++;
    popWaiters.push(res);
    history.back();
    setTimeout(res, 400);
  });
}
export const sheetIsOpen = () => !!current;
export function dropSheet() { if (current) { current.remove(); current = null; document.body.classList.remove('sheet-open'); } }

// ---------- forms ----------

function opt(o) { return Array.isArray(o) ? o : [o, o]; }

function fieldHtml(f, v, tz) {
  const id = `f_${f.name}`;
  const req = f.required ? html` <span class="req">required</span>` : '';
  const help = f.help ? html`<p class="help">${f.help}</p>` : '';
  const show = f.showIf ? html` data-show-name="${f.showIf.name}" data-show-is="${JSON.stringify(f.showIf.is)}"` : '';
  const wrap = (inner, cls = '') => html`<div class="field ${cls}" data-field="${f.name}"${show}>${inner}</div>`;
  switch (f.type) {
    case 'heading':
      return html`<h3 class="form-heading"${show}>${f.label}</h3>`;
    case 'info':
      return html`<div class="form-info"${show}>${f.html || f.label}</div>`;
    case 'datetime': {
      const val = v ? toInputDateTime(v, tz) : '';
      const chips = f.quick ? html`<div class="chips" role="group" aria-label="Quick dates">
        <button type="button" class="chip" data-quick="0">Now</button>
        <button type="button" class="chip" data-quick="1">Yesterday</button>
        <button type="button" class="chip" data-quick="2">2 days ago</button>
        <button type="button" class="chip" data-quick="3">3 days ago</button></div>` : '';
      return wrap(html`<label for="${id}">${f.label}${req}</label>${chips}
        <input id="${id}" name="${f.name}" type="datetime-local" value="${val}" data-type="datetime" ${f.required ? raw('required') : ''}>${help}`);
    }
    case 'date':
      return wrap(html`<label for="${id}">${f.label}${req}</label>
        <input id="${id}" name="${f.name}" type="date" value="${v || ''}" data-type="date" ${f.required ? raw('required') : ''}>${help}`);
    case 'number':
      return wrap(html`<label for="${id}">${f.label}${req}</label>
        <input id="${id}" name="${f.name}" type="number" inputmode="decimal" step="${f.step || 'any'}" ${f.min != null ? raw(`min="${f.min}"`) : ''}
          value="${v ?? ''}" data-type="number" placeholder="${f.placeholder || ''}" ${f.required ? raw('required') : ''}>${help}`);
    case 'select':
      return wrap(html`<label for="${id}">${f.label}${req}</label>
        <select id="${id}" name="${f.name}" data-type="select">${(f.options || []).map((o) => {
          const [val, lab] = opt(o);
          return html`<option value="${val}" ${String(val) === String(v ?? '') ? raw('selected') : ''}>${lab}</option>`;
        })}</select>${help}`);
    case 'choice':
      return wrap(html`<fieldset class="choice"><legend>${f.label}${req}</legend><div class="seg">${(f.options || []).map((o) => {
        const [val, lab] = opt(o);
        return html`<label class="seg-opt"><input type="radio" name="${f.name}" value="${val}" data-type="choice" ${String(val) === String(v ?? '') ? raw('checked') : ''}><span>${lab}</span></label>`;
      })}</div></fieldset>${help}`);
    case 'multi':
      return wrap(html`<fieldset class="multi"><legend>${f.label}${req}</legend>${(f.options || []).length ? '' : html`<p class="help">Nothing to choose yet.</p>`}${(f.options || []).map((o) => {
        const [val, lab] = opt(o);
        return html`<label class="check"><input type="checkbox" name="${f.name}" value="${val}" data-type="multi" ${(v || []).includes(val) ? raw('checked') : ''}><span>${lab}</span></label>`;
      })}</fieldset>${help}`);
    case 'checkbox':
      return wrap(html`<label class="check"><input type="checkbox" name="${f.name}" data-type="checkbox" ${v ? raw('checked') : ''}><span>${f.label}</span></label>${help}`);
    case 'textarea':
      return wrap(html`<label for="${id}">${f.label}${req}</label><textarea id="${id}" name="${f.name}" rows="3" data-type="text">${v || ''}</textarea>${help}`);
    default:
      return wrap(html`<label for="${id}">${f.label}${req}</label>
        <input id="${id}" name="${f.name}" type="text" value="${v ?? ''}" data-type="text" autocomplete="off"
          ${f.inputmode ? raw(`inputmode="${f.inputmode}"`) : ''} ${f.list ? raw(`list="dl_${f.name}"`) : ''} placeholder="${f.placeholder || ''}">
        ${f.list ? html`<datalist id="dl_${f.name}">${f.list.map((x) => html`<option value="${x}">`)}</datalist>` : ''}${help}`);
  }
}

/**
 * opts: { title, header, fields, values, submitLabel, tz, recordId, onSubmit(values, recordId),
 *         onDelete(), deleteLabel, onMount(body, form) }
 * Fields with detail:true sit behind "Add details".
 * The recordId is fixed when the form opens, so a double tap writes the same record twice
 * (an idempotent overwrite) instead of creating a duplicate.
 */
export function openForm(opts) {
  const { fields, values = {}, tz } = opts;
  const recordId = opts.recordId || uid();
  const main = fields.filter((f) => !f.detail);
  const details = fields.filter((f) => f.detail);
  const detailsHaveValues = details.some((f) => {
    const v = values[f.name];
    return v != null && v !== '' && !(Array.isArray(v) && !v.length) && f.type !== 'heading';
  });
  const body = html`
    ${opts.header || ''}
    <form class="form" novalidate>
      <div class="form-error" role="alert" hidden></div>
      ${main.map((f) => fieldHtml(f, values[f.name], tz))}
      ${details.length ? html`<details class="more" ${detailsHaveValues ? raw('open') : ''}><summary>Add details <span class="muted">(optional)</span></summary>
        ${details.map((f) => fieldHtml(f, values[f.name], tz))}</details>` : ''}
      <div class="form-actions">
        <button type="submit" class="btn primary big">${opts.submitLabel || 'Save'}</button>
        ${opts.onDelete ? html`<button type="button" class="btn danger" data-delete>${opts.deleteLabel || 'Delete this record'}</button>` : ''}
      </div>
    </form>`;
  openSheet(opts.title, body, {
    onMount(el) {
      const form = el.querySelector('form');
      const errBox = form.querySelector('.form-error');
      const showErr = (m) => { errBox.textContent = m; errBox.hidden = !m; if (m) errBox.scrollIntoView({ block: 'center' }); };

      const applyShow = () => {
        for (const node of form.querySelectorAll('[data-show-name]')) {
          const name = node.dataset.showName;
          const allowed = JSON.parse(node.dataset.showIs);
          const v = readValue(form, name);
          node.hidden = !allowed.map(String).includes(String(v));
        }
      };
      form.addEventListener('change', applyShow);
      form.addEventListener('input', applyShow);
      applyShow();

      form.addEventListener('click', (e) => {
        const q = e.target.closest('[data-quick]');
        if (!q) return;
        const input = q.closest('.field').querySelector('input');
        const now = new Date();
        const daysBack = +q.dataset.quick;
        const time = toInputDateTime(now, tz).slice(11);
        input.value = `${addDays(todayKey(tz), -daysBack)}T${time}`;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });

      let saving = false;
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (saving) return;
        showErr('');
        const v = {};
        for (const f of fields) {
          if (!f.name || f.type === 'heading' || f.type === 'info') continue;
          const node = form.querySelector(`[data-field="${f.name}"]`);
          const hidden = node && (node.hidden || node.closest('[hidden]'));
          v[f.name] = hidden ? null : readField(form, f, tz);
          if (f.required && !hidden && (v[f.name] == null || v[f.name] === '' || (Array.isArray(v[f.name]) && !v[f.name].length))) {
            showErr(`${f.label} is required.`);
            return;
          }
        }
        saving = true;
        const btn = form.querySelector('[type=submit]');
        btn.disabled = true;
        btn.dataset.label = btn.textContent;
        btn.textContent = 'Saving…';
        try {
          const res = await opts.onSubmit(v, recordId);
          await closeSheet();
          const r = typeof res === 'object' && res ? res : { msg: res };
          if (r.go) location.hash = r.go;
          if (r.msg !== false) toast(typeof r.msg === 'string' ? r.msg : 'Saved', r.action ? { action: r.action } : {});
        } catch (err) {
          console.error(err);
          showErr(err.message || 'Could not save');
          saving = false;
          btn.disabled = false;
          btn.textContent = btn.dataset.label;
        }
      });

      form.querySelector('[data-delete]')?.addEventListener('click', async () => {
        if (!confirm(opts.deleteConfirm || 'Delete this record? This cannot be undone.')) return;
        try { const r = await opts.onDelete(); await closeSheet(); if (r?.go) location.hash = r.go; } catch (err) { showErr(err.message); }
      });
      opts.onMount?.(el, form);
    },
  });
}

function readValue(form, name) {
  const nodes = form.querySelectorAll(`[name="${name}"]`);
  if (!nodes.length) return null;
  const n = nodes[0];
  if (n.type === 'radio') return [...nodes].find((x) => x.checked)?.value ?? null;
  if (n.type === 'checkbox' && n.dataset.type === 'checkbox') return n.checked;
  return n.value;
}

function readField(form, f, tz) {
  const nodes = form.querySelectorAll(`[name="${f.name}"]`);
  if (!nodes.length) return null;
  switch (f.type) {
    case 'datetime': return nodes[0].value ? fromInputDateTime(nodes[0].value, tz) : null;
    case 'number': {
      const s = nodes[0].value.trim().replace(',', '.');
      return s === '' ? null : Number(s);
    }
    case 'checkbox': return nodes[0].checked;
    case 'multi': return [...nodes].filter((x) => x.checked).map((x) => x.value);
    case 'choice': return [...nodes].find((x) => x.checked)?.value ?? null;
    default: { const s = nodes[0].value.trim(); return s === '' ? null : s; }
  }
}

export function download(name, text, type = 'text/csv') {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
