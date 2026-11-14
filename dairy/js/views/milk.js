import { html, raw, openForm } from '../ui.js';
import { D, S, tz, periodRange, removeWithUndo } from '../store.js';
import * as db from '../db.js';
import {
  milkDay, milkTotals, milkHolds, MILK_SOURCES, collectionValue, statementExpected, animalLabel, isActive, isFemale,
} from '../logic.js';
import { fmtDay, fmtDow, todayKey, addDays } from '../time.js';
import { L, money, periodChips, empty, holdText } from '../components.js';

const SESSIONS = ['AM', 'Midday', 'PM', 'Other'];
const USES = { withheld: 'Withheld (treated cows)', discarded: 'Discarded', onfarm: 'On-farm use (calves, house)' };
const KIND = { session: 'Milking session total', daily: 'Daily herd total', cow: 'Cow yield', kept: 'Kept out of the tank' };
const RANK = { cows: 0, sessions: 1, daily: 1 };
const SRC_OF = { session: 'sessions', daily: 'daily', cow: 'cows' };

function holdsBox() {
  const holds = milkHolds(D());
  if (!holds.length) return '';
  return html`<div class="hold" role="alert" data-testid="milk-hold"><strong class="hold-title">WITHHOLD MILK</strong>
    ${holds.map(({ animal: a, hold }) => html`<a href="#/animal/${a.id}" class="hold-line"><strong>${animalLabel(a)}</strong> ${holdText(hold)}${hold.overlapping ? ` · ${hold.treatments.length} treatments` : ''}</a>`)}</div>`;
}

const cows = () => D().animals.filter((a) => isActive(a) && isFemale(a)).sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));

export function milkForm(existing, preset = {}) {
  const t = todayKey(tz());
  openForm({
    title: existing ? 'Edit milk entry' : 'Record milk', tz: tz(), recordId: existing?.id,
    header: holdsBox(),
    values: existing || { kind: 'session', date: t, session: new Date().getHours() < 12 ? 'AM' : 'PM', ...preset },
    fields: [
      { name: 'kind', label: 'What are you recording?', type: 'choice', required: true, options: Object.entries(KIND) },
      { name: 'date', label: 'Date', type: 'date', required: true },
      { name: 'session', label: 'Milking', type: 'choice', options: SESSIONS, showIf: { name: 'kind', is: ['session', 'cow'] } },
      { name: 'animalId', label: 'Cow', type: 'select', options: [['', '— choose —'], ...cows().map((a) => [a.id, animalLabel(a)])], showIf: { name: 'kind', is: ['cow', 'kept'] } },
      { name: 'use', label: 'Why kept out', type: 'choice', options: Object.entries(USES), showIf: { name: 'kind', is: ['kept'] } },
      { name: 'litres', label: 'Litres', type: 'number', required: true, min: 0 },
      { type: 'info', name: 'srcinfo', html: html`<p class="calc" data-src></p>` },
      { name: 'notes', label: 'Notes', type: 'textarea', detail: true },
    ],
    onMount(el, form) {
      const box = el.querySelector('[data-src]');
      const upd = () => {
        const date = form.querySelector('[name=date]').value;
        const kind = form.querySelector('[name=kind]:checked')?.value;
        if (!date) { box.textContent = ''; return; }
        const rec = db.get('milkDays', date);
        const src = rec?.source || (kind && SRC_OF[kind]) || S().defaultMilkSource;
        box.textContent = kind === 'kept'
          ? 'Recorded separately. It does not change litres produced.'
          : `Official total for ${fmtDay(date)} comes from: ${MILK_SOURCES[src]}. Other kinds of entry for that day are kept for reference and not added again.`;
      };
      form.addEventListener('change', upd); form.addEventListener('input', upd); upd();
    },
    async onSubmit(v, id) {
      if (v.date > t) throw new Error('The date is in the future.');
      if (v.litres < 0) throw new Error('Litres cannot be negative.');
      if ((v.kind === 'cow') && !v.animalId) throw new Error('Choose the cow.');
      if (v.kind === 'kept' && !v.use) throw new Error('Choose why the milk was kept out.');
      let recId = id;
      const others = D().milk.filter((m) => m.id !== id && m.date === v.date && m.kind === v.kind);
      if (v.kind === 'daily' && others.length) recId = others[0].id; // one daily total per day: update it
      if (v.kind === 'session' && others.some((m) => m.session === v.session)) throw new Error(`The ${v.session} milking on ${fmtDay(v.date)} is already recorded. Edit that entry instead.`);
      if (v.kind === 'cow' && others.some((m) => m.session === v.session && m.animalId === v.animalId)) throw new Error('That cow already has a yield for this milking.');
      const rec = { ...(existing || {}), ...v, id: recId };
      delete rec.srcinfo;
      if (!['session', 'cow'].includes(v.kind)) rec.session = null;
      if (!['cow', 'kept'].includes(v.kind)) rec.animalId = null;
      if (v.kind !== 'kept') rec.use = null;
      const ops = [{ store: 'milk', put: rec }];
      if (existing && recId !== id) ops.push({ store: 'milk', del: id });
      const day = db.get('milkDays', v.date);
      const src = SRC_OF[v.kind];
      let msg = `${L(v.litres)} saved`;
      if (src && (!day || (day.auto && RANK[src] > RANK[day.source]))) {
        ops.push({ store: 'milkDays', put: { id: v.date, source: src, auto: true } });
        if (day) msg += ` — official total now from ${MILK_SOURCES[src].toLowerCase()}`;
      }
      await db.write(ops);
      return msg;
    },
    onDelete: existing && (() => removeWithUndo('milk', existing, 'Milk entry deleted')),
  });
}

export function buyerForm(existing) {
  openForm({
    title: existing ? 'Edit buyer' : 'Add milk buyer', tz: tz(), recordId: existing?.id, values: existing || {},
    fields: [
      { name: 'name', label: 'Buyer name', required: true },
      { name: 'contact', label: 'Contact / account number', detail: true },
      { name: 'defaultPrice', label: 'Usual price per litre', type: 'number', detail: true, help: 'Pre-fills new collections.' },
      { name: 'notes', label: 'Notes', type: 'textarea', detail: true },
    ],
    async onSubmit(v, id) { await db.put('buyers', { ...(existing || {}), ...v, id }); return 'Buyer saved'; },
    onDelete: existing && (() => {
      if (D().collections.some((c) => c.buyerId === existing.id)) throw new Error('This buyer has collections. Delete those first.');
      return removeWithUndo('buyers', existing, 'Buyer deleted');
    }),
  });
}

const QFIELDS = [
  { name: 'tankTemp', label: 'Tank temperature (°C)', type: 'number', detail: true },
  { name: 'butterfat', label: 'Butterfat (%)', type: 'number', detail: true },
  { name: 'protein', label: 'Protein (%)', type: 'number', detail: true },
  { name: 'scc', label: 'Somatic cell count (×1000/ml)', type: 'number', detail: true },
  { name: 'bacteria', label: 'Bacterial count (×1000 cfu/ml)', type: 'number', detail: true },
];
const QKEYS = QFIELDS.map((f) => f.name);

export function collectionForm(existing) {
  const buyers = D().buyers;
  const q = existing ? D().quality.find((x) => x.collectionId === existing.id) : null;
  const last = D().collections.slice().sort((a, b) => b.date.localeCompare(a.date))[0];
  const defBuyer = existing?.buyerId || last?.buyerId || buyers[0]?.id || '';
  const defPrice = buyers.find((b) => b.id === defBuyer)?.defaultPrice ?? last?.pricePerLitre ?? null;
  openForm({
    title: existing ? 'Edit collection' : 'Milk collection', tz: tz(), recordId: existing?.id,
    header: html`<p class="lead">A collection is the sale: litres sold are counted from here only.</p>`,
    values: existing ? { ...existing, ...(q || {}), id: existing.id } : { date: todayKey(tz()), buyerId: defBuyer, pricePerLitre: defPrice },
    fields: [
      { name: 'date', label: 'Collection date', type: 'date', required: true },
      buyers.length ? { name: 'buyerId', label: 'Buyer', type: 'select', options: [...buyers.map((b) => [b.id, b.name]), ['__new', '+ New buyer']] } : { type: 'info', html: '' },
      { name: 'newBuyer', label: buyers.length ? 'New buyer name' : 'Buyer name', ...(buyers.length ? { showIf: { name: 'buyerId', is: ['__new'] } } : { required: true }) },
      { name: 'litresAccepted', label: 'Litres accepted', type: 'number', required: true, min: 0 },
      { name: 'litresRejected', label: 'Litres rejected', type: 'number', min: 0 },
      { name: 'reference', label: 'Collection / docket reference' },
      { name: 'pricePerLitre', label: `Price per litre (${S().currency}) if known`, type: 'number', min: 0 },
      { type: 'heading', label: 'Milk quality (optional)', detail: true },
      ...QFIELDS,
      { name: 'notes', label: 'Notes', type: 'textarea', detail: true },
    ],
    async onSubmit(v, id) {
      if (v.date > todayKey(tz())) throw new Error('The date is in the future.');
      const ops = [];
      let buyerId = v.buyerId;
      if (!buyers.length || buyerId === '__new') {
        if (!v.newBuyer) throw new Error('Enter the buyer name.');
        buyerId = `${id}-buyer`;
        ops.push({ store: 'buyers', put: { id: buyerId, name: v.newBuyer, defaultPrice: v.pricePerLitre } });
      }
      const rec = { ...(existing || {}), id, date: v.date, buyerId, litresAccepted: v.litresAccepted, litresRejected: v.litresRejected, reference: v.reference, pricePerLitre: v.pricePerLitre, notes: v.notes };
      ops.push({ store: 'collections', put: rec });
      const hasQ = QKEYS.some((k) => v[k] != null);
      if (hasQ) ops.push({ store: 'quality', put: { ...(q || {}), id: q?.id || `${id}-q`, date: v.date, collectionId: id, sampleType: 'collection', ...Object.fromEntries(QKEYS.map((k) => [k, v[k]])) } });
      else if (q) ops.push({ store: 'quality', del: q.id });
      await db.write(ops);
      return `Collection saved: ${L(v.litresAccepted)} accepted`;
    },
    onDelete: existing && (() => removeWithUndo('collections', existing, 'Collection deleted', q ? [{ store: 'quality', del: q.id }] : [], q ? [{ store: 'quality', put: q }] : [])),
  });
}

export function statementForm(existing) {
  const buyers = D().buyers;
  if (!buyers.length) { buyerForm(); return; }
  const t = todayKey(tz());
  const prevEnd = addDays(`${t.slice(0, 8)}01`, -1);
  const prevStart = `${prevEnd.slice(0, 8)}01`;
  openForm({
    title: existing ? 'Edit statement / payment' : 'Buyer statement & payment', tz: tz(), recordId: existing?.id,
    header: html`<p class="lead">Covers the buyer's collections between the two dates. Litres are not counted again.</p>`,
    values: existing || { buyerId: buyers[0].id, from: prevStart, to: prevEnd },
    fields: [
      { name: 'buyerId', label: 'Buyer', type: 'select', options: buyers.map((b) => [b.id, b.name]) },
      { name: 'from', label: 'Period from', type: 'date', required: true },
      { name: 'to', label: 'Period to', type: 'date', required: true },
      { name: 'bonuses', label: 'Bonuses (quality, volume…)', type: 'number', min: 0 },
      { name: 'deductions', label: 'Deductions (levies, haulage, penalties…)', type: 'number', min: 0 },
      { type: 'info', name: 'exp', html: html`<p class="calc" data-exp></p>` },
      { name: 'statementAmount', label: "Buyer's final statement amount", type: 'number' },
      { name: 'paymentDate', label: 'Payment received on', type: 'date' },
      { name: 'paidAmount', label: 'Amount received', type: 'number', help: 'Leave empty if not paid yet.' },
      { name: 'reference', label: 'Statement reference', detail: true },
      { name: 'bonusNote', label: 'Bonus details', detail: true },
      { name: 'deductionNote', label: 'Deduction details', detail: true },
      { name: 'notes', label: 'Notes', type: 'textarea', detail: true },
    ],
    onMount(el, form) {
      const box = el.querySelector('[data-exp]');
      const val = (n) => form.querySelector(`[name=${n}]`).value;
      const upd = () => {
        const st = { buyerId: val('buyerId'), from: val('from'), to: val('to'), bonuses: +val('bonuses') || 0, deductions: +val('deductions') || 0 };
        if (!st.from || !st.to) { box.textContent = ''; return; }
        const e = statementExpected(D(), st);
        const litres = e.collections.reduce((s, c) => s + (+c.litresAccepted || 0), 0);
        box.textContent = `${e.collections.length} collections, ${L(litres)}. Expected ${money(e.value)}${e.unpriced ? ` (${e.unpriced} without a price)` : ''}.`;
      };
      form.addEventListener('input', upd); form.addEventListener('change', upd); upd();
      const paid = form.querySelector('[name=paidAmount]');
      form.querySelector('[name=paymentDate]').addEventListener('change', () => { if (!paid.value) paid.value = val('statementAmount'); });
    },
    async onSubmit(v, id) {
      if (v.to < v.from) throw new Error('The period ends before it starts.');
      if (v.paidAmount != null && !v.paymentDate) throw new Error('Enter the payment date.');
      const rec = { ...(existing || {}), ...v, id };
      delete rec.exp;
      await db.put('statements', rec);
      return 'Statement saved';
    },
    onDelete: existing && (() => removeWithUndo('statements', existing, 'Statement deleted')),
  });
}

export function qualityForm(existing) {
  const cols = D().collections.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
  openForm({
    title: existing ? 'Edit milk quality' : 'Milk quality reading', tz: tz(), recordId: existing?.id,
    values: existing || { date: todayKey(tz()), sampleType: 'tank' },
    fields: [
      { name: 'date', label: 'Sample date', type: 'date', required: true },
      { name: 'sampleType', label: 'Sample from', type: 'choice', options: [['tank', 'Bulk tank'], ['collection', 'A collection']] },
      { name: 'collectionId', label: 'Collection', type: 'select', options: [['', '—'], ...cols.map((c) => [c.id, `${fmtDay(c.date)} · ${L(c.litresAccepted)}${c.reference ? ` · ${c.reference}` : ''}`])], showIf: { name: 'sampleType', is: ['collection'] } },
      ...QFIELDS.map((f) => ({ ...f, detail: false })),
    ],
    async onSubmit(v, id) {
      if (!QKEYS.some((k) => v[k] != null)) throw new Error('Enter at least one reading.');
      await db.put('quality', { ...(existing || {}), ...v, id });
      return 'Reading saved';
    },
    onDelete: existing && (() => removeWithUndo('quality', existing, 'Reading deleted')),
  });
}

function spark(values) {
  const w = 280; const h = 56; const p = 4;
  const min = Math.min(...values); const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(p + (i * (w - 2 * p)) / (values.length - 1)).toFixed(1)},${(h - p - ((v - min) * (h - 2 * p)) / span).toFixed(1)}`);
  return raw(`<svg class="spark" viewBox="0 0 ${w} ${h}" role="img" aria-label="Trend from ${values[0]} to ${values[values.length - 1]}"><polyline fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round" points="${pts.join(' ')}"/>${pts.map((pt) => `<circle cx="${pt.split(',')[0]}" cy="${pt.split(',')[1]}" r="2.5" fill="currentColor"/>`).join('')}</svg>`);
}

const TABS = [['production', 'Production'], ['sales', 'Sales & payments'], ['quality', 'Quality']];

export function milkView(tab = 'production') {
  const r = periodRange();
  const m = milkTotals(D(), r.from, r.to);
  let body;
  if (tab === 'production') {
    const days = [...new Set(D().milk.filter((x) => x.date >= r.from && x.date <= r.to).map((x) => x.date))].sort().reverse();
    body = html`
      <div class="grid-actions">
        <button type="button" class="btn primary" data-act="add" data-kind="session">Milking session</button>
        <button type="button" class="btn" data-act="add" data-kind="daily">Daily herd total</button>
        <button type="button" class="btn" data-act="add" data-kind="cow">Cow yield</button>
        <button type="button" class="btn" data-act="add" data-kind="kept">Kept out of tank</button>
      </div>
      ${periodChips()}
      <dl class="totals"><div><dt>Litres produced</dt><dd data-testid="p-produced">${L(m.produced)}</dd></div>
        <div><dt>Withheld</dt><dd>${L(m.kept.withheld)}</dd></div><div><dt>Discarded</dt><dd>${L(m.kept.discarded)}</dd></div><div><dt>On-farm use</dt><dd>${L(m.kept.onfarm)}</dd></div></dl>
      <p class="muted small">Each day's produced total comes from one source only — choose it per day below. Kept-out milk is recorded separately.</p>
      ${days.length ? days.map((d) => {
        const md = milkDay(D(), d);
        const others = Object.keys(md.has).filter((k) => md.has[k] && k !== md.source);
        return html`<section class="card day">
          <div class="day-head"><h3 class="h3">${fmtDow(d)}</h3><strong class="day-total">${L(md.official)}</strong></div>
          <label class="small">Official total from <select data-day="${d}">${Object.entries(MILK_SOURCES).map(([k, l]) => html`<option value="${k}" ${md.source === k ? 'selected' : ''}>${l}${md.has[k] ? ` (${L(md.bySource[k])})` : ''}</option>`)}</select></label>
          ${others.length ? html`<p class="muted small">Not counted (reference only): ${others.map((k) => `${MILK_SOURCES[k]} ${L(md.bySource[k])}`).join(', ')}</p>` : ''}
          <ul class="plain entries">${md.entries.map((e) => html`<li><button type="button" class="link-row" data-act="edit" data-id="${e.id}">
            ${e.kind === 'session' ? `${e.session} milking` : e.kind === 'daily' ? 'Daily total' : e.kind === 'cow' ? `${animalLabel(db.get('animals', e.animalId))} ${e.session || ''}` : USES[e.use]}${e.kind === 'kept' && e.animalId ? ` · ${animalLabel(db.get('animals', e.animalId))}` : ''}
            — ${L(e.litres)}${e.sample ? ' (sample)' : ''}</button></li>`)}</ul></section>`;
      }) : empty('No milk recorded in this period.')}`;
  } else if (tab === 'sales') {
    const cols = D().collections.filter((c) => c.date >= r.from && c.date <= r.to).sort((a, b) => b.date.localeCompare(a.date));
    const sts = D().statements.slice().sort((a, b) => b.to.localeCompare(a.to));
    const bname = (id) => db.get('buyers', id)?.name || 'Unknown buyer';
    body = html`
      <div class="grid-actions">
        <button type="button" class="btn primary" data-act="collection">Milk collection</button>
        <button type="button" class="btn" data-act="statement">Statement / payment</button>
        <button type="button" class="btn" data-act="buyer">Add buyer</button>
      </div>
      ${periodChips()}
      <dl class="totals"><div><dt>Litres produced</dt><dd>${L(m.produced)}</dd></div><div><dt>Litres sold</dt><dd data-testid="s-sold">${L(m.sold)}</dd></div>
        <div><dt>Expected amount</dt><dd>${money(m.expected)}</dd></div><div><dt>Buyer statements</dt><dd>${money(m.statements)}</dd></div>
        <div><dt>Payments received</dt><dd>${money(m.received)}</dd></div><div><dt>Litres rejected</dt><dd>${L(m.rejected)}</dd></div></dl>
      ${m.unpriced ? html`<p class="muted small">${m.unpriced} collection(s) have no price, so they are not in the expected amount.</p>` : ''}
      <h2 class="h2">Collections</h2>
      ${cols.length ? cols.map((c) => {
        const v = collectionValue(c);
        return html`<button type="button" class="card link-card" data-act="editCol" data-id="${c.id}"><strong>${fmtDay(c.date)}</strong> · ${bname(c.buyerId)}${c.sample ? ' (sample)' : ''}<br>
          ${L(c.litresAccepted)} accepted${c.litresRejected ? `, ${L(c.litresRejected)} rejected` : ''}${c.reference ? ` · ref ${c.reference}` : ''} · ${v == null ? 'price not known' : `${money(c.pricePerLitre)}/L = ${money(v)}`}</button>`;
      }) : empty('No collections in this period.')}
      <h2 class="h2">Statements & payments</h2>
      ${sts.length ? sts.map((st) => {
        const e = statementExpected(D(), st);
        const diff = st.statementAmount != null ? st.statementAmount - e.value : null;
        return html`<button type="button" class="card link-card" data-act="editSt" data-id="${st.id}"><strong>${bname(st.buyerId)}</strong> · ${fmtDay(st.from)} – ${fmtDay(st.to)}<br>
          Expected ${money(e.value)} · Statement ${st.statementAmount != null ? money(st.statementAmount) : '—'}${diff ? ` (${diff > 0 ? '+' : ''}${money(diff)})` : ''}<br>
          ${st.paymentDate ? html`<span class="badge good">Paid ${money(st.paidAmount)} on ${fmtDay(st.paymentDate)}</span>` : html`<span class="badge warn">Not paid yet</span>`}</button>`;
      }) : empty('No statements yet.')}
      <h2 class="h2">Buyers</h2>
      ${D().buyers.length ? D().buyers.map((b) => html`<button type="button" class="card link-card" data-act="editBuyer" data-id="${b.id}">${b.name}${b.defaultPrice ? ` · usual ${money(b.defaultPrice)}/L` : ''}</button>`) : empty('No buyers yet.')}`;
  } else {
    const qs = D().quality.slice().sort((a, b) => a.date.localeCompare(b.date));
    const metrics = [['tankTemp', 'Tank temperature', '°C'], ['butterfat', 'Butterfat', '%'], ['protein', 'Protein', '%'], ['scc', 'Somatic cell count', 'k/ml'], ['bacteria', 'Bacterial count', 'k cfu/ml']];
    body = html`<button type="button" class="btn primary" data-act="quality">+ Quality reading</button>
      ${metrics.map(([k, l, u]) => {
        const vals = qs.filter((x) => x[k] != null);
        if (!vals.length) return '';
        const last = vals[vals.length - 1];
        return html`<section class="card"><h3 class="h3">${l}: ${last[k]} ${u}</h3><p class="muted small">Latest ${fmtDay(last.date)} · ${vals.length} reading${vals.length > 1 ? 's' : ''}</p>
          ${vals.length >= 3 ? spark(vals.slice(-20).map((x) => +x[k])) : html`<p class="muted small">Trend shows after 3 readings.</p>`}</section>`;
      })}
      ${qs.length ? html`<h2 class="h2">All readings</h2>${qs.slice().reverse().map((x) => html`<button type="button" class="card link-card" data-act="editQ" data-id="${x.id}">${fmtDay(x.date)} · ${x.sampleType === 'collection' ? 'collection' : 'bulk tank'}<br>
        ${metrics.filter(([k]) => x[k] != null).map(([k, l, u]) => `${l} ${x[k]} ${u}`).join(' · ')}</button>`)}` : empty('No quality readings yet.')}`;
  }
  return {
    html: html`<header class="top"><h1>Milk</h1></header>
      ${holdsBox()}
      <nav class="tabs" aria-label="Milk sections">${TABS.map(([k, l]) => html`<a class="tab ${tab === k ? 'on' : ''}" href="#/milk/${k}" ${tab === k ? html`aria-current="page"` : ''}>${l}</a>`)}</nav>
      ${body}`,
    actions: {
      add: (d) => milkForm(null, { kind: d.kind }),
      edit: (d) => milkForm(db.get('milk', d.id)),
      collection: () => collectionForm(), statement: () => statementForm(), buyer: () => buyerForm(), quality: () => qualityForm(),
      editCol: (d) => collectionForm(db.get('collections', d.id)),
      editSt: (d) => statementForm(db.get('statements', d.id)),
      editBuyer: (d) => buyerForm(db.get('buyers', d.id)),
      editQ: (d) => qualityForm(db.get('quality', d.id)),
    },
    mount(el) {
      for (const sel of el.querySelectorAll('select[data-day]')) {
        sel.addEventListener('change', () => db.put('milkDays', { id: sel.dataset.day, source: sel.value, auto: false }));
      }
    },
  };
}
