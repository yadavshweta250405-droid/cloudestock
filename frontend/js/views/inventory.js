import { h, fmt, mount, badge, table, formModal, confirmDialog, toast, toastError, modal, dl, bar, debounce, icon } from '../ui/dom.js';
import { api } from '../api.js';
import { pageHead, btn, tabs, load, attempt, canDo, receiveStockModal, rackOptions, kpi } from './common.js';

export async function render(root, app) {
  const write = canDo(app, 'inventory:write');
  const state = { tab: 'products', q: '', cat: '', status: '', mtype: '' };
  const body = h('div');
  let cats = [];
  const head = h('div');

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
      m.setActions([write && btn('Receive stock', () => receiveStockModal(app, { product: p2, onDone: async () => { paint(await api.get(`/products/${p2.id}`)); refresh(); } }), { kind: 'primary', ic: 'plus' }), write && btn('Edit', () => productForm(p2), { ic: 'edit' }), btn('Close', () => m.close())].filter(Boolean));
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
      const { items } = await api.get('/products', { q: state.q, categoryId: state.cat, status: state.status, limit: 500, includeInactive: state.inactive ? 'true' : undefined });
      return table({ rows: items, empty: { title: 'No products match', hint: write ? 'Create your first product with “Add product”.' : '' }, onRow: (p) => productDetail(p.id), columns: [
        { label: 'SKU', key: 'sku', mono: true }, { label: 'Product', render: (p) => h('div', null, h('b', null, p.name), !p.active && h('span', { class: 'badge', style: { marginLeft: '6px' } }, 'archived')) },
        { label: 'Category', render: (p) => p.categoryName ? h('span', { class: 'badge', style: { background: `${p.categoryColor}22`, color: p.categoryColor } }, p.categoryName) : '–' },
        { label: 'On hand', num: true, render: (p) => fmt.n(p.onHand) }, { label: 'Reserved', num: true, render: (p) => fmt.n(p.reserved) }, { label: 'Available', num: true, render: (p) => fmt.n(p.available) },
        { label: 'Reorder', num: true, render: (p) => fmt.n(p.reorderLevel) }, { label: 'Price', num: true, render: (p) => fmt.money(p.unitPrice) }, { label: 'Status', render: (p) => badge(p.status) },
        write && { label: '', actions: true, render: (p) => [btn('Receive', () => receiveStockModal(app, { product: p, onDone: refresh }), { sm: true }), btn('', () => productForm(p), { sm: true, ic: 'edit', title: 'Edit' }), btn('', async () => {
          if (!(await confirmDialog({ title: `Delete ${p.sku}?`, message: 'Products with history are archived instead of erased. Products that are still in stock cannot be deleted.', confirmLabel: 'Delete', danger: true }))) return;
          const r = await attempt(() => api.del(`/products/${p.id}`)); if (r) { toast(r.mode === 'archived' ? 'Product archived' : 'Product deleted', '', 'success'); refresh(); } }, { sm: true, kind: 'danger', ic: 'trash', title: 'Delete' })] }].filter(Boolean) });
    }
    if (state.tab === 'stock') {
      const { items } = await api.get('/inventory');
      const q = state.q.toLowerCase(); const rows = items.filter((r) => !q || `${r.sku} ${r.productName} ${r.rackCode}`.toLowerCase().includes(q));
      return table({ rows, empty: 'No stock stored', columns: [
        { label: 'Rack', render: (r) => h('b', null, r.rackCode) }, { label: 'Section', key: 'sectionCode' }, { label: 'SKU', key: 'sku', mono: true }, { label: 'Product', key: 'productName' }, { label: 'Batch', key: 'batchNo', mono: true },
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
    const catSel = h('select', { onChange: (e) => { state.cat = e.target.value; refresh(); } }, h('option', { value: '' }, 'All categories'), cats.map((c) => h('option', { value: c.id, selected: String(c.id) === String(state.cat) }, c.name)));
    const stSel = h('select', { onChange: (e) => { state.status = e.target.value; refresh(); } }, [['', 'All stock levels'], ['ok', 'In stock'], ['low', 'Low stock'], ['out', 'Out of stock']].map(([v, l]) => h('option', { value: v, selected: v === state.status }, l)));
    const mt = h('select', { onChange: (e) => { state.mtype = e.target.value; refresh(); } }, [['', 'All movement types'], ['IN', 'Inbound'], ['OUT', 'Outbound'], ['ADJUST', 'Adjustments'], ['TRANSFER_IN', 'Transfers in'], ['TRANSFER_OUT', 'Transfers out']].map(([v, l]) => h('option', { value: v, selected: v === state.mtype }, l)));
    const inact = h('label', { class: 'muted', style: { display: 'flex', gap: '6px', alignItems: 'center' } }, h('input', { type: 'checkbox', checked: !!state.inactive, onChange: (e) => { state.inactive = e.target.checked; refresh(); } }), 'Show archived');
    return h('div', { class: 'toolbar' }, state.tab !== 'movements' && search, state.tab === 'products' && [catSel, stSel, inact], state.tab === 'movements' && mt);
  }
  const paintAll = () => mount(root, pageHead('Inventory', 'Products, stock locations and the full movement ledger',
    write && btn('Receive stock', () => receiveStockModal(app, { onDone: refresh }), { ic: 'inbox' }), write && btn('Add product', () => productForm(null), { kind: 'primary', ic: 'plus' })),
  tabs([['products', 'Products'], ['stock', 'Stock by location'], ['movements', 'Movement history']], state.tab, (t) => { state.tab = t; paintAll(); refresh(); }), h('div', { style: { height: '14px' } }), toolbar(), content);
  cats = (await api.get('/categories')).items;
  paintAll(); await load(content, paintTab);
  void head; void body; void kpi; void bar;
  return { refresh, open: (id) => productDetail(id).catch(toastError) };
}
