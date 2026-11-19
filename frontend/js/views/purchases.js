import { h, fmt, mount, badge, table, formModal, toast, confirmDialog, modal } from '../ui/dom.js';
import { api } from '../api.js';
import { pageHead, btn, tabs, load, attempt, canDo } from './common.js';

export async function render(root, app) {
  const write = canDo(app, 'purchase_orders:write');
  let activeTab = 'orders';
  let statusFilter = '';
  const content = h('div');

  async function poDetail(id) {
    const po = await api.get(`/purchase-orders/${id}`);
    const m = modal({
      title: `Purchase Order ${po.number}`,
      wide: true,
      content: h('div', null,
        h('div', { class: 'grid g3', style: { marginBottom: '14px' } },
          h('div', { class: 'card' }, h('div', { class: 'muted' }, 'Supplier'), h('b', null, po.supplier_name), h('div', { class: 'muted mono' }, po.supplier_code)),
          h('div', { class: 'card' }, h('div', { class: 'muted' }, 'Status'), h('div', { style: { marginTop: '4px' } }, badge(po.status))),
          h('div', { class: 'card' }, h('div', { class: 'muted' }, 'Total Amount'), h('b', { style: { fontSize: '18px', color: '#10b981' } }, fmt.money(po.total_amount)))
        ),
        h('h3', { style: { margin: '12px 0 8px 0' } }, 'Ordered Items & Delivery Status'),
        table({
          rows: po.items,
          columns: [
            { label: 'SKU', key: 'sku', mono: true },
            { label: 'Product Name', key: 'product_name' },
            { label: 'Unit Cost', render: (it) => fmt.money(it.unit_cost) },
            { label: 'Ordered', num: true, render: (it) => `${fmt.n(it.quantity)} ${it.unit}` },
            { label: 'Received', num: true, render: (it) => `${fmt.n(it.received_quantity)} ${it.unit}` },
            { label: 'Pending', num: true, render: (it) => `${fmt.n(it.quantity - it.received_quantity)} ${it.unit}` }
          ]
        })
      )
    });
  }

  async function newPoForm() {
    const [sups, whs, prods] = await Promise.all([
      api.get('/suppliers'),
      api.get('/warehouses'),
      api.get('/products')
    ]);

    formModal({
      title: 'Create Purchase Order',
      submitLabel: 'Create PO',
      wide: true,
      fields: [
        { name: 'supplierId', label: 'Supplier', type: 'select', numeric: true, required: true, half: true, options: sups.items.map(s => ({ value: s.id, label: `${s.name} (${s.code})` })) },
        { name: 'warehouseId', label: 'Destination Warehouse', type: 'select', numeric: true, required: true, half: true, options: whs.items.map(w => ({ value: w.id, label: `${w.name} (${w.code})` })) },
        { name: 'productId', label: 'Primary Item', type: 'select', numeric: true, required: true, half: true, options: prods.items.map(p => ({ value: p.id, label: `${p.sku} · ${p.name}` })) },
        { name: 'quantity', label: 'Order Quantity', type: 'number', required: true, half: true, min: 1, value: 100 },
        { name: 'unitCost', label: 'Negotiated Unit Cost ($)', type: 'number', required: true, half: true, min: 0.01, step: 0.01, value: 12.50 },
        { name: 'expectedDelivery', label: 'Expected Delivery Date', type: 'date', half: true },
        { name: 'notes', label: 'Procurement Notes', type: 'textarea' }
      ],
      onSubmit: async (v, m) => {
        const payload = {
          supplierId: v.supplierId,
          warehouseId: v.warehouseId,
          expectedDelivery: v.expectedDelivery || null,
          notes: v.notes || null,
          items: [{ productId: v.productId, quantity: v.quantity, unitCost: v.unitCost }]
        };
        await api.post('/purchase-orders', payload);
        m.close();
        toast('Purchase Order Created', 'Awaiting approval from procurement manager', 'success');
        refresh();
      }
    });
  }

  async function receiveGoodsModal(po) {
    const wh = await api.get(`/warehouse?warehouseId=${po.warehouse_id}`);
    const racks = wh.sections.flatMap(s => s.racks).map(r => ({ value: r.id, label: `Rack ${r.code} (${r.status})` }));

    const pendingItems = po.items.filter(it => it.quantity > it.received_quantity);
    if (!pendingItems.length) {
      toast('PO Fully Received', 'All units have already been booked into stock', 'info');
      return;
    }

    formModal({
      title: `Receive Stock for ${po.number}`,
      submitLabel: 'Book into Warehouse Racks',
      fields: [
        { name: 'itemId', label: 'Product Line', type: 'select', numeric: true, required: true, options: pendingItems.map(it => ({ value: it.id, label: `${it.sku} · ${it.product_name} (Pending: ${it.quantity - it.received_quantity} ${it.unit})` })) },
        { name: 'quantity', label: 'Quantity Receiving Now', type: 'number', required: true, half: true, min: 1, value: pendingItems[0].quantity - pendingItems[0].received_quantity },
        { name: 'rackId', label: 'Target Rack Location', type: 'select', numeric: true, required: true, half: true, options: racks },
        { name: 'batchNo', label: 'Batch / Lot Number', placeholder: 'e.g. B-2026-X1', half: true }
      ],
      onSubmit: async (v, m) => {
        await api.post(`/purchase-orders/${po.id}/receive`, {
          allocations: [{ itemId: v.itemId, quantity: v.quantity, rackId: v.rackId, batchNo: v.batchNo }]
        });
        m.close();
        toast('Goods Received', `Units successfully stored in selected rack`, 'success');
        refresh();
      }
    });
  }

  async function supplierForm() {
    formModal({
      title: 'Add New Supplier',
      submitLabel: 'Save Supplier',
      fields: [
        { name: 'name', label: 'Supplier Company Name', required: true },
        { name: 'contactName', label: 'Contact Person', half: true },
        { name: 'email', label: 'Email Address', type: 'email', half: true },
        { name: 'phone', label: 'Phone', half: true },
        { name: 'city', label: 'City', half: true },
        { name: 'paymentTerms', label: 'Payment Terms', half: true, value: 'Net 30' },
        { name: 'address', label: 'Street Address' }
      ],
      onSubmit: async (v, m) => {
        await api.post('/suppliers', v);
        m.close();
        toast('Supplier Registered', `${v.name} added to vendor database`, 'success');
        refresh();
      }
    });
  }

  async function paintTab() {
    if (activeTab === 'suppliers') {
      const sups = await api.get('/suppliers');
      return h('div', null,
        table({
          rows: sups.items,
          empty: 'No registered suppliers',
          columns: [
            { label: 'Code', key: 'code', mono: true },
            { label: 'Supplier Name', render: (s) => h('b', null, s.name) },
            { label: 'Contact', render: (s) => s.contact_name || '–' },
            { label: 'Email', key: 'email' },
            { label: 'Phone', key: 'phone' },
            { label: 'City', key: 'city' },
            { label: 'Terms', render: (s) => badge(s.payment_terms, 'blue') }
          ]
        })
      );
    }

    const params = { status: statusFilter || undefined };
    const pos = await api.get('/purchase-orders', params);

    return h('div', null,
      h('div', { class: 'chips', style: { marginBottom: '14px' } },
        [['', 'All Statuses'], ['pending', 'Pending Approval'], ['approved', 'Approved'], ['ordered', 'Ordered'], ['partially_received', 'Partially Received'], ['completed', 'Completed']].map(([v, l]) =>
          h('button', {
            class: `chip ${statusFilter === v ? 'active' : ''}`,
            onClick: () => { statusFilter = v; refresh(); }
          }, l)
        )
      ),
      table({
        rows: pos.items,
        empty: 'No purchase orders found',
        columns: [
          { label: 'PO Number', render: (p) => h('a', { href: '#', onClick: (e) => { e.preventDefault(); poDetail(p.id); }, style: { fontWeight: 700 } }, p.number) },
          { label: 'Supplier', render: (p) => h('div', null, h('b', null, p.supplier_name), h('div', { class: 'muted mono' }, p.supplier_code)) },
          { label: 'Warehouse', key: 'warehouse_name' },
          { label: 'Status', render: (p) => badge(p.status, p.status === 'completed' ? 'green' : p.status === 'ordered' ? 'blue' : p.status === 'pending' ? 'amber' : 'gray') },
          { label: 'Units', render: (p) => `${fmt.n(p.total_received)} / ${fmt.n(p.total_units)}` },
          { label: 'Total', render: (p) => fmt.money(p.total_amount) },
          write && {
            label: '',
            actions: true,
            render: (p) => [
              p.status === 'pending' && btn('Approve', async () => {
                await api.patch(`/purchase-orders/${p.id}/status`, { status: 'approved' });
                toast('PO Approved', `PO ${p.number} approved`, 'success');
                refresh();
              }, { sm: true, kind: 'primary', ic: 'check' }),
              p.status === 'approved' && btn('Order', async () => {
                await api.patch(`/purchase-orders/${p.id}/status`, { status: 'ordered' });
                toast('Marked Ordered', `Sent to supplier`, 'success');
                refresh();
              }, { sm: true, ic: 'send' }),
              ['ordered', 'partially_received'].includes(p.status) && btn('Receive to Racks', () => receiveGoodsModal(p), { sm: true, kind: 'primary', ic: 'inbox' }),
              btn('Details', () => poDetail(p.id), { sm: true })
            ].filter(Boolean)
          }
        ].filter(Boolean)
      })
    );
  }

  const refresh = async () => {
    try { mount(content, await paintTab()); }
    catch (e) { mount(content, h('div', { class: 'card empty' }, e.message)); }
  };

  const paintAll = () => {
    mount(
      root,
      pageHead(
        'Purchase Orders & Procurement',
        'Issue procurement orders, track supplier delivery status, and book stock into warehouse racks',
        write && (activeTab === 'orders'
          ? btn('New Purchase Order', newPoForm, { kind: 'primary', ic: 'plus' })
          : btn('Add Supplier', supplierForm, { kind: 'primary', ic: 'plus' }))
      ),
      tabs([['orders', 'Purchase Orders'], ['suppliers', 'Suppliers']], activeTab, (t) => {
        activeTab = t;
        paintAll();
        refresh();
      }),
      h('div', { style: { height: '14px' } }),
      content
    );
  };

  paintAll();
  await load(content, paintTab);
  return { refresh };
}
