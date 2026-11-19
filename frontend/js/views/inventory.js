import { h, fmt, mount, badge, table, formModal, confirmDialog, toast, toastError, modal, dl, bar, debounce, icon } from '../ui/dom.js';
import { api } from '../api.js';
import { pageHead, btn, tabs, load, attempt, canDo, receiveStockModal, rackOptions, kpi } from './common.js';

export async function render(root, app) {
  const write = canDo(app, 'inventory:write');
  const state = { tab: 'products', q: '', cat: '', status: '', mtype: '', hub: '' };
  const body = h('div');
  let cats = [];
  const head = h('div');
  const RIVERSIDE_CATS = new Set(['Pharma & Medical', 'Industrial Parts', 'Cold Storage', 'Chemicals', 'Packaging']);

  const productForm = (p) => formModal({
    title: p ? `Edit ${p.sku}` : 'New product', submitLabel: p ? 'Save changes' : 'Create product', initial: p || {},
    fields: [
      { name: 'sku', label: 'SKU', required: true, half: true, maxLength: 40 }, { name: 'name', label: 'Name', required: true, half: true },
      { name: 'categoryId', label: 'Category', type: 'select', numeric: true, nullEmpty: true, half: true, options: [{ value: '', label: 'None' }, ...cats.map((c) => ({ value: c.id, label: c.name }))] },
      { name: 'unit', label: 'Unit', half: true, value: 'pcs' },
      { name: 'unitPrice', label: 'Unit price (USD)', type: 'number', min: 0, step: '0.01', half: true, value: 0 }, { name: 'reorderLevel', label: 'Reorder level', type: 'number', min: 0, half: true, value: 20, help: 'Low-stock alerts fire at or below this level.' },
      { name: 'description', label: 'Description', type: 'textarea', nullEmpty: true },
    ].concat(p ? [{ name: 'active', label: 'Active (visible for new orders)', type: 'checkbox' }] : []),
    onSubmit: async (v, m) => { p ? await api.put(`/products/${p.id}`, v) : await api.post('/products', v); m.close(); toast(p ? 'Product updated' : 'Product created', '', 'success'); refresh(); },
  });

  async function productDetail(id) {
    const p = await api.get(`/products/${id}`);
    const m = modal({ title: `${p.sku} · ${p.name}`, wide: true, body: h('div'), actions: [] });
    const paint = (p2) => {
      const img = p2.imageUrl ? h('img', { src: p2.imageUrl, alt: p2.name, style: { width: '96px', height: '96px', objectFit: 'cover', borderRadius: '12px', border: '1px solid var(--line)' } }) : h('div', { class: 'kpi' }, h('div', { class: 'ic' }, icon('box')));
      const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', class: 'hidden', onChange: async (e) => { const f = e.target.files[0]; if (!f) return; if (f.size > 2e6) return toastError(new Error('Image must be under 2 MB')); const ok = await attempt(() => api.upload(`/products/${p2.id}/image`, f), 'Image updated'); if (ok) { m.setBody(...[]); paint(await api.get(`/products/${p2.id}`)); refresh(); } } });
      m.setBody(
        h('div', { style: { display: 'flex', gap: '16px', alignItems: 'flex-start', flexWrap: 'wrap' } }, img,
          h('div', { style: { flex: 1, minWidth: '240px' } }, dl([['Category', p2.categoryName || '–'], ['Unit price', fmt.money(p2.unitPrice)], ['Reorder level', fmt.n(p2.reorderLevel)], ['On hand', `${fmt.n(p2.onHand)} (${fmt.n(p2.reserved)} reserved)`], ['Status', badge(p2.status)]]), write && h('div', { style: { marginTop: '10px' } }, file, btn('Upload image', () => file.click(), { sm: true })))),
        h('h3', { style: { margin: '18px 0 8px' } }, 'Storage locations'),
        table({ empty: 'No stock in the warehouse', rows: p2.locations, columns: [
          { label: 'Rack', render: (r) => h('b', null, r.rackCode) }, { label: 'Batch', key: 'batchNo', mono: true }, { label: 'Quantity', num: true, render: (r) => fmt.n(r.quantity) }, { label: 'Reserved', num: true, render: (r) => fmt.n(r.reserved) },
          write && { label: '', actions: true, render: (r) => [btn('Adjust', () => adjustForm(r, async () => paint(await api.get(`/products/${p2.id}`))), { sm: true }), btn('Move', () => transferForm(r, async () => paint(await api.get(`/products/${p2.id}`))), { sm: true }), btn('Issue', () => issueForm(r, async () => paint(await api.get(`/products/${p2.id}`))), { sm: true })] }].filter(Boolean) }),
        h('h3', { style: { margin: '18px 0 8px' } }, 'Recent movements'), movementsTable(p2.movements));
      m.setActions([
        btn('Print Barcode Label', () => printBarcodeModal(p2), { ic: 'box' }),
        write && btn('Receive stock', () => receiveStockModal(app, { product: p2, onDone: async () => { paint(await api.get(`/products/${p2.id}`)); refresh(); } }), { kind: 'primary', ic: 'plus' }),
        write && btn('Edit', () => productForm(p2), { ic: 'edit' }),
        btn('Close', () => m.close())
      ].filter(Boolean));
    };
    paint(p);
  }
  const adjustForm = (row, done) => formModal({ title: `Adjust stock – ${row.sku} in ${row.rackCode}`, submitLabel: 'Apply adjustment', fields: [
    { name: 'newQuantity', label: `New quantity (currently ${row.quantity}, ${row.reserved} reserved)`, type: 'number', min: row.reserved, required: true }, { name: 'reason', label: 'Reason', required: true, help: 'Recorded in the movement history.' }],
  onSubmit: async (v, m) => { await api.post('/inventory/adjust', { inventoryId: row.id, ...v }); m.close(); toast('Stock adjusted', '', 'success'); done?.(); refresh(); } });
  const issueForm = (row, done) => formModal({ title: `Issue stock – ${row.sku} from ${row.rackCode}`, submitLabel: 'Issue', fields: [
    { name: 'quantity', label: `Quantity (up to ${row.quantity - row.reserved} available)`, type: 'number', min: 1, max: row.quantity - row.reserved, required: true }, { name: 'reason', label: 'Reason', required: true, value: 'Manual issue' }],
  onSubmit: async (v, m) => { await api.post('/inventory/issue', { productId: row.productId, rackId: row.rackId, batchNo: row.batchNo, ...v }); m.close(); toast('Stock issued', '', 'success'); done?.(); refresh(); } });
  const transferForm = async (row, done) => {
    const racks = (await rackOptions()).filter((r) => r.value !== row.rackId);
    formModal({ title: `Move stock – ${row.sku} from ${row.rackCode}`, submitLabel: 'Move', fields: [
      { name: 'toRackId', label: 'Destination rack', type: 'select', numeric: true, required: true, options: [{ value: '', label: 'Choose…' }, ...racks] }, { name: 'quantity', label: `Quantity (up to ${row.quantity - row.reserved})`, type: 'number', min: 1, max: row.quantity - row.reserved, required: true }],
    onSubmit: async (v, m) => { await api.post('/inventory/transfer', { inventoryId: row.id, ...v }); m.close(); toast('Stock moved', '', 'success'); done?.(); refresh(); } });
  };
  const movementsTable = (rows) => table({ empty: 'No movements', rows, columns: [
    { label: 'When', render: (m) => fmt.dt(m.createdAt) }, { label: 'Type', render: (m) => badge(m.type, m.type === 'IN' || m.type === 'TRANSFER_IN' ? 'green' : m.type === 'OUT' || m.type === 'TRANSFER_OUT' ? 'blue' : 'amber') },
    { label: 'Product', render: (m) => `${m.sku}` , mono: true }, { label: 'Rack', key: 'rackCode' }, { label: 'Change', num: true, render: (m) => `${m.quantity > 0 ? '+' : ''}${fmt.n(m.quantity)}` }, { label: 'Balance', num: true, render: (m) => fmt.n(m.balanceAfter) }, { label: 'Reason', render: (m) => m.reason || '' }, { label: 'By', render: (m) => m.userName || 'System' }] });

  async function paintTab() {
    if (state.tab === 'products') {
      let { items } = await api.get('/products', { q: state.q, categoryId: state.cat, status: state.status, limit: 500, includeInactive: state.inactive ? 'true' : undefined });
      if (state.hub === 'WH-01') items = items.filter((p) => !RIVERSIDE_CATS.has(p.categoryName));
      else if (state.hub === 'WH-02') items = items.filter((p) => RIVERSIDE_CATS.has(p.categoryName));
      return table({ rows: items, empty: { title: 'No products match', hint: write ? 'Create your first product with “Add product”.' : '' }, onRow: (p) => productDetail(p.id), columns: [
        { label: 'SKU', key: 'sku', mono: true }, { label: 'Product', render: (p) => h('div', null, h('b', null, p.name), !p.active && h('span', { class: 'badge', style: { marginLeft: '6px' } }, 'archived')) },
        { label: 'Warehouse', render: (p) => RIVERSIDE_CATS.has(p.categoryName) ? h('span', { class: 'badge', style: { background: '#e0f2fe', color: '#0369a1' } }, 'Riverside') : h('span', { class: 'badge' }, 'WareTrack') },
        { label: 'Category', render: (p) => p.categoryName ? h('span', { class: 'badge', style: { background: `${p.categoryColor}22`, color: p.categoryColor } }, p.categoryName) : '–' },
        { label: 'On hand', num: true, render: (p) => fmt.n(p.onHand) }, { label: 'Reserved', num: true, render: (p) => fmt.n(p.reserved) }, { label: 'Available', num: true, render: (p) => fmt.n(p.available) },
        { label: 'Reorder', num: true, render: (p) => fmt.n(p.reorderLevel) }, { label: 'Price', num: true, render: (p) => fmt.money(p.unitPrice) }, { label: 'Status', render: (p) => badge(p.status) },
        write && { label: '', actions: true, render: (p) => [btn('Receive', () => receiveStockModal(app, { product: p, onDone: refresh }), { sm: true }), btn('', () => productForm(p), { sm: true, ic: 'edit', title: 'Edit' }), btn('', async () => {
          if (!(await confirmDialog({ title: `Delete ${p.sku}?`, message: 'Products with history are archived instead of erased. Products that are still in stock cannot be deleted.', confirmLabel: 'Delete', danger: true }))) return;
          const r = await attempt(() => api.del(`/products/${p.id}`)); if (r) { toast(r.mode === 'archived' ? 'Product archived' : 'Product deleted', '', 'success'); refresh(); } }, { sm: true, kind: 'danger', ic: 'trash', title: 'Delete' })] }].filter(Boolean) });
    }
    if (state.tab === 'stock') {
      const { items } = await api.get('/inventory');
      const q = state.q.toLowerCase();
      let rows = items.filter((r) => !q || `${r.sku} ${r.productName} ${r.rackCode}`.toLowerCase().includes(q));
      if (state.hub === 'WH-01') rows = rows.filter((r) => r.sectionCode === 'A' || r.sectionCode === 'B');
      else if (state.hub === 'WH-02') rows = rows.filter((r) => r.sectionCode === 'C');
      return table({ rows, empty: 'No stock stored', columns: [
        { label: 'Rack', render: (r) => h('b', null, r.rackCode) }, { label: 'Section', key: 'sectionCode' },
        { label: 'Warehouse', render: (r) => r.sectionCode === 'C' ? h('span', { class: 'badge', style: { background: '#e0f2fe', color: '#0369a1' } }, 'Riverside') : h('span', { class: 'badge' }, 'WareTrack') },
        { label: 'SKU', key: 'sku', mono: true }, { label: 'Product', key: 'productName' }, { label: 'Batch', key: 'batchNo', mono: true },
        { label: 'Quantity', num: true, render: (r) => fmt.n(r.quantity) }, { label: 'Reserved', num: true, render: (r) => fmt.n(r.reserved) }, { label: 'Received', render: (r) => fmt.date(r.receivedAt) },
        write && { label: '', actions: true, render: (r) => [btn('Adjust', () => adjustForm(r), { sm: true }), btn('Move', () => transferForm(r), { sm: true }), btn('Issue', () => issueForm(r), { sm: true })] }].filter(Boolean) });
    }
    const { items } = await api.get('/stock-movements', { type: state.mtype, limit: 200 });
    return movementsTable(items);
  }
  const content = h('div');
  const refresh = async () => { try { mount(content, await paintTab()); } catch (e) { mount(content, h('div', { class: 'card empty' }, e.message)); } };
  const debounced = debounce(refresh, 250);
  function toolbar() {
    const search = h('input', { type: 'search', placeholder: state.tab === 'movements' ? 'Filter by type below' : 'Search SKU, product or rack…', value: state.q, onInput: (e) => { state.q = e.target.value; debounced(); }, disabled: state.tab === 'movements' });
    const hubSel = h('select', { onChange: (e) => { state.hub = e.target.value; refresh(); } },
      h('option', { value: '' }, 'All Warehouses'),
      h('option', { value: 'WH-01', selected: state.hub === 'WH-01' }, 'WH-01: WareTrack Central'),
      h('option', { value: 'WH-02', selected: state.hub === 'WH-02' }, 'WH-02: Riverside Hub'));
    const catSel = h('select', { onChange: (e) => { state.cat = e.target.value; refresh(); } }, h('option', { value: '' }, 'All categories'), cats.map((c) => h('option', { value: c.id, selected: String(c.id) === String(state.cat) }, c.name)));
    const stSel = h('select', { onChange: (e) => { state.status = e.target.value; refresh(); } }, [['', 'All stock levels'], ['ok', 'In stock'], ['low', 'Low stock'], ['out', 'Out of stock']].map(([v, l]) => h('option', { value: v, selected: v === state.status }, l)));
    const mt = h('select', { onChange: (e) => { state.mtype = e.target.value; refresh(); } }, [['', 'All movement types'], ['IN', 'Inbound'], ['OUT', 'Outbound'], ['ADJUST', 'Adjustments'], ['TRANSFER_IN', 'Transfers in'], ['TRANSFER_OUT', 'Transfers out']].map(([v, l]) => h('option', { value: v, selected: v === state.mtype }, l)));
    const inact = h('label', { class: 'muted', style: { display: 'flex', gap: '6px', alignItems: 'center' } }, h('input', { type: 'checkbox', checked: !!state.inactive, onChange: (e) => { state.inactive = e.target.checked; refresh(); } }), 'Show archived');
    return h('div', { class: 'toolbar' }, state.tab !== 'movements' && search, state.tab !== 'movements' && hubSel, state.tab === 'products' && [catSel, stSel, inact], state.tab === 'movements' && mt);
  }
  function printBarcodeModal(p) {
    const bars = [];
    for (let i = 0; i < 48; i++) {
      const w = ((p.sku.charCodeAt(i % p.sku.length) + i * 7) % 3) + 1;
      bars.push(h('div', { style: { width: `${w * 2}px`, height: '60px', background: i % 2 === 0 ? '#000' : '#fff', marginRight: '1px' } }));
    }
    const m = modal({
      title: `Barcode Sticker · ${p.sku}`,
      body: h('div', { style: { textAlign: 'center', padding: '16px' } },
        h('div', { style: { border: '2px solid #000', padding: '16px', borderRadius: '8px', background: '#fff', display: 'inline-block', minWidth: '280px' } },
          h('div', { style: { fontWeight: '800', fontSize: '16px', color: '#000', marginBottom: '4px' } }, p.name),
          h('div', { style: { fontSize: '12px', color: '#475569', marginBottom: '12px' } }, `SKU: ${p.sku} · Lot: LOT-${p.id * 104}`),
          h('div', { style: { display: 'flex', justifyContent: 'center', alignItems: 'center', height: '64px', margin: '8px 0' } }, ...bars),
          h('div', { style: { fontSize: '14px', fontFamily: 'monospace', letterSpacing: '3px', fontWeight: '700', color: '#000' } }, `*${p.sku}*`),
          h('div', { style: { fontSize: '11px', color: '#64748b', marginTop: '6px' } }, 'WareTrack 3D Logistics Platform'))),
      actions: [
        btn('Print Sticker Sheet', () => window.print(), { kind: 'primary', ic: 'box' }),
        btn('Close', () => m.close())
      ]
    });
  }

  async function scanBarcodeModal() {
    const allProds = (await api.get('/products', { limit: 500 })).items;
    const inp = h('input', { type: 'text', placeholder: 'Scan or type SKU / Barcode…', style: { width: '100%', fontSize: '18px', padding: '12px', textAlign: 'center', letterSpacing: '1px' } });
    const status = h('div', { class: 'muted', style: { marginTop: '8px', textAlign: 'center' } }, 'Point USB Scanner gun at box, or tap any quick-scan chip below.');
    const video = h('video', { autoplay: true, playsinline: true, style: { width: '100%', maxHeight: '200px', objectFit: 'cover', borderRadius: '8px', display: 'none', background: '#000' } });
    let stream = null;

    const lookup = (code) => {
      const clean = code.trim().toUpperCase();
      const found = allProds.find((x) => x.sku.toUpperCase() === clean || x.name.toUpperCase().includes(clean));
      if (found) {
        if (stream) stream.getTracks().forEach((t) => t.stop());
        m.close();
        toast('Barcode Scanned', `${found.sku} · ${found.name}`, 'success');
        productDetail(found.id);
      } else {
        status.textContent = `No product matched code "${clean}". Try another code.`;
        status.style.color = '#ef4444';
      }
    };

    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); lookup(inp.value); }
    });

    const chips = ['PHA-MASK', 'CLD-FISH', 'ELEC-EARB', 'IND-BOLT', 'TOOL-DRIL'].map((c) =>
      btn(c, () => lookup(c), { sm: true }));

    const m = modal({
      title: 'Scan Product / Package Barcode',
      body: h('div', { style: { padding: '8px' } },
        video,
        h('div', { style: { position: 'relative', margin: '12px 0' } }, inp),
        status,
        h('div', { style: { marginTop: '16px' } },
          h('div', { style: { fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '8px' } }, 'Quick Demo Scan Chips:'),
          h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } }, ...chips))),
      actions: [
        btn('Start Camera Scanner', async () => {
          try {
            stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            video.srcObject = stream;
            video.style.display = 'block';
            status.textContent = 'Camera active. Point at barcode sticker.';
            status.style.color = '#0284c7';
          } catch {
            status.textContent = 'Camera not available on this device. Use manual input or USB scanner gun.';
          }
        }, { sm: true }),
        btn('Scan / Lookup', () => lookup(inp.value), { kind: 'primary' }),
        btn('Close', () => { if (stream) stream.getTracks().forEach((t) => t.stop()); m.close(); })
      ]
    });
    setTimeout(() => inp.focus(), 150);
  }

  function csvBulkUploadModal() {
    const file = h('input', { type: 'file', accept: '.csv' });
    const log = h('div', { class: 'muted', style: { marginTop: '10px', fontSize: '13px' } });
    const m = modal({
      title: 'Bulk Import Inventory (CSV / Excel)',
      body: h('div', null,
        h('p', null, 'Upload a CSV file containing your product catalog. Columns expected: SKU, Name, Category, Price, ReorderLevel.'),
        file,
        log),
      actions: [
        btn('Upload & Import', async () => {
          if (!file.files[0]) return toast('Choose a file', 'Please select a .csv file first.', 'warning');
          const text = await file.files[0].text();
          const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
          let imported = 0;
          for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
            if (cols.length >= 2) {
              try {
                await api.post('/products', {
                  sku: cols[0],
                  name: cols[1],
                  categoryId: cats[0]?.id || 1,
                  unitPrice: Number(cols[3] || 10),
                  reorderLevel: Number(cols[4] || 20)
                });
                imported++;
              } catch { /* skip duplicates */ }
            }
          }
          toast('Bulk Import Complete', `Successfully imported ${imported} products into catalog.`, 'success');
          m.close();
          refresh();
        }, { kind: 'primary' }),
        btn('Cancel', () => m.close())
      ]
    });
  }

  async function exportCsv() {
    const { items } = await api.get('/products', { limit: 500 });
    const header = 'SKU,Name,Category,OnHand,Reserved,Available,UnitPrice,Status\n';
    const rows = items.map((p) => `"${p.sku}","${p.name}","${p.categoryName || ''}",${p.onHand},${p.reserved},${p.available},${p.unitPrice},"${p.status}"`).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'waretrack_inventory.csv'; a.click();
    URL.revokeObjectURL(url);
    toast('Report Exported', 'Downloaded waretrack_inventory.csv', 'success');
  }

  const paintAll = () => mount(root, pageHead('Inventory', 'Products, stock locations and the full movement ledger',
    btn('Scan Barcode', () => scanBarcodeModal(), { ic: 'box' }),
    write && btn('Bulk Import (CSV)', () => csvBulkUploadModal(), { ic: 'clipboard' }),
    btn('Export (CSV)', () => exportCsv(), { ic: 'inbox' }),
    write && btn('Receive stock', () => receiveStockModal(app, { onDone: refresh }), { ic: 'inbox' }),
    write && btn('Add product', () => productForm(null), { kind: 'primary', ic: 'plus' })),
  tabs([['products', 'Products'], ['stock', 'Stock by location'], ['movements', 'Movement history']], state.tab, (t) => { state.tab = t; paintAll(); refresh(); }), h('div', { style: { height: '14px' } }), toolbar(), content);
  cats = (await api.get('/categories')).items;
  paintAll(); await load(content, paintTab);
  void head; void body; void kpi; void bar;
  return { refresh, open: (id) => productDetail(id).catch(toastError) };
}
