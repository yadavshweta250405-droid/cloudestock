// Minimal DOM helpers. Text is always inserted as text nodes (never innerHTML) so data from the API cannot inject markup.
const SVG_NS = 'http://www.w3.org/2000/svg';
const ICONS = {
  plus: 'M12 5v14M5 12h14', minus: 'M5 12h14', x: 'M18 6L6 18M6 6l12 12', check: 'M20 6L9 17l-5-5', chevron: 'M9 18l6-6-6-6', arrow: 'M5 12h14M12 5l7 7-7 7',
  search: 'M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z', bell: 'M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0',
  logout: 'M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9', refresh: 'M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15',
  box: 'M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16zM3.27 6.96L12 12.01l8.73-5.05M12 22.08V12',
  truck: 'M1 3h15v13H1zM16 8h4l3 3v5h-7V8zM5.5 21a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM18.5 21a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
  users: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75',
  user: 'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z', home: 'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2zM9 22V12h6v10',
  chart: 'M18 20V10M12 20V4M6 20v-6', list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01', clipboard: 'M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2M9 2h6v4H9z',
  layers: 'M12 2L2 7l10 5 10-5zM2 17l10 5 10-5M2 12l10 5 10-5', clock: 'M12 22a10 10 0 100-20 10 10 0 000 20zM12 6v6l4 2',
  alert: 'M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01',
  tool: 'M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z',
  rotate: 'M23 4v6h-6M20.49 15a9 9 0 11-2.12-9.36L23 10', eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 100-6 3 3 0 000 6z',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z', compass: 'M12 22a10 10 0 100-20 10 10 0 000 20zM16.24 7.76l-2.12 6.36-6.36 2.12 2.12-6.36z',
  trash: 'M3 6h18M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2', edit: 'M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5z',
  activity: 'M22 12h-4l-3 9L9 3l-3 9H2', percent: 'M19 5L5 19M6.5 9a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM17.5 20a2.5 2.5 0 100-5 2.5 2.5 0 000 5z', lock: 'M5 11h14v10H5zM8 11V7a4 4 0 018 0v4',
  building: 'M3 21h18M5 21V7l8-4v18M19 21V11l-6-4M9 9v.01M9 12v.01M9 15v.01', sun: 'M12 17a5 5 0 100-10 5 5 0 000 10zM12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42',
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z',
  cart: 'M9 20a2 2 0 100-4 2 2 0 000 4zm7 0a2 2 0 100-4 2 2 0 000 4zm-7-3h7a2 2 0 002-1.6l1.4-7.4H5.2M3 3h2l2 10',
  'rotate-ccw': 'M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8M3 3v5h5',
};
export function icon(name, cls = '') {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', `i ${cls}`.trim()); s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVG_NS, 'path'); p.setAttribute('d', ICONS[name] || ICONS.box); s.appendChild(p);
  return s;
}

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') el[k] = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}
export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export const mount = (el, ...children) => append(clear(el), children);

// ---------- formatting ----------
export const currencyState = { code: 'USD', symbol: '$', rate: 1.0 };

export const fmt = {
  n: (v) => (v === null || v === undefined ? '–' : Number(v).toLocaleString()),
  money: (v) => {
    if (v === null || v === undefined) return '–';
    const converted = Number(v) * (currencyState.rate || 1.0);
    try {
      return converted.toLocaleString(undefined, { style: 'currency', currency: currencyState.code || 'USD', maximumFractionDigits: 2 });
    } catch {
      return `${currencyState.symbol || '$'}${converted.toFixed(2)}`;
    }
  },
  pct: (v, d = 0) => (v === null || v === undefined ? '–' : `${(v * 100).toFixed(d)}%`),
  label: (s) => String(s ?? '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()),
  dt: (iso) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–'),
  date: (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '–'),
  ago(iso) {
    if (!iso) return 'never';
    const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
    if (s < 45) return 'just now'; if (s < 3600) return `${Math.round(s / 60)} min ago`; if (s < 86400) return `${Math.round(s / 3600)} h ago`; return `${Math.round(s / 86400)} d ago`;
  },
};
const BADGE = {
  Pending: 'amber', Processing: 'blue', Packed: 'teal', 'Ready for Dispatch': 'blue', Dispatched: 'blue', Delivered: 'green', Cancelled: 'red',
  Loading: 'amber', 'In Transit': 'blue', ok: 'green', low: 'amber', out: 'red', available: 'green', busy: 'blue', on_break: 'amber', off_duty: '', loading: 'amber', on_route: 'blue', returning: 'teal',
  maintenance: 'red', pending: 'amber', in_progress: 'blue', done: 'green', cancelled: 'red', Scheduled: 'amber', Arrived: 'blue', Unloading: 'blue', Received: 'green', free: 'green', occupied: 'blue', on_duty: 'blue',
  urgent: 'red', high: 'amber', normal: '', low_priority: '', full: 'red', near_full: 'amber', empty: '', info: 'blue', success: 'green', warning: 'amber', danger: 'red',
};
export const badge = (text, kind) => h('span', { class: `badge ${kind ?? BADGE[text] ?? ''}` }, fmt.label(text));

// ---------- toasts ----------
let toastBox;
export function toast(title, message = '', type = 'info', ms = 4200) {
  if (!toastBox) { toastBox = h('div', { class: 'toasts', 'aria-live': 'polite' }); document.body.appendChild(toastBox); }
  const t = h('div', { class: `toast ${type}`, role: 'status' }, h('b', null, title), message && h('span', null, message));
  toastBox.appendChild(t);
  setTimeout(() => t.remove(), ms);
}
export const toastError = (e) => toast('Something went wrong', e?.message || String(e), 'error', 6000);

// ---------- modal ----------
export function modal({ title, body, actions = [], wide = false, onClose }) {
  const overlay = h('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const bodyEl = h('div', { class: 'body' }, body);
  const footer = h('footer', null);
  const api = { close, el: overlay, bodyEl, footer, setBody(...c) { mount(bodyEl, ...c); }, setActions(list) { mount(footer, list.map((a) => a instanceof Node ? a : h('button', { class: `btn ${a.kind || ''}`, onClick: () => a.onClick?.(api) }, a.label))); } };
  api.setActions(actions);
  overlay.appendChild(h('div', { class: `modal ${wide ? 'wide' : ''}` }, h('header', null, h('h2', null, title), h('button', { class: 'icon-btn', 'aria-label': 'Close', onClick: close }, icon('x'))), bodyEl, footer));
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  return api;
}
export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let done = false; const fin = (v) => { if (!done) { done = true; resolve(v); } };
    modal({ title, body: h('p', null, message), onClose: () => fin(false), actions: [{ label: 'Cancel', onClick: (m) => { fin(false); m.close(); } }, { label: confirmLabel, kind: danger ? 'danger' : 'primary', onClick: (m) => { fin(true); m.close(); } }] });
  });
}

/**
 * Declarative form in a modal. fields: [{ name, label, type, options, required, help, min, max, step, placeholder, value, nullEmpty }]
 * onSubmit(values) may throw an ApiError; its 422 details are shown next to the matching fields.
 */
export function formModal({ title, fields, initial = {}, submitLabel = 'Save', onSubmit, wide = false, extra }) {
  const inputs = {}; const wraps = {}; const errs = {};
  const formErr = h('div', { class: 'form-error hidden' });
  const build = (f) => {
    const val = initial[f.name] ?? f.value;
    let input;
    if (f.type === 'select') input = h('select', { id: `f_${f.name}` }, (f.options || []).map((o) => h('option', { value: o.value, selected: String(o.value) === String(val ?? '') }, o.label)));
    else if (f.type === 'textarea') input = h('textarea', { id: `f_${f.name}`, rows: 3, placeholder: f.placeholder }, val ?? '');
    else if (f.type === 'checkbox') input = h('input', { id: `f_${f.name}`, type: 'checkbox', checked: !!val });
    else input = h('input', { id: `f_${f.name}`, type: f.type || 'text', value: val ?? '', placeholder: f.placeholder, min: f.min, max: f.max, step: f.step, autocomplete: f.type === 'password' ? 'new-password' : 'off', maxlength: f.maxLength });
    if (f.readonly) input.disabled = true;
    inputs[f.name] = input;
    errs[f.name] = h('div', { class: 'err hidden' });
    const wrap = h('div', { class: `field ${f.type === 'checkbox' ? 'check' : ''}` },
      f.type === 'checkbox' ? [input, h('label', { for: `f_${f.name}` }, f.label)] : [h('label', { for: `f_${f.name}` }, f.label, f.required ? ' *' : ''), input],
      f.help && h('div', { class: 'help' }, f.help), errs[f.name]);
    wraps[f.name] = wrap;
    return wrap;
  };
  const collect = () => {
    const out = {};
    for (const f of fields) {
      const el = inputs[f.name];
      if (f.type === 'checkbox') { out[f.name] = el.checked; continue; }
      let v = el.value;
      if (v === '' || v === null) { if (f.nullEmpty) out[f.name] = null; continue; }
      if (f.type === 'number' || f.numeric) v = Number(v);
      out[f.name] = v;
    }
    return out;
  };
  const showErrors = (details, message) => {
    Object.keys(wraps).forEach((k) => { wraps[k].classList.remove('invalid'); errs[k].classList.add('hidden'); });
    let general = true;
    for (const [k, msg] of Object.entries(details || {})) if (wraps[k]) { wraps[k].classList.add('invalid'); errs[k].textContent = `${fmt.label(k)} ${msg}`; errs[k].classList.remove('hidden'); general = false; }
    formErr.classList.toggle('hidden', !(message && general)); formErr.textContent = message || '';
  };
  // lay fields out in rows; consecutive `half` fields are paired two per row
  const rows = [];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    if (f.half && fields[i + 1]?.half) { rows.push(h('div', { class: 'row2' }, build(f), build(fields[i + 1]))); i++; }
    else rows.push(build(f));
  }
  const body = h('div', null, formErr, rows, extra);
  const m = modal({ title, body, wide, actions: [] });
  const submit = async () => {
    const btn = m.footer.querySelector('.primary'); btn.disabled = true; showErrors({}, '');
    try { await onSubmit(collect(), m); } catch (e) { showErrors(e.details, e.message); } finally { btn.disabled = false; }
  };
  m.setActions([{ label: 'Cancel', onClick: () => m.close() }, { label: submitLabel, kind: 'primary', onClick: submit }]);
  m.bodyEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); submit(); } });
  setTimeout(() => m.bodyEl.querySelector('input:not([disabled]),select,textarea')?.focus(), 30);
  return m;
}

// ---------- tables / states ----------
export function table({ columns, rows, empty = 'Nothing here yet', onRow, rowKey }) {
  if (!rows?.length) return h('div', { class: 'card empty' }, h('b', null, empty.title || empty), empty.hint || '');
  return h('div', { class: 'table-wrap' }, h('table', null,
    h('thead', null, h('tr', null, columns.map((c) => h('th', { class: c.num ? 'num' : '' }, c.label)))),
    h('tbody', null, rows.map((r) => h('tr', { class: onRow ? 'click' : '', 'data-key': rowKey?.(r), onClick: onRow ? () => onRow(r) : null },
      columns.map((c) => h('td', { class: `${c.num ? 'num' : ''} ${c.actions ? 'actions' : ''} ${c.mono ? 'mono' : ''}`, onClick: c.actions ? (e) => e.stopPropagation() : null }, c.render ? c.render(r) : r[c.key])))))));
}
export const spinner = () => h('div', { class: 'spinner', role: 'progressbar', 'aria-label': 'Loading' });
export const bar = (ratio, kind) => h('div', { class: `bar ${kind || (ratio >= 0.97 ? 'bad' : ratio >= 0.85 ? 'warn' : '')}` }, h('i', { style: { width: `${Math.min(100, Math.max(0, ratio * 100))}%` } }));
export const dl = (pairs) => h('dl', { class: 'dl' }, pairs.filter(Boolean).flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)]));
export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
