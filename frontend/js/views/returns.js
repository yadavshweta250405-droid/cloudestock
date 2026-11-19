import { h, fmt, mount, badge, table, formModal, toast, confirmDialog, modal } from '../ui/dom.js';
import { api } from '../api.js';
import { RETURN_REASONS } from '/shared/constants.js';
import { pageHead, btn, load, attempt, canDo } from './common.js';

export async function render(root, app) {
  const write = canDo(app, 'returns:write');
  let statusFilter = '';
  const content = h('div');

  async function returnDetail(id) {
    const r = await api.get(`/returns/${id}`);
    const m = modal({
      title: `Return Request ${r.number}`,
      wide: true,
      content: h('div', null,
        h('div', { class: 'grid g3', style: { marginBottom: '14px' } },
          h('div', { class: 'card' }, h('div', { class: 'muted' }, 'Customer'), h('b', null, r.customer_name), h('div', { class: 'muted' }, r.customer_email || 'No email')),
          h('div', { class: 'card' }, h('div', { class: 'muted' }, 'Reason & Status'), h('div', { style: { marginTop: '4px', display: 'flex', gap: '6px' } }, badge(fmt.label(r.reason), 'amber'), badge(r.status))),
          h('div', { class: 'card' }, h('div', { class: 'muted' }, 'Refund Amount'), h('b', { style: { fontSize: '18px', color: '#10b981' } }, fmt.money(r.refund_amount)))
        ),
        r.inspection_notes && h('div', { class: 'card', style: { marginBottom: '14px', background: 'var(--panel)', padding: '12px' } },
          h('b', null, 'Inspection Report: '),
          h('span', null, r.inspection_notes)
        ),
        h('h3', { style: { margin: '12px 0 8px 0' } }, 'Returned Line Items'),
        table({
          rows: r.items,
          columns: [
            { label: 'SKU', key: 'sku', mono: true },
            { label: 'Product Name', key: 'product_name' },
            { label: 'Return Qty', num: true, render: (it) => `${fmt.n(it.quantity)} ${it.unit}` },
            { label: 'Condition', render: (it) => badge(it.condition, it.condition === 'unopened' ? 'green' : it.condition === 'damaged' ? 'red' : 'blue') },
            { label: 'Restocked Qty', num: true, render: (it) => `${fmt.n(it.restocked_quantity)} ${it.unit}` },
            { label: 'Shelf Location', render: (it) => it.rack_code ? `Rack ${it.rack_code}` : h('span', { class: 'muted' }, 'Not Restocked') }
          ]
        })
      )
    });
  }

  async function newReturnModal() {
    const [whs, prods, orders] = await Promise.all([
      api.get('/warehouses'),
      api.get('/products'),
      api.get('/orders')
    ]);

    formModal({
      title: 'Initiate Product Return (RMA)',
      submitLabel: 'Create Return Request',
      wide: true,
      fields: [
        { name: 'customerName', label: 'Customer Name', required: true, half: true, placeholder: 'e.g. Johnathan Smith' },
        { name: 'customerEmail', label: 'Customer Email', type: 'email', half: true, placeholder: 'customer@example.com' },
        { name: 'orderId', label: 'Original Order Ref', type: 'select', numeric: true, nullEmpty: true, half: true, options: [{ value: '', label: 'Standalone / No Order Ref' }, ...orders.items.map(o => ({ value: o.id, label: `${o.number} · ${o.customer_name}` }))] },
        { name: 'warehouseId', label: 'Receiving Warehouse', type: 'select', numeric: true, required: true, half: true, options: whs.items.map(w => ({ value: w.id, label: `${w.name} (${w.code})` })) },
        { name: 'reason', label: 'Return Reason', type: 'select', required: true, half: true, options: RETURN_REASONS.map(r => ({ value: r, label: fmt.label(r) })) },
        { name: 'refundAmount', label: 'Refund Amount ($)', type: 'number', half: true, min: 0, step: 0.01, value: 0 },
        { name: 'productId', label: 'Returned Product', type: 'select', numeric: true, required: true, half: true, options: prods.items.map(p => ({ value: p.id, label: `${p.sku} · ${p.name}` })) },
        { name: 'quantity', label: 'Return Units', type: 'number', required: true, half: true, min: 1, value: 1 },
        { name: 'condition', label: 'Condition upon arrival', type: 'select', required: true, half: true, options: [{ value: 'unopened', label: 'Unopened / Mint' }, { value: 'opened_good', label: 'Opened (Good / Resellable)' }, { value: 'damaged', label: 'Damaged Packaging / Scuffed' }, { value: 'defective', label: 'Defective / Broken' }] },
        { name: 'notes', label: 'Customer Return Notes', type: 'textarea' }
      ],
      onSubmit: async (v, m) => {
        const payload = {
          customerName: v.customerName,
          customerEmail: v.customerEmail || null,
          orderId: v.orderId ? Number(v.orderId) : null,
          warehouseId: v.warehouseId,
          reason: v.reason,
          refundAmount: v.refundAmount || 0,
          notes: v.notes || null,
          items: [{ productId: v.productId, quantity: v.quantity, condition: v.condition }]
        };
        await api.post('/returns', payload);
        m.close();
        toast('Return Request Logged', 'Awaiting quality inspection and approval', 'success');
        refresh();
      }
    });
  }

  async function inspectModal(ret) {
    formModal({
      title: `Inspect Return ${ret.number}`,
      submitLabel: 'Save Inspection & Decision',
      fields: [
        { name: 'decision', label: 'Inspection Decision', type: 'select', required: true, options: [{ value: 'approve', label: 'Approve Return (Eligible for Restock / Refund)' }, { value: 'reject', label: 'Reject Return (Item damaged by customer / Ineligible)' }] },
        { name: 'refundAmount', label: 'Approved Refund Amount ($)', type: 'number', min: 0, step: 0.01, value: ret.refund_amount || 0 },
        { name: 'condition', label: 'Verified Item Condition', type: 'select', options: [{ value: 'unopened', label: 'Unopened / Sealed' }, { value: 'opened_good', label: 'Opened Good Condition' }, { value: 'damaged', label: 'Damaged' }, { value: 'defective', label: 'Defective' }] },
        { name: 'inspectionNotes', label: 'Quality Control Notes', type: 'textarea', placeholder: 'Detail the physical inspection findings here...' }
      ],
      onSubmit: async (v, m) => {
        const approved = v.decision === 'approve';
        const itemConditions = ret.items.map(it => ({ itemId: it.id, condition: v.condition || it.condition }));
        await api.patch(`/returns/${ret.id}/inspect`, {
          approved,
          refundAmount: Number(v.refundAmount),
          inspectionNotes: v.inspectionNotes || null,
          itemConditions
        });
        m.close();
        toast(approved ? 'Return Approved' : 'Return Rejected', `Status updated to ${approved ? 'approved' : 'rejected'}`, approved ? 'success' : 'warning');
        refresh();
      }
    });
  }

  async function restockModal(ret) {
    const wh = await api.get(`/warehouse?warehouseId=${ret.warehouse_id}`);
    const racks = wh.sections.flatMap(s => s.racks).map(r => ({ value: r.id, label: `Rack ${r.code} (${r.status})` }));

    const unstockedItems = ret.items.filter(it => it.quantity > it.restocked_quantity);
    if (!unstockedItems.length) {
      toast('All Items Restocked', 'All returned units have already been restored to racks', 'info');
      return;
    }

    formModal({
      title: `Restock Goods for Return ${ret.number}`,
      submitLabel: 'Confirm Shelf Restock',
      fields: [
        { name: 'itemId', label: 'Item to Restock', type: 'select', numeric: true, required: true, options: unstockedItems.map(it => ({ value: it.id, label: `${it.sku} · ${it.product_name} (${it.quantity - it.restocked_quantity} ${it.unit} pending)` })) },
        { name: 'quantity', label: 'Restock Quantity', type: 'number', required: true, half: true, min: 1, value: unstockedItems[0].quantity - unstockedItems[0].restocked_quantity },
        { name: 'rackId', label: 'Destination Rack', type: 'select', numeric: true, required: true, half: true, options: racks },
        { name: 'batchNo', label: 'Restock Batch Tag', half: true, placeholder: 'e.g. RET-RESTOCK-01' }
      ],
      onSubmit: async (v, m) => {
        await api.post(`/returns/${ret.id}/restock`, {
          allocations: [{ itemId: v.itemId, quantity: v.quantity, rackId: v.rackId, batchNo: v.batchNo }]
        });
        m.close();
        toast('Stock Restocked', 'Returned items successfully added back to inventory', 'success');
        refresh();
      }
    });
  }

  async function paint() {
    const params = { status: statusFilter || undefined };
    const rets = await api.get('/returns', params);

    return h('div', null,
      h('div', { class: 'chips', style: { marginBottom: '14px' } },
        [['', 'All Statuses'], ['requested', 'Requested'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['restocked', 'Restocked']].map(([v, l]) =>
          h('button', {
            class: `chip ${statusFilter === v ? 'active' : ''}`,
            onClick: () => { statusFilter = v; refresh(); }
          }, l)
        )
      ),
      table({
        rows: rets.items,
        empty: 'No product return requests logged',
        columns: [
          { label: 'Return ID', render: (r) => h('a', { href: '#', onClick: (e) => { e.preventDefault(); returnDetail(r.id); }, style: { fontWeight: 700 } }, r.number) },
          { label: 'Customer', render: (r) => h('div', null, h('b', null, r.customer_name), h('div', { class: 'muted' }, r.customer_email || '–')) },
          { label: 'Order Ref', render: (r) => r.order_number ? h('span', { class: 'mono' }, r.order_number) : h('span', { class: 'muted' }, 'Direct RMA') },
          { label: 'Reason', render: (r) => badge(fmt.label(r.reason), 'amber') },
          { label: 'Status', render: (r) => badge(r.status, r.status === 'restocked' ? 'green' : r.status === 'approved' ? 'blue' : r.status === 'rejected' ? 'red' : 'gray') },
          { label: 'Units', render: (r) => `${fmt.n(r.total_restocked)} / ${fmt.n(r.total_units)}` },
          { label: 'Refund', render: (r) => fmt.money(r.refund_amount) },
          write && {
            label: '',
            actions: true,
            render: (r) => [
              r.status === 'requested' && btn('Inspect', () => inspectModal(r), { sm: true, kind: 'primary', ic: 'check' }),
              r.status === 'approved' && btn('Restock to Rack', () => restockModal(r), { sm: true, kind: 'primary', ic: 'layers' }),
              btn('Details', () => returnDetail(r.id), { sm: true })
            ].filter(Boolean)
          }
        ].filter(Boolean)
      })
    );
  }

  const refresh = async () => {
    try { mount(content, await paint()); }
    catch (e) { mount(content, h('div', { class: 'card empty' }, e.message)); }
  };

  mount(
    root,
    pageHead(
      'Product Returns (RMA) Management',
      'Log customer return requests, inspect item condition, approve refunds, and restock goods back into warehouse racks',
      write && btn('Record Return Request', newReturnModal, { kind: 'primary', ic: 'plus' })
    ),
    content
  );

  await load(content, paint);
  return { refresh };
}
