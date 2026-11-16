// Dependency-free SVG charts.
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, text) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text !== undefined) e.textContent = text; return e; };
const nice = (max) => { if (max <= 0) return 1; const p = 10 ** Math.floor(Math.log10(max)); const m = max / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; };
const short = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k` : `${n}`);
export const PALETTE = ['#2f5bd6', '#0d9488', '#f59e0b', '#ec4899', '#10b981', '#8b5cf6', '#ef4444', '#64748b'];

function frame(w, h) { return el('svg', { viewBox: `0 0 ${w} ${h}`, role: 'img', preserveAspectRatio: 'xMidYMid meet' }); }
function grid(svg, W, H, pad, max, ticks = 4) {
  for (let i = 0; i <= ticks; i++) {
    const y = pad.t + ((H - pad.t - pad.b) * i) / ticks;
    svg.appendChild(el('line', { x1: pad.l, x2: W - pad.r, y1: y, y2: y, stroke: '#e6ecf8' }));
    svg.appendChild(el('text', { x: pad.l - 8, y: y + 4, 'text-anchor': 'end', 'font-size': 10, fill: '#7b8aa8' }, short(Math.round(max * (1 - i / ticks)))));
  }
}
const xlabels = (svg, labels, xs, H, pad, every) => labels.forEach((l, i) => { if (i % every === 0 || i === labels.length - 1) svg.appendChild(el('text', { x: xs[i], y: H - pad.b + 16, 'text-anchor': 'middle', 'font-size': 10, fill: '#7b8aa8' }, l.slice(5))); });

export function lineChart({ labels, series, height = 220, area = true, min0 = false }) {
  const W = 560; const pad = { l: 44, r: 12, t: 10, b: 26 };
  const all = series.flatMap((s) => s.values); const lo = min0 ? 0 : Math.min(...all); const hi = Math.max(...all, 1);
  const span = Math.max(hi - lo, 1); const top = lo + nice(span); const max = min0 ? nice(hi) : top; const base = min0 ? 0 : lo - span * 0.05;
  const svg = frame(W, height); grid(svg, W, height, pad, max - base + base, 4);
  const xs = labels.map((_, i) => pad.l + ((W - pad.l - pad.r) * i) / Math.max(1, labels.length - 1));
  const y = (v) => pad.t + (height - pad.t - pad.b) * (1 - (v - base) / Math.max(1, max - base));
  series.forEach((s) => {
    const pts = s.values.map((v, i) => `${xs[i]},${y(v)}`);
    if (area) svg.appendChild(el('polygon', { points: `${xs[0]},${height - pad.b} ${pts.join(' ')} ${xs.at(-1)},${height - pad.b}`, fill: s.color, opacity: 0.1 }));
    svg.appendChild(el('polyline', { points: pts.join(' '), fill: 'none', stroke: s.color, 'stroke-width': 2.4, 'stroke-linejoin': 'round' }));
    s.values.forEach((v, i) => { const c = el('circle', { cx: xs[i], cy: y(v), r: 3, fill: '#fff', stroke: s.color, 'stroke-width': 2 }); c.appendChild(el('title', {}, `${s.name}: ${v.toLocaleString()} (${labels[i]})`)); svg.appendChild(c); });
  });
  xlabels(svg, labels, xs, height, pad, 2);
  return wrapWithLegend(svg, series);
}
export function groupedBars({ labels, series, height = 220 }) {
  const W = 560; const pad = { l: 44, r: 12, t: 10, b: 26 };
  const max = nice(Math.max(...series.flatMap((s) => s.values), 1));
  const svg = frame(W, height); grid(svg, W, height, pad, max, 4);
  const gw = (W - pad.l - pad.r) / labels.length; const bw = Math.min(14, (gw - 4) / series.length);
  const xs = labels.map((_, i) => pad.l + gw * i + gw / 2);
  labels.forEach((l, i) => series.forEach((s, j) => {
    const v = s.values[i]; const bh = (height - pad.t - pad.b) * (v / max);
    const r = el('rect', { x: xs[i] - (series.length * bw) / 2 + j * bw, y: height - pad.b - bh, width: bw - 1.5, height: Math.max(0, bh), rx: 3, fill: s.color });
    r.appendChild(el('title', {}, `${s.name}: ${v.toLocaleString()} (${l})`)); svg.appendChild(r);
  }));
  xlabels(svg, labels, xs, height, pad, 2);
  return wrapWithLegend(svg, series);
}
export function donut({ items, size = 180, center }) {
  const total = items.reduce((a, b) => a + b.value, 0) || 1; const svg = frame(size, size); const r = size / 2 - 14; const c = size / 2; let ang = -Math.PI / 2;
  if (!items.length || total === 0) svg.appendChild(el('circle', { cx: c, cy: c, r, fill: 'none', stroke: '#e6ecf8', 'stroke-width': 22 }));
  items.forEach((it) => {
    const a2 = ang + (it.value / total) * Math.PI * 2; const large = a2 - ang > Math.PI ? 1 : 0;
    if (it.value / total > 0.9999) svg.appendChild(el('circle', { cx: c, cy: c, r, fill: 'none', stroke: it.color, 'stroke-width': 22 }));
    else { const p = el('path', { d: `M${c + r * Math.cos(ang)} ${c + r * Math.sin(ang)} A${r} ${r} 0 ${large} 1 ${c + r * Math.cos(a2)} ${c + r * Math.sin(a2)}`, fill: 'none', stroke: it.color, 'stroke-width': 22 }); p.appendChild(el('title', {}, `${it.label}: ${it.value.toLocaleString()}`)); svg.appendChild(p); }
    ang = a2;
  });
  if (center) { svg.appendChild(el('text', { x: c, y: c - 2, 'text-anchor': 'middle', 'font-size': 22, 'font-weight': 700, fill: '#0f1b3d' }, center.value)); svg.appendChild(el('text', { x: c, y: c + 15, 'text-anchor': 'middle', 'font-size': 10.5, fill: '#7b8aa8' }, center.label)); }
  const wrap = document.createElement('div'); wrap.className = 'chart'; wrap.style.maxWidth = `${size}px`; wrap.style.margin = '0 auto'; wrap.appendChild(svg);
  const outer = document.createElement('div'); outer.appendChild(wrap);
  const lg = document.createElement('div'); lg.className = 'legend';
  items.forEach((it) => { const s = document.createElement('span'); const i = document.createElement('i'); i.style.background = it.color; s.append(i, `${it.label} · ${it.value.toLocaleString()}`); lg.appendChild(s); });
  outer.appendChild(lg); return outer;
}
export function hbars({ items, format = (v) => v.toLocaleString() }) {
  const max = Math.max(...items.map((i) => i.value), 1); const box = document.createElement('div');
  items.forEach((it) => {
    const row = document.createElement('div'); row.style.cssText = 'margin:7px 0';
    const top = document.createElement('div'); top.style.cssText = 'display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:3px';
    const a = document.createElement('span'); a.textContent = it.label; const b = document.createElement('b'); b.textContent = format(it.value, it); top.append(a, b);
    const bar = document.createElement('div'); bar.className = `bar ${it.kind || ''}`; const i = document.createElement('i'); i.style.width = `${(it.value / max) * 100}%`; if (it.color) i.style.background = it.color; bar.appendChild(i);
    row.append(top, bar); box.appendChild(row);
  });
  return box;
}
function wrapWithLegend(svg, series) {
  const wrap = document.createElement('div'); wrap.className = 'chart'; wrap.appendChild(svg);
  if (series.length > 1 || series[0]?.name) {
    const lg = document.createElement('div'); lg.className = 'legend';
    series.forEach((s) => { const sp = document.createElement('span'); const i = document.createElement('i'); i.style.background = s.color; sp.append(i, s.name); lg.appendChild(sp); });
    wrap.appendChild(lg);
  }
  return wrap;
}
