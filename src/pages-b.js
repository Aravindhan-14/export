/* ==========================================================================
   pages-b.js — Order confirmation, Purchase orders, Order pools & allocation,
   Expense workspace, Missing & additional items.
   ========================================================================== */
(function (G) {
  'use strict';
  const SP = G.SP;
  const { Store, svc, D, sum, Calc, Fmt, AppError, can, UI, App, Pages, byId, H } = SP;
  const { esc, $, $$, ico, toast, modal, confirm, ask, run, form, read, table, act, badge, status, testTag, signed, pageHead, btn, guard, empty, fmtDate, fmtDT } = UI;

  const sizesText = (l) => Object.entries(l.sizes || {}).map(([k, v]) => `${k}:${v}`).join(' · ');

  /* ======================= ORDER CONFIRMATION ======================= */
  App.route('confirmations', 'orders.view', async (view, q) => {
    view.innerHTML = pageHead('Order Confirmation', 'Confirmed orders per PO, style and combo with size-wise quantities. Confirmed price is stored separately from the quoted price.', guard('orders.edit', btn('Confirm order', 'id="addL"', 'primary', 'plus')) + guard('import.run', btn('Import CSV', 'id="impL"', '', 'dl'))) +
      (q.ship === 'pending' ? `<div class="notice warn">Showing confirmed orders that are not finally shipped. <a href="#/confirmations">Show all</a></div>` : '') + '<div class="card"><div class="bd p0" id="lt"></div></div>';
    table($('#lt', view), {
      id: 'lines', exportName: 'order-confirmations', sort: { key: 'confNo', dir: 'desc' },
      rows: () => Store.db.lines.filter((l) => q.ship !== 'pending' || (l.status === 'CONFIRMED' && (() => { const m = SP.lineMetrics(Store.db, l); return !m.finalShipped && m.remainingShip > 0; })())),
      initialFilters: { buyerId: q.buyer || '', styleId: q.style || '', status: q.status || '', season: q.season || '', poId: q.po || '' },
      filters: [{ key: 'buyerId', label: 'Buyer', options: H.allBuyerOpts }, { key: 'season', label: 'Season', options: H.seasonOpts, get: (r) => H.style(r.styleId).season }, { key: 'styleId', label: 'Style', options: () => H.styleOpts(null, true) }, { key: 'poId', label: 'PO', options: () => Store.db.pos.map((p) => ({ value: p.id, label: p.poNumber })) }, { key: 'status', label: 'Status', options: ['DRAFT', 'CONFIRMED', 'CANCELLED'] }],
      columns: [
        { key: 'confNo', label: 'Conf. ID', render: (r) => `<span class="mono">${esc(r.confNo)}</span>${testTag(r)}` },
        { key: 'po', label: 'PO', value: (r) => H.po(r.poId).poNumber, render: (r) => `<a href="#/pos/view?id=${r.poId}">${esc(H.po(r.poId).poNumber)}</a>` },
        { key: 'buyer', label: 'Buyer', value: (r) => H.buyer(r.buyerId).name, hideSm: true }, { key: 'season', label: 'Season', value: (r) => H.style(r.styleId).season, hideSm: true },
        { key: 'style', label: 'Style', value: (r) => H.style(r.styleId).styleRef, render: (r) => `<b>${esc(H.style(r.styleId).styleRef)}</b><div class="small muted">${esc(H.style(r.styleId).description || '')}</div>`, wrap: true },
        { key: 'combo', label: 'Combo' }, { key: 'sizes', label: 'Sizes', value: sizesText, hideSm: true, wrap: true, render: (r) => `<span class="small">${esc(sizesText(r)) || (r.qtyMode === 'MANUAL' ? '<i>manual</i>' : '—')}</span>` },
        { key: 'orderQty', label: 'Order qty', num: true, render: (r) => Fmt.qty(r.orderQty) },
        { key: 'quotedPrice', label: 'Quoted', num: true, hideSm: true, render: (r) => Fmt.money(r.quotedPrice, r.currency) },
        { key: 'confirmedPrice', label: 'Confirmed', num: true, render: (r) => `<b>${Fmt.money(r.confirmedPrice, r.currency)}</b>` },
        { key: 'confirmationDate', label: 'Date', render: (r) => fmtDate(r.confirmationDate) },
        { key: 'alloc', label: 'Pooled', num: true, value: (r) => SP.lineMetrics(Store.db, r).allocated, render: (r) => Fmt.qty(SP.lineMetrics(Store.db, r).allocated), hideSm: true },
        { key: 'ship', label: 'Shipped', num: true, value: (r) => SP.lineMetrics(Store.db, r).shipped, render: (r) => Fmt.qty(SP.lineMetrics(Store.db, r).shipped), hideSm: true },
        { key: 'status', label: 'Status', render: (r) => status(r.status) },
      ],
      actions: (r) => act('view', '', '', 'eye', false, 'View') + guard('orders.edit', act('edit', '', '', 'edit', false, 'Edit')) + guard('orders.delete', act('del', '', 'danger', 'trash', false, 'Delete')),
      on: {
        view: (r) => viewLine(r), edit: (r) => Pages.editLine(r),
        del: async (r) => { if (await confirm(`Delete order ${esc(r.confNo)}? Only orders without allocation history or shipments can be deleted; otherwise set the status to Cancelled.`, { danger: true, ok: 'Delete' })) run(null, async () => { await svc.deleteLine(r.id); toast('Deleted', 'ok'); }); },
      },
    });
    const a = $('#addL', view); if (a) a.onclick = () => Pages.editLine(null, { poId: q.po });
    const ib = $('#impL', view); if (ib) ib.onclick = () => Pages.importDialog('orders');
    if (q.view) { UI.consume('view'); const l = byId(Store.db, 'lines', q.view); if (l) viewLine(l); }
  });
  Pages.editLine = (l, preset) => {
    const db = Store.db;
    const v0 = l ? Object.assign({}, l) : Object.assign({ status: 'CONFIRMED', qtyMode: 'SIZE', confirmationDate: SP.today(), sizes: {} }, preset || {});
    const m = modal({
      title: l ? `Edit order ${l.confNo}` : 'Confirm order', size: 'xl',
      body: `<div class="form-grid">
        ${UI.field({ name: 'poId', label: 'PO number', type: 'select', search: true, required: true, span: 's4', options: db.pos.filter((p) => p.status !== 'CANCELLED' || p.id === v0.poId).map((p) => ({ value: p.id, label: `${p.poNumber} — ${H.buyer(p.buyerId).name}` })), help: can('orders.edit') ? '<a href="#" id="newPO">+ New PO</a>' : '' }, v0.poId)}
        ${UI.field({ name: 'styleId', label: 'Style', type: 'select', search: true, required: true, span: 's4', options: [] }, v0.styleId)}
        ${UI.field({ name: 'combo', label: 'Combo / colour', required: true, span: 's4' }, v0.combo)}
        ${UI.field({ name: 'quoteId', label: 'Linked quotation (costing version)', type: 'select', span: 's4', options: [] }, v0.quoteId)}
        ${UI.field({ name: 'quoted', label: 'Quoted price', type: 'static', span: 's2', html: '<span id="qp">—</span>' })}
        ${UI.field({ name: 'confirmedPrice', label: 'Confirmed price', type: 'decimal', required: true, span: 's2' }, v0.confirmedPrice)}
        ${UI.field({ name: 'currency', label: 'Currency', type: 'select', options: H.currencyOpts(), placeholder: false, span: 's2' }, v0.currency)}
        ${UI.field({ name: 'confirmationDate', label: 'Confirmation date', type: 'date', span: 's2' }, v0.confirmationDate)}
        ${UI.field({ name: 'status', label: 'Status', type: 'select', options: ['CONFIRMED', 'DRAFT', 'CANCELLED'], placeholder: false, span: 's3' }, v0.status)}
        ${UI.field({ name: 'qtyMode', label: 'Quantity entry', type: 'select', options: [{ value: 'SIZE', label: 'Size-wise (total calculated)' }].concat(can('orders.manualQty') || v0.qtyMode === 'MANUAL' ? [{ value: 'MANUAL', label: 'Manual total (authorised)' }] : []), placeholder: false, span: 's3' }, v0.qtyMode)}
        ${UI.field({ name: 'manualQty', label: 'Manual order quantity', type: 'int', span: 's3', min: 1 }, v0.qtyMode === 'MANUAL' ? v0.orderQty : '')}
        ${UI.field({ name: 'tot', label: 'Total order quantity', type: 'static', span: 's3', html: '<b id="totQ">0</b> pcs' })}
        <div class="fld s12"><label>Size-wise quantities</label><div id="sizeGrid" class="table-wrap"></div><div class="help" id="sizeHelp"></div></div>
        ${UI.field({ name: 'remarks', label: 'Confirmation remarks', type: 'textarea', span: 's8' }, v0.remarks)}
        ${l ? UI.field({ name: 'changeReason', label: 'Reason for change (audit)', type: 'textarea', span: 's4', help: 'Recorded in the audit log and price history' }) : ''}
      </div>`,
      actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: async (mm) => {
        const v = read(mm.el); const sizes = {};
        $$('[data-size]', mm.el).forEach((i) => { if (i.value.trim() !== '') sizes[i.dataset.size] = i.value.trim(); });
        delete v.quoted; delete v.tot;
        const saved = await svc.saveLine(Object.assign(v, { id: l && l.id, sizes }));
        toast(`${saved.confNo} saved`, 'ok');
      } }],
    });
    const el = m.el;
    const S = (n) => $(`[name=${n}]`, el);
    const fillStyles = () => { const po = byId(Store.db, 'pos', S('poId').value); UI.setOptions(S('styleId'), po ? H.styleOpts(po.buyerId) : [], v0.styleId, po ? '— Select style —' : '— Select a PO first —'); };
    const fillQuotes = () => {
      const qs = Store.db.quotes.filter((x) => x.styleId === S('styleId').value).sort((a, b) => b.revisionNo - a.revisionNo);
      UI.setOptions(S('quoteId'), qs.map((x) => ({ value: x.id, label: `${x.quoteNo} ${x.label} — ${Fmt.money(x.quotedPrice, x.currency)} (${x.status})` })), v0.quoteId || (qs.find((x) => x.status === 'ACCEPTED') || qs[0] || {}).id, qs.length ? '— Select quote —' : 'No quotes for this style');
      quoteChanged(true);
    };
    const quoteChanged = (initial) => {
      const qq = byId(Store.db, 'quotes', S('quoteId').value);
      $('#qp', el).innerHTML = qq ? `${Fmt.money(qq.quotedPrice, qq.currency)} <span class="small muted">${esc(qq.label)}</span>` : '—';
      if (qq && (!initial || !l)) { if (!S('confirmedPrice').value || !initial) S('confirmedPrice').value = S('confirmedPrice').value || qq.quotedPrice; S('currency').value = qq.currency; }
    };
    const drawSizes = () => {
      const st = byId(Store.db, 'styles', S('styleId').value);
      const sizes = st && st.sizes && st.sizes.length ? st.sizes.slice() : Object.keys(v0.sizes || {});
      Object.keys(v0.sizes || {}).forEach((k) => { if (!sizes.includes(k)) sizes.push(k); });
      $('#sizeGrid', el).innerHTML = sizes.length ? `<table class="t"><thead><tr>${sizes.map((s) => `<th class="num">${esc(s)}</th>`).join('')}<th class="num">Total</th></tr></thead><tbody><tr>${sizes.map((s) => `<td><input class="cell num" data-size="${esc(s)}" inputmode="numeric" value="${esc((v0.sizes || {})[s] !== undefined ? v0.sizes[s] : '')}" aria-label="Size ${esc(s)}"></td>`).join('')}<td class="num"><b id="sizeTot">0</b></td></tr></tbody></table>` : '<div class="empty small">Select a style with a size set (Style Master), or use manual entry.</div>';
      $$('[data-size]', el).forEach((i) => i.addEventListener('input', total));
      total();
    };
    const total = () => {
      let t = 0, bad = false;
      $$('[data-size]', el).forEach((i) => { const n = i.value.trim() === '' ? 0 : Number(i.value); const ok = Number.isInteger(n) && n >= 0; i.classList.toggle('invalid', !ok); if (ok) t += n; else bad = true; });
      const st = $('#sizeTot', el); if (st) st.textContent = bad ? '!' : Fmt.qty(t);
      const manual = S('qtyMode').value === 'MANUAL';
      S('manualQty').closest('.fld').classList.toggle('hidden', !manual);
      const mq = Number(S('manualQty').value || 0);
      $('#totQ', el).textContent = manual ? Fmt.qty(mq) : (bad ? 'invalid' : Fmt.qty(t));
      $('#sizeHelp', el).innerHTML = manual ? (t && t !== mq ? `<span class="neg">Size total ${t} ≠ manual quantity ${mq} — they must match, or clear the sizes.</span>` : 'Manual mode: sizes are optional; if entered they must add up to the manual quantity.') : 'Total order quantity is calculated from the sizes.';
    };
    S('poId').addEventListener('change', () => { v0.styleId = ''; fillStyles(); fillQuotes(); drawSizes(); });
    S('styleId').addEventListener('change', () => { v0.quoteId = ''; fillQuotes(); drawSizes(); });
    S('quoteId').addEventListener('change', () => quoteChanged(false));
    S('qtyMode').addEventListener('change', total); S('manualQty').addEventListener('input', total);
    const np = $('#newPO', el); if (np) np.onclick = (e) => { e.preventDefault(); Pages.editPO(null, (po) => { UI.setOptions(S('poId'), Store.db.pos.map((p) => ({ value: p.id, label: `${p.poNumber} — ${H.buyer(p.buyerId).name}` })), po.id); fillStyles(); }); };
    fillStyles(); fillQuotes(); drawSizes();
  };
  function viewLine(l) {
    const m = SP.lineMetrics(Store.db, l);
    const hist = Store.db.priceHistory.filter((h) => h.lineId === l.id);
    const qq = byId(Store.db, 'quotes', l.quoteId), cv = byId(Store.db, 'costings', l.costingId);
    modal({
      title: `Order ${l.confNo}`, size: 'lg',
      body: `<dl class="dl"><dt>PO</dt><dd><a href="#/pos/view?id=${l.poId}">${esc(H.po(l.poId).poNumber)}</a></dd><dt>Buyer</dt><dd>${esc(H.buyer(l.buyerId).name)}</dd><dt>Style</dt><dd>${esc(H.style(l.styleId).styleRef)} — ${esc(H.style(l.styleId).description || '')}</dd><dt>Combo</dt><dd>${esc(l.combo)}</dd>
        <dt>Sizes</dt><dd>${esc(sizesText(l)) || '—'} (${l.qtyMode === 'MANUAL' ? 'manual total' : 'size-wise'})</dd><dt>Order quantity</dt><dd><b>${Fmt.qty(l.orderQty)}</b></dd>
        <dt>Quotation</dt><dd>${qq ? `${esc(qq.quoteNo)} ${esc(qq.label)} — ${Fmt.money(qq.quotedPrice, qq.currency)}` : '—'}</dd><dt>Costing version</dt><dd>${cv ? `<a href="#/costing/edit?id=${cv.id}">${esc(cv.label)}</a> (₹${Fmt.num(cv.results.totalInr)})` : '—'}</dd>
        <dt>Confirmed price</dt><dd><b>${Fmt.money(l.confirmedPrice, l.currency)}</b> on ${fmtDate(l.confirmationDate)}</dd><dt>Status</dt><dd>${status(l.status)}${testTag(l)}</dd><dt>Remarks</dt><dd>${esc(l.remarks || '—')}</dd></dl>
        <h3 style="margin:14px 0 6px">Quantities</h3><table class="t"><tbody><tr><td>Allocated to pools</td><td class="num">${Fmt.qty(m.allocated)}</td></tr><tr><td>Remaining pool-eligible</td><td class="num">${Fmt.qty(m.remainingPool)}</td></tr><tr><td>Shipped</td><td class="num">${Fmt.qty(m.shipped)}</td></tr><tr><td>Remaining to ship</td><td class="num">${Fmt.qty(m.remainingShip)}</td></tr></tbody></table>
        <h3 style="margin:14px 0 6px">Confirmed price history</h3>${hist.length ? `<table class="t"><thead><tr><th>When</th><th>By</th><th class="num">Old</th><th class="num">New</th><th>Reason</th></tr></thead><tbody>${hist.map((h) => `<tr><td>${fmtDT(h.at)}</td><td>${esc(h.by)}</td><td class="num">${Fmt.money(h.oldPrice, h.oldCurrency)}</td><td class="num">${Fmt.money(h.newPrice, h.newCurrency)}</td><td>${esc(h.reason || '')}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No changes.</p>'}`,
      actions: [{ label: 'Close' }].concat(can('orders.edit') ? [{ label: 'Edit', cls: 'primary', onClick: (mm) => { mm.close(); Pages.editLine(l); return false; } }] : []),
    });
  }

  /* ======================= PURCHASE ORDERS ======================= */
  const poTotals = (p) => {
    const lines = Store.db.lines.filter((l) => l.poId === p.id && l.status !== 'CANCELLED');
    const ms = lines.map((l) => SP.lineMetrics(Store.db, l));
    return { lines: lines.length, qty: lines.reduce((a, l) => a + l.orderQty, 0), alloc: ms.reduce((a, m) => a + m.allocated, 0), shipped: ms.reduce((a, m) => a + m.shipped, 0), remainShip: ms.reduce((a, m) => a + m.remainingShip, 0) };
  };
  App.route('pos', 'orders.view', async (view, q) => {
    view.innerHTML = pageHead('Purchase Orders', 'PO headers with their order lines, pool allocation and shipment progress.', guard('orders.edit', btn('Add PO', 'id="addP"', 'primary', 'plus'))) + '<div class="card"><div class="bd p0" id="pt"></div></div>';
    table($('#pt', view), {
      id: 'pos', exportName: 'purchase-orders', rows: () => Store.db.pos, sort: { key: 'poDate', dir: 'desc' },
      initialFilters: { buyerId: q.buyer || '' },
      filters: [{ key: 'buyerId', label: 'Buyer', options: H.allBuyerOpts }, { key: 'season', label: 'Season', options: H.seasonOpts }, { key: 'status', label: 'Status', options: ['OPEN', 'CLOSED', 'CANCELLED'] }],
      columns: [
        { key: 'poNumber', label: 'PO number', render: (r) => `<a href="#/pos/view?id=${r.id}"><b>${esc(r.poNumber)}</b></a>${testTag(r)}` },
        { key: 'buyer', label: 'Buyer', value: (r) => H.buyer(r.buyerId).name }, { key: 'season', label: 'Season' }, { key: 'poDate', label: 'PO date', render: (r) => fmtDate(r.poDate) },
        { key: 'lines', label: 'Lines', num: true, value: (r) => poTotals(r).lines },
        { key: 'qty', label: 'Order qty', num: true, value: (r) => poTotals(r).qty, render: (r) => Fmt.qty(poTotals(r).qty) },
        { key: 'alloc', label: 'Pooled', num: true, value: (r) => poTotals(r).alloc, render: (r) => Fmt.qty(poTotals(r).alloc), hideSm: true },
        { key: 'unalloc', label: 'Unallocated', num: true, value: (r) => poTotals(r).qty - poTotals(r).alloc, render: (r) => Fmt.qty(poTotals(r).qty - poTotals(r).alloc), hideSm: true },
        { key: 'shipped', label: 'Shipped', num: true, value: (r) => poTotals(r).shipped, render: (r) => Fmt.qty(poTotals(r).shipped) },
        { key: 'status', label: 'Status', render: (r) => status(r.status) },
      ],
      onRow: (r) => App.go('pos/view', { id: r.id }),
      actions: (r) => act('open', 'Open') + guard('orders.edit', act('edit', '', '', 'edit', false, 'Edit')) + guard('orders.delete', act('del', '', 'danger', 'trash', false, 'Delete')),
      on: {
        open: (r) => App.go('pos/view', { id: r.id }), edit: (r) => Pages.editPO(r),
        del: async (r) => { if (await confirm(`Delete PO ${esc(r.poNumber)}?`, { danger: true, ok: 'Delete' })) run(null, async () => { await svc.deletePO(r.id); toast('PO deleted', 'ok'); }); },
      },
    });
    const a = $('#addP', view); if (a) a.onclick = () => Pages.editPO();
  });
  Pages.editPO = (p, after) => {
    modal({
      title: p ? `Edit PO ${p.poNumber}` : 'Add PO',
      body: form([
        { name: 'poNumber', label: 'PO number', required: true, span: 's6' }, { name: 'buyerId', label: 'Buyer', type: 'select', search: true, options: H.buyerOpts(p && p.buyerId), required: true, span: 's6' },
        { name: 'season', label: 'Season', span: 's4' }, { name: 'poDate', label: 'PO date', type: 'date', span: 's4' }, { name: 'status', label: 'Status', type: 'select', options: ['OPEN', 'CLOSED', 'CANCELLED'], placeholder: false, span: 's4' },
        { name: 'remarks', label: 'Remarks', type: 'textarea', span: 's12' },
      ], p || { status: 'OPEN', poDate: SP.today() }),
      actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: async (m) => { const x = await svc.savePO(Object.assign(read(m.el), { id: p && p.id })); toast(`PO ${x.poNumber} saved`, 'ok'); if (after) after(x); } }],
    });
  };
  App.route('pos/view', 'orders.view', async (view, q) => {
    const p = byId(Store.db, 'pos', q.id);
    if (!p) { view.innerHTML = empty('PO not found', '', '<a class="btn" href="#/pos">Back</a>'); return; }
    const t = poTotals(p);
    view.innerHTML = pageHead(`PO ${p.poNumber}`, `${esc(H.buyer(p.buyerId).name)} · Season ${esc(p.season || '—')} · ${fmtDate(p.poDate)} ${status(p.status)}${testTag(p)}`, guard('orders.edit', btn('Add order line', 'id="addLn"', 'primary', 'plus') + btn('Edit PO', 'id="edPO"')), '<a href="#/pos">Purchase Orders</a> / ' + esc(p.poNumber)) +
      `<div class="kpis"><div class="kpi"><div class="l">Order lines</div><div class="v">${t.lines}</div></div><div class="kpi"><div class="l">Order qty</div><div class="v">${Fmt.qty(t.qty)}</div></div><div class="kpi"><div class="l">Allocated to pools</div><div class="v">${Fmt.qty(t.alloc)}</div></div><div class="kpi"><div class="l">Unallocated</div><div class="v">${Fmt.qty(t.qty - t.alloc)}</div></div><div class="kpi"><div class="l">Shipped</div><div class="v">${Fmt.qty(t.shipped)}</div></div><div class="kpi"><div class="l">Remaining to ship</div><div class="v">${Fmt.qty(t.remainShip)}</div></div></div>
      ${p.remarks ? `<div class="notice info">${esc(p.remarks)}</div>` : ''}<div class="card"><div class="hd"><h2>PO lines</h2></div><div class="bd p0" id="pl"></div></div>`;
    table($('#pl', view), {
      id: 'po-lines-' + p.id, rows: () => Store.db.lines.filter((l) => l.poId === p.id), exportName: `po-${p.poNumber}`,
      columns: [
        { key: 'confNo', label: 'Conf. ID', render: (r) => `<span class="mono">${esc(r.confNo)}</span>` },
        { key: 'style', label: 'Style', value: (r) => H.style(r.styleId).styleRef, render: (r) => `<b>${esc(H.style(r.styleId).styleRef)}</b><div class="small muted">${esc(H.style(r.styleId).description || '')}</div>`, wrap: true },
        { key: 'combo', label: 'Combo' }, { key: 'sizes', label: 'Sizes', value: sizesText, wrap: true, render: (r) => `<span class="small">${esc(sizesText(r))}</span>` },
        { key: 'orderQty', label: 'Order qty', num: true },
        { key: 'confirmedPrice', label: 'Confirmed price', num: true, render: (r) => Fmt.money(r.confirmedPrice, r.currency) }, { key: 'currency', label: 'Cur.' },
        { key: 'confirmationDate', label: 'Confirmed', render: (r) => fmtDate(r.confirmationDate) },
        { key: 'alloc', label: 'Allocated', num: true, value: (r) => SP.lineMetrics(Store.db, r).allocated },
        { key: 'remPool', label: 'Remaining unallocated', num: true, value: (r) => SP.lineMetrics(Store.db, r).remainingPool },
        { key: 'shipped', label: 'Shipped', num: true, value: (r) => SP.lineMetrics(Store.db, r).shipped },
        { key: 'remShip', label: 'Remaining to ship', num: true, value: (r) => SP.lineMetrics(Store.db, r).remainingShip, render: (r) => { const m = SP.lineMetrics(Store.db, r); return `${Fmt.qty(m.remainingShip)}${m.shipDiff > 0 ? `<div class="small neg">excess ${m.shipDiff}</div>` : ''}`; } },
        { key: 'status', label: 'Status', render: (r) => status(r.status) },
      ],
      footer: (rows) => `<td colspan="4">Total</td><td class="num">${Fmt.qty(rows.reduce((a, r) => a + r.orderQty, 0))}</td><td colspan="9"></td>`,
      actions: () => act('edit', '', '', 'edit', false, 'Edit') + guard('orders.delete', act('del', '', 'danger', 'trash', false, 'Delete')),
      on: {
        edit: (r) => Pages.editLine(r),
        del: async (r) => { if (await confirm(`Delete ${esc(r.confNo)}?`, { danger: true, ok: 'Delete' })) run(null, async () => { await svc.deleteLine(r.id); toast('Deleted', 'ok'); }); },
      },
    });
    const al = $('#addLn', view); if (al) al.onclick = () => Pages.editLine(null, { poId: p.id });
    const ep = $('#edPO', view); if (ep) ep.onclick = () => Pages.editPO(p);
  });

  /* ======================= ORDER POOLS ======================= */
  App.route('pools', 'pools.view', async (view, q) => {
    view.innerHTML = pageHead('Order Pool Management', `Pools group confirmed PO quantities for expense tracking and profitability. Numbers are generated automatically (${esc(Store.db.settings.poolPrefix)}-001…).`, guard('pools.edit', btn('New pool', 'id="addPool"', 'primary', 'plus'))) + '<div class="card"><div class="bd p0" id="plt"></div></div>';
    table($('#plt', view), {
      id: 'pools', exportName: 'pools', sort: { key: 'poolNo', dir: 'desc' },
      rows: () => Store.db.pools.filter((p) => q.status !== 'open' || !['CLOSED', 'CANCELLED'].includes(p.status)),
      initialFilters: { buyerId: q.buyer || '', status: q.status && q.status !== 'open' ? q.status : '' },
      filters: [{ key: 'buyerId', label: 'Buyer', options: H.allBuyerOpts }, { key: 'season', label: 'Season', options: H.seasonOpts }, { key: 'status', label: 'Status', options: ['DRAFT', 'ACTIVE', 'CLOSED', 'REOPENED', 'CANCELLED'] }],
      columns: [
        { key: 'poolNo', label: 'Pool', render: (r) => `<a href="#/pools/view?id=${r.id}"><b>${esc(r.poolNo)}</b></a>${testTag(r)}` },
        { key: 'buyer', label: 'Buyer', value: (r) => H.buyer(r.buyerId).name }, { key: 'season', label: 'Season' },
        { key: 'createdAt', label: 'Created', render: (r) => fmtDate(r.createdAt) },
        { key: 'styles', label: 'Styles', wrap: true, value: (r) => Array.from(new Set(Store.db.allocations.filter((a) => a.poolId === r.id && a.status === 'ACTIVE').map((a) => H.style(byId(Store.db, 'lines', a.lineId).styleId).styleRef))).join(', ') },
        { key: 'qty', label: 'Allocated qty', num: true, value: (r) => Store.db.allocations.filter((a) => a.poolId === r.id && a.status === 'ACTIVE').reduce((x, a) => x + a.qty, 0), render: (r) => Fmt.qty(Store.db.allocations.filter((a) => a.poolId === r.id && a.status === 'ACTIVE').reduce((x, a) => x + a.qty, 0)) },
        { key: 'pend', label: 'Open items', num: true, value: (r) => Store.db.exceptions.filter((x) => x.poolId === r.id && x.status === 'PENDING').length, render: (r) => { const n = Store.db.exceptions.filter((x) => x.poolId === r.id && x.status === 'PENDING').length; return n ? badge(n + ' pending', 'warn') : '—'; } },
        { key: 'status', label: 'Status', render: (r) => status(r.status) }, { key: 'createdBy', label: 'Created by', hideSm: true },
      ],
      onRow: (r) => App.go('pools/view', { id: r.id }),
      actions: () => act('open', 'Open'),
      on: { open: (r) => App.go('pools/view', { id: r.id }) },
    });
    const a = $('#addPool', view);
    if (a) a.onclick = () => modal({
      title: 'New order pool', body: form([{ name: 'buyerId', label: 'Buyer', type: 'select', search: true, options: H.buyerOpts(), required: true, span: 's12' }, { name: 'season', label: 'Season', span: 's6', attrs: 'list="seasonL"' }, { name: 'remarks', label: 'Remarks', type: 'textarea', span: 's12' }]) + `<datalist id="seasonL">${H.seasonOpts().map((o) => `<option value="${esc(o.value)}">`).join('')}</datalist><p class="help">The pool starts as a draft. Add allocations, then activate it.</p>`,
      actions: [{ label: 'Cancel' }, { label: 'Create pool', cls: 'primary', onClick: async (m) => { const p = await svc.createPool(read(m.el)); toast(`${p.poolNo} created`, 'ok'); App.go('pools/view', { id: p.id }); } }],
    });
  });
  App.route('pools/view', 'pools.view', async (view, q) => {
    const db = Store.db;
    const p = byId(db, 'pools', q.id);
    if (!p) { view.innerHTML = empty('Pool not found', '', '<a class="btn" href="#/pools">Back</a>'); return; }
    const r = SP.computePool(db, p.id);
    const editable = !['CLOSED', 'CANCELLED'].includes(p.status);
    const exc = db.exceptions.filter((x) => x.poolId === p.id && !['ACCEPTED', 'RESOLVED'].includes(x.status));
    view.innerHTML = pageHead(`Pool ${p.poolNo}`, `${esc(H.buyer(p.buyerId).name)} · Season ${esc(p.season || '—')} · created ${fmtDate(p.createdAt)} by ${esc(p.createdBy)} ${status(p.status)}${testTag(p)}`,
      (editable ? guard('pools.allocate', btn('Add allocations', 'id="addA"', 'primary', 'plus')) + (p.status === 'DRAFT' ? guard('pools.edit', btn('Activate pool', 'id="actP"', 'accent')) : '') + guard('pools.edit', btn('Edit', 'id="edP"')) + (p.status !== 'CLOSED' ? guard('pools.edit', btn('Cancel pool', 'id="cnP"', 'danger')) : '') : ''),
      `<a href="#/pools">Pools</a> / ${esc(p.poolNo)}`) +
      (exc.length ? `<div class="notice warn"><b>${exc.length} missing / additional item(s) need a decision</b> before closure: ${exc.slice(0, 6).map((x) => `${esc(x.itemName)} (${x.type.toLowerCase()}, ${x.status.toLowerCase()})`).join(', ')}${exc.length > 6 ? '…' : ''} — <a href="#/exceptions?pool=${p.id}">review</a></div>` : '') +
      (p.status === 'DRAFT' ? '<div class="notice info">Draft pool: allocate PO quantities, then <b>Activate</b>. Expenses and shipments can be recorded once the pool is active.</div>' : '') +
      (p.status === 'CLOSED' ? `<div class="notice ok">Closed on ${fmtDT(p.closedAt)} by ${esc(p.closedBy)}. Financial records are locked. <a href="#/closure?pool=${p.id}">View closure</a></div>` : '') +
      `<div class="kpis"><div class="kpi"><div class="l">Allocated qty</div><div class="v">${Fmt.qty(r.totals.orderQty)}</div></div><div class="kpi"><div class="l">Shipped qty</div><div class="v">${Fmt.qty(r.totals.shippedQty)}</div></div><a class="kpi" href="#/limits?pool=${p.id}"><div class="l">Expense limits</div><div class="v">${Fmt.inr(r.totals.totalLimits, 0)}</div></a><a class="kpi" href="#/expenses?pool=${p.id}"><div class="l">Actual expenses</div><div class="v">${Fmt.inr(r.totals.totalActual, 0)}</div></a><a class="kpi" href="#/shipments/summary?pool=${p.id}"><div class="l">INR received</div><div class="v">${Fmt.inr(r.totals.inrReceived, 0)}</div></a><a class="kpi" href="#/profitability?pool=${p.id}"><div class="l">Actual margin</div><div class="v ${D(r.margins.actualMargin).isNeg() ? 'neg' : ''}">${Fmt.inr(r.margins.actualMargin, 0)}</div></a></div>
      <div class="card noprint"><div class="bd" style="display:flex;gap:8px;flex-wrap:wrap">${[['expenses', 'Expenses'], ['exceptions', 'Missing & additional'], ['shipments', 'Shipments'], ['shipments/summary', 'Shipment summary'], ['limits', 'Expense limits'], ['profitability', 'Profitability'], ['closure', 'Close entry']].map(([k, l]) => `<a class="btn sm" href="#/${k}?pool=${p.id}">${l}</a>`).join('')}</div></div>
      <div class="card"><div class="hd"><h2>Allocated orders</h2></div><div class="bd p0" id="alt"></div></div>
      <div class="grid2"><div class="card"><div class="hd"><h2>Quantity per style</h2></div><div class="bd p0" id="sty"></div><div class="bd small muted">“Reference qty” is the manually entered total of selected orders for a style (source note [2]). It is a <b>reference value only</b>: it pre-fills Paid Qty in expense entry. Expense limits always use the allocated quantity.</div></div>
      <div class="card"><div class="hd"><h2>Allocation history</h2></div><div class="bd p0" id="ahist"></div></div></div>
      ${p.remarks ? `<div class="card"><div class="hd"><h2>Remarks</h2></div><div class="bd">${esc(p.remarks)}</div></div>` : ''}`;
    table($('#alt', view), {
      id: 'pool-alloc-' + p.id, noPaging: true, rows: r.allocations, exportName: `${p.poolNo}-allocations`,
      columns: [
        { key: 'confNo', label: 'Conf. ID', render: (x) => `<span class="mono">${esc(x.confNo)}</span>` }, { key: 'poNumber', label: 'PO' },
        { key: 'styleRef', label: 'Style' }, { key: 'combo', label: 'Combo' }, { key: 'orderQty', label: 'Order qty', num: true }, { key: 'qty', label: 'Allocated', num: true, render: (x) => `<b>${Fmt.qty(x.qty)}</b>` },
        { key: 'price', label: 'Confirmed rate', num: true, render: (x) => Fmt.money(x.price, x.currency) }, { key: 'costing', label: 'Costing', hideSm: true },
      ],
      footer: (rows) => `<td colspan="5">Total</td><td class="num">${Fmt.qty(rows.reduce((a, x) => a + x.qty, 0))}</td><td colspan="2"></td>`,
      actions: () => (editable ? guard('pools.allocate', act('edit', '', '', 'edit', false, 'Edit quantity')) + guard('pools.release', act('rel', 'Release', 'danger')) : ''),
      on: {
        edit: async (x) => { const v = await ask(`Edit allocation ${x.confNo}`, 'New allocated quantity', { value: String(x.qty), multiline: false, help: `Order ${x.orderQty} pcs. Remaining pool-eligible elsewhere: ${SP.lineMetrics(Store.db, byId(Store.db, 'lines', x.lineId)).remainingPool}` }); if (v === null) return; const why = await ask('Reason for change', 'Reason', { required: false }); run(null, async () => { await svc.editAllocation(x.id, v, why || ''); toast('Allocation updated', 'ok'); }); },
        rel: async (x) => { const why = await ask(`Release ${x.confNo} (${x.qty} pcs) from ${p.poolNo}`, 'Reason for release', { danger: true, ok: 'Release', help: 'Released quantity becomes available for other pools. History is kept.' }); if (why) run(null, async () => { await svc.releaseAllocation(x.id, why); toast('Allocation released', 'ok'); }); },
      },
    });
    table($('#sty', view), {
      id: 'pool-sty-' + p.id, noToolbar: true, noPaging: true, rows: r.styles,
      columns: [
        { key: 'styleRef', label: 'Style', render: (x) => `<b>${esc(x.styleRef)}</b><div class="small muted">${esc(x.description || '')}</div>` },
        { key: 'allocQty', label: 'Allocated qty', num: true },
        { key: 'ref', label: 'Reference qty', num: true, value: (x) => (x.refQty ? x.refQty.qty : ''), render: (x) => (x.refQty ? `${Fmt.qty(x.refQty.qty)}${x.refQty.qty !== x.allocQty ? ' <span class="badge warn">differs</span>' : ''}<div class="small faint">${esc(x.refQty.note || '')}</div>` : '<span class="faint">—</span>') },
        { key: 'shipped', label: 'Shipped', num: true, value: (x) => r.shipments.list.filter((s) => s.styleId === x.styleId).reduce((a, s) => a + s.shippedQty, 0) },
      ],
      actions: () => (editable ? guard('pools.edit', act('ref', 'Set ref. qty')) : ''),
      on: { ref: (x) => modal({ title: `Reference quantity — ${x.styleRef}`, body: form([{ name: 'qty', label: 'Total qty of selected orders (manual)', type: 'int', span: 's6', help: `Allocated: ${x.allocQty}. Leave blank to clear.` }, { name: 'note', label: 'Note', span: 's12' }], x.refQty || {}), actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: async (m) => { const v = read(m.el); await svc.setStyleRefQty(p.id, x.styleId, v.qty, v.note); toast('Saved', 'ok'); } }] }) },
    });
    const hist = db.allocations.filter((a) => a.poolId === p.id).flatMap((a) => a.history.map((h) => Object.assign({ line: byId(db, 'lines', a.lineId) }, h))).sort((a, b) => b.at.localeCompare(a.at));
    table($('#ahist', view), {
      id: 'pool-hist-' + p.id, noToolbar: true, pageSize: 8, rows: hist, empty: 'No allocation history',
      columns: [{ key: 'at', label: 'When', render: (h) => fmtDT(h.at) }, { key: 'action', label: 'Action', render: (h) => badge(h.action, h.action === 'RELEASE' ? 'bad' : 'info') }, { key: 'line', label: 'Order', value: (h) => H.lineLabel(h.line), wrap: true }, { key: 'qty', label: 'Qty', num: true, render: (h) => (h.from !== undefined ? `${h.from} → ${h.qty}` : h.qty) }, { key: 'by', label: 'By' }, { key: 'reason', label: 'Reason', wrap: true }],
    });
    const aa = $('#addA', view); if (aa) aa.onclick = () => allocateDialog(p);
    const ap = $('#actP', view); if (ap) ap.onclick = async () => { if (await confirm(`Activate ${esc(p.poolNo)}? Make sure all orders for this pool are allocated.`)) run(ap, async () => { await svc.activatePool(p.id); toast('Pool activated', 'ok'); }); };
    const ed = $('#edP', view); if (ed) ed.onclick = () => modal({ title: `Edit ${p.poolNo}`, body: form([{ name: 'season', label: 'Season', span: 's6' }, { name: 'remarks', label: 'Remarks', type: 'textarea', span: 's12' }], p), actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: async (m) => { await svc.updatePool(p.id, read(m.el)); toast('Saved', 'ok'); } }] });
    const cn = $('#cnP', view); if (cn) cn.onclick = async () => { const why = await ask(`Cancel pool ${p.poolNo}`, 'Reason', { danger: true, ok: 'Cancel pool', help: 'All allocations are released. Pools with shipments, expenses or adjustments cannot be cancelled.' }); if (why) run(cn, async () => { await svc.cancelPool(p.id, why); toast('Pool cancelled', 'ok'); }); };
  });
  function allocateDialog(p) {
    const db = Store.db;
    const partial = db.settings.pool.allowPartialAllocation;
    const elig = db.lines.filter((l) => l.status === 'CONFIRMED' && l.buyerId === p.buyerId && !db.allocations.some((a) => a.poolId === p.id && a.lineId === l.id && a.status === 'ACTIVE'))
      .map((l) => ({ l, m: SP.lineMetrics(db, l) })).filter((x) => x.m.remainingPool > 0);
    const m = modal({
      title: `Allocate orders to ${p.poolNo}`, size: 'xl',
      body: `<p class="muted" style="margin-top:0">Eligible: confirmed orders of ${esc(H.buyer(p.buyerId).name)} with remaining pool-eligible quantity. ${partial ? 'Partial allocation is allowed.' : 'Partial allocation is disabled — allocate the full remaining quantity.'} Quantities are re-checked when saved, so two users cannot allocate the same pieces.</p>
        <div class="filters"><div class="fld"><label for="alq">Filter</label><input type="search" id="alq" class="inp" placeholder="Style, PO, combo…"></div>${p.season ? `<label class="check" style="margin-bottom:8px"><input type="checkbox" id="alS" checked> Season ${esc(p.season)} only</label>` : ''}</div>
        ${elig.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Order</th><th>PO</th><th>Style</th><th>Combo</th><th class="num">Order qty</th><th class="num">Already allocated</th><th class="num">Available</th><th class="num">Confirmed rate</th><th style="width:130px">Allocate qty</th></tr></thead><tbody>
        ${elig.map(({ l, m: mm }) => `<tr data-row="${l.id}" data-season="${esc(H.style(l.styleId).season)}" data-text="${esc((H.style(l.styleId).styleRef + ' ' + H.po(l.poId).poNumber + ' ' + l.combo + ' ' + l.confNo).toLowerCase())}"><td class="mono">${esc(l.confNo)}</td><td>${esc(H.po(l.poId).poNumber)}</td><td>${esc(H.style(l.styleId).styleRef)}</td><td>${esc(l.combo)}</td><td class="num">${Fmt.qty(l.orderQty)}</td><td class="num">${Fmt.qty(mm.allocated)}</td><td class="num"><b>${Fmt.qty(mm.remainingPool)}</b></td><td class="num">${Fmt.money(l.confirmedPrice, l.currency)}</td><td><div style="display:flex;gap:4px"><input class="cell num" data-line="${l.id}" data-max="${mm.remainingPool}" inputmode="numeric" ${partial ? '' : 'readonly'} placeholder="0"><button class="btn xs" type="button" data-all="${l.id}">All</button></div></td></tr>`).join('')}
        </tbody></table></div><div style="margin-top:10px"><b>Selected: <span id="alTot">0</span> pcs</b> <span id="alBy" class="small muted"></span></div>` : empty('No eligible orders', '<p>All confirmed orders for this buyer are fully allocated, or none are confirmed yet.</p>')}`,
      actions: [{ label: 'Cancel' }, { label: 'Allocate', cls: 'primary', onClick: async (mm) => {
        const items = $$('[data-line]', mm.el).filter((i) => i.value.trim() !== '' && i.closest('tr').style.display !== 'none').map((i) => ({ lineId: i.dataset.line, qty: i.value.trim() }));
        await svc.allocate(p.id, items); toast(`${items.length} allocation(s) saved`, 'ok');
      } }],
    });
    const el = m.el;
    const tot = () => {
      let t = 0; const by = {};
      $$('[data-line]', el).forEach((i) => { const n = Number(i.value || 0); const bad = i.value.trim() !== '' && (!Number.isInteger(n) || n < 1 || n > +i.dataset.max); i.classList.toggle('invalid', bad); if (!bad && n && i.closest('tr').style.display !== 'none') { t += n; const s = H.style(byId(Store.db, 'lines', i.dataset.line).styleId).styleRef; by[s] = (by[s] || 0) + n; } });
      const a = $('#alTot', el); if (a) a.textContent = Fmt.qty(t);
      const b = $('#alBy', el); if (b) b.textContent = Object.entries(by).map(([k, v]) => `${k}: ${v}`).join(' · ');
    };
    $$('[data-line]', el).forEach((i) => i.addEventListener('input', tot));
    $$('[data-all]', el).forEach((b) => (b.onclick = () => { const i = el.querySelector(`[data-line="${b.dataset.all}"]`); i.value = i.value ? '' : i.dataset.max; tot(); }));
    const filt = () => { const qv = ($('#alq', el).value || '').toLowerCase(); const so = $('#alS', el); $$('tr[data-row]', el).forEach((tr) => { tr.style.display = (!qv || tr.dataset.text.includes(qv)) && (!so || !so.checked || tr.dataset.season === p.season) ? '' : 'none'; }); tot(); };
    $('#alq', el).addEventListener('input', filt); const so = $('#alS', el); if (so) so.addEventListener('change', filt); filt();
  }

  /* ======================= EXPENSES ======================= */
  App.route('expenses', 'expenses.view', async (view, q) => {
    const db = Store.db;
    const p = q.pool ? byId(db, 'pools', q.pool) : null;
    view.innerHTML = pageHead('Expense Management', 'One workspace per pool: fabric used, application, CMT, trims, labelling, packaging, forwarding and others. Only styles in the pool are shown.', p ? btn('Print expense summary', 'id="prE"', '', 'print') : '') + H.poolBar(view, q, 'expenses', (x) => x.status !== 'CANCELLED');
    H.bindPoolBar(view, 'expenses');
    if (!p) { view.insertAdjacentHTML('beforeend', '<div class="card">' + empty('Select a pool', '<p>Choose a pool above to open its expense workspace.</p>') + '</div>'); return; }
    const r = SP.computePool(db, p.id);
    const editable = ['ACTIVE', 'REOPENED'].includes(p.status) && can('expenses.edit');
    const cat = q.cat || 'FABRIC';
    const cats = H.cats();
    const exps = db.expenses.filter((e) => e.poolId === p.id && !e.deletedAt);
    const styleIds = r.styles.map((s) => s.styleId);
    const qtyRow = (s) => {
      const lines = r.allocations.filter((a) => a.styleId === s.styleId);
      const orderQty = Array.from(new Set(lines.map((a) => a.lineId))).reduce((x, id) => x + byId(db, 'lines', id).orderQty, 0);
      const se = exps.filter((e) => e.styleId === s.styleId && e.status === 'SAVED');
      const fab = {}; se.filter((e) => e.category === 'FABRIC').forEach((e) => (fab[e.unit] = D(fab[e.unit] || 0).add(e.qty).toString()));
      const paid = (c) => sum(se.filter((e) => e.category === c), (e) => D(e.qty)).toString();
      return { styleRef: s.styleRef, orderQty, allocQty: s.allocQty, refQty: s.refQty ? s.refQty.qty : null, fab: Object.entries(fab).map(([u, v]) => `${Fmt.num(v, 3)} ${u}`).join(', ') || '—', app: paid('APPLICATION'), cmt: paid('CMT'), shipped: r.shipments.list.filter((x) => x.styleId === s.styleId).reduce((a, x) => a + x.shippedQty, 0) };
    };
    view.insertAdjacentHTML('beforeend', `
      ${!editable ? `<div class="notice ${p.status === 'CLOSED' ? 'ok' : 'warn'}">${p.status === 'CLOSED' ? 'Pool is closed — expenses are read-only.' : p.status === 'DRAFT' ? 'Pool is a draft — activate it before entering expenses.' : 'Read-only: you do not have permission to edit expenses.'}</div>` : ''}
      <div class="kpis"><div class="kpi"><div class="l">Actual expenses (saved)</div><div class="v">${Fmt.inr(r.totals.totalActual)}</div></div><a class="kpi" href="#/limits?pool=${p.id}"><div class="l">Expense limits</div><div class="v">${Fmt.inr(r.totals.totalLimits)}</div></a><div class="kpi ${r.expenses.drafts ? 'warn' : ''}"><div class="l">Draft entries</div><div class="v">${r.expenses.drafts}</div></div><div class="kpi"><div class="l">Not fully paid</div><div class="v">${r.expenses.unpaid}</div></div></div>
      <div class="card"><div class="hd"><h2>Quantities (kept separate)</h2></div><div class="bd p0"><div class="table-wrap"><table class="t"><thead><tr><th>Style</th><th class="num">Original order qty</th><th class="num">Pool-allocated qty</th><th class="num">Reference qty (manual)</th><th class="num">Fabric used</th><th class="num">Application paid qty</th><th class="num">CMT paid qty</th><th class="num">Shipped qty</th></tr></thead><tbody>
        ${r.styles.map(qtyRow).map((x) => `<tr><td><b>${esc(x.styleRef)}</b></td><td class="num">${Fmt.qty(x.orderQty)}</td><td class="num">${Fmt.qty(x.allocQty)}</td><td class="num">${x.refQty === null ? '—' : Fmt.qty(x.refQty)}</td><td class="num">${esc(x.fab)}</td><td class="num">${Fmt.qty(x.app)}</td><td class="num">${Fmt.qty(x.cmt)}</td><td class="num">${Fmt.qty(x.shipped)}</td></tr>`).join('')}
      </tbody></table></div></div></div>
      <div class="tabs" role="tablist">${cats.map((c) => { const n = exps.filter((e) => e.category === c.key).length; return `<button role="tab" class="${c.key === cat ? 'on' : ''}" data-cat="${c.key}" aria-selected="${c.key === cat}">${esc(c.label)}${n ? badge(n) : ''}</button>`; }).join('')}</div>
      <div class="card"><div class="hd"><h2>${esc(H.catLabel(cat))}</h2><span class="sec-total">${Fmt.inr(sum(exps.filter((e) => e.category === cat && e.status === 'SAVED'), (e) => D(e.amount)).toString())}</span>
        ${editable ? btn('Add entry', 'id="addE"', 'primary sm', 'plus') + btn('Copy table…', 'id="cpE"', 'sm', 'copy') : ''}</div><div class="bd p0" id="et"></div></div>`);
    $$('[data-cat]', view).forEach((b) => (b.onclick = () => App.go('expenses', { pool: p.id, cat: b.dataset.cat })));
    const isF = cat === 'FABRIC', isC = cat === 'CMT';
    table($('#et', view), {
      id: `exp-${p.id}-${cat}`, exportName: `${p.poolNo}-${cat.toLowerCase()}-expenses`, rows: () => Store.db.expenses.filter((e) => e.poolId === p.id && !e.deletedAt && e.category === cat),
      filters: [{ key: 'styleId', label: 'Style', options: () => [{ value: '__shared', label: 'Shared' }].concat(r.styles.map((s) => ({ value: s.styleId, label: s.styleRef }))), test: (e, v) => (v === '__shared' ? !e.styleId : e.styleId === v) }, { key: 'paymentStatus', label: 'Payment', options: ['UNPAID', 'PARTIAL', 'PAID'] }, { key: 'status', label: 'Entry', options: ['SAVED', 'DRAFT'] }],
      columns: [
        { key: 'expNo', label: 'Entry', render: (e) => `<span class="mono">${esc(e.expNo)}</span>${testTag(e)}${e.attachment ? ' 📎' : ''}` },
        { key: 'style', label: 'Style', value: (e) => (e.styleId ? H.style(e.styleId).styleRef : 'Shared') },
        { key: 'itemName', label: isF ? 'Fabric' : isC ? 'CMT operation' : cat === 'APPLICATION' ? 'Application' : 'Item', wrap: true, render: (e) => `<b>${esc(e.itemName)}</b>${e.source === 'COSTING' ? ' ' + badge('costing', 'info') : ''}${e.colour || e.spec ? `<div class="small muted">${esc([e.colour, e.spec].filter(Boolean).join(' · '))}</div>` : ''}` },
        { key: 'qty', label: isF ? 'Used wt / qty' : 'Paid qty', num: true, render: (e) => `${Fmt.num(e.qty, isF ? 3 : 0)} ${esc(e.unit || '')}` },
        { key: 'rate', label: isF ? 'Rate / unit' : 'Rate / pc', num: true, render: (e) => Fmt.num(e.rate) },
        { key: 'calcAmount', label: 'Qty × rate', num: true, hideSm: true, render: (e) => Fmt.inr(e.calcAmount) },
        { key: 'billAmount', label: 'Bill amount', num: true, render: (e) => (e.billAmount === null ? '<span class="faint">—</span>' : Fmt.inr(e.billAmount)) },
        { key: 'amount', label: 'Actual amount', num: true, render: (e) => `<b>${Fmt.inr(e.amount)}</b>` },
        { key: 'vendor', label: isC ? 'Factory' : cat === 'APPLICATION' ? 'Party' : 'Vendor', value: (e) => (isC ? e.factory : e.vendor), render: (e) => `${esc(isC ? e.factory : e.vendor)}${isC && e.sourcing ? `<div class="small muted">${e.sourcing === 'INHOUSE' ? 'In-house' : 'Outsourced'}</div>` : ''}`, wrap: true },
        { key: 'billRef', label: 'Bill', hideSm: true, render: (e) => `${esc(e.billRef || '—')}<div class="small faint">${fmtDate(e.billDate)}</div>` },
        { key: 'paymentStatus', label: 'Payment', render: (e) => status(e.paymentStatus) },
        { key: 'status', label: 'Entry', render: (e) => status(e.status) },
      ],
      footer: (rows) => `<td colspan="7">Total (saved entries)</td><td class="num">${Fmt.inr(sum(rows.filter((e) => e.status === 'SAVED'), (e) => D(e.amount)).toString())}</td><td colspan="4"></td>`,
      actions: (e) => act('pay', 'Payments') + (editable ? act('edit', '', '', 'edit', false, 'Edit') + act('dup', '', '', 'copy', false, 'Duplicate') + guard('expenses.delete', act('del', '', 'danger', 'trash', false, 'Delete')) : ''),
      on: {
        edit: (e) => editExpense(p, r, cat, e), pay: (e) => payments(e, editable),
        dup: (e) => run(null, async () => { const x = await svc.duplicateExpense(e.id); toast(`${x.expNo} created as draft`, 'ok'); }),
        del: async (e) => { if (e.status === 'DRAFT' && !(e.payments || []).length) { if (await confirm(`Delete draft ${esc(e.expNo)}?`, { danger: true, ok: 'Delete' })) run(null, async () => { await svc.deleteExpense(e.id); toast('Deleted', 'ok'); }); return; } const why = await ask(`Delete ${e.expNo}`, 'Reason (kept in audit history)', { danger: true, ok: 'Delete' }); if (why) run(null, async () => { await svc.deleteExpense(e.id, why); toast('Expense deleted', 'ok'); }); },
      },
    });
    const ae = $('#addE', view); if (ae) ae.onclick = () => editExpense(p, r, cat);
    const ce = $('#cpE', view);
    if (ce) ce.onclick = () => {
      const opts = [{ value: '', label: 'Shared (all pool styles)' }].concat(r.styles.map((s) => ({ value: s.styleId, label: s.styleRef })));
      modal({
        title: `Copy ${H.catLabel(cat)} table`, body: form([{ name: 'from', label: 'Copy entries of', type: 'select', options: opts, placeholder: false, span: 's6' }, { name: 'to', label: 'Into', type: 'select', options: opts, placeholder: false, span: 's6' }, { name: 'h', type: 'html', html: '<div class="help">Copies are created as <b>drafts</b> without bill references or payments so you can edit them (e.g. fabric table of one style to the next).</div>' }], { to: r.styles[1] ? r.styles[1].styleId : '' }),
        actions: [{ label: 'Cancel' }, { label: 'Copy', cls: 'primary', onClick: async (m) => { const v = read(m.el); const n = await svc.copyExpenseTable(p.id, cat, v.from, v.to); toast(`${n} entr${n === 1 ? 'y' : 'ies'} copied as draft`, 'ok'); } }],
      });
    };
    $('#prE', view).onclick = () => printExpenses(p, r);
    void styleIds;
  });
  function costingOptions(r, cat, styleId) {
    const out = [];
    r.styles.filter((s) => !styleId || s.styleId === styleId).forEach((s) => {
      const vers = new Set(r.allocations.filter((a) => a.styleId === s.styleId).map((a) => byId(Store.db, 'lines', a.lineId).costingId));
      vers.forEach((vid) => { const v = byId(Store.db, 'costings', vid); if (!v) return; v.lines.filter((l) => l.category === cat).forEach((l) => out.push({ key: `${v.id}:${l.id}`, styleId: s.styleId, label: `${s.styleRef} · ${l.name}${l.colour ? ' ' + l.colour : ''} — ${Fmt.num(l.rate)}${cat === 'FABRIC' ? '/' + (l.rateUnit || l.unit || 'unit') : '/pc'} (${v.label})`, l, v })); });
    });
    return out;
  }
  function editExpense(p, r, cat, e) {
    const isF = cat === 'FABRIC', isA = cat === 'APPLICATION', isC = cat === 'CMT';
    const st = Store.db.settings;
    let attachment = e ? e.attachment : null;
    const styleOpts = [{ value: '', label: 'Shared (all pool styles)' }].concat(r.styles.map((s) => ({ value: s.styleId, label: `${s.styleRef} — ${s.description || ''}` })));
    const v0 = e ? Object.assign({}, e) : { status: 'SAVED', unit: isF ? 'kg' : 'pc', billDate: SP.today(), source: 'MANUAL', sourcing: isC ? 'INHOUSE' : '' };
    const m = modal({
      title: `${e ? 'Edit' : 'Add'} ${H.catLabel(cat)} expense${e ? ' ' + e.expNo : ''} — ${p.poolNo}`, size: 'lg',
      body: `<div class="form-grid">
        ${UI.field({ name: 'styleId', label: 'Style', type: 'select', options: styleOpts, placeholder: false, span: 's6' }, v0.styleId || '')}
        ${UI.field({ name: 'costingPick', label: `Fetch from costing inputs`, type: 'select', options: [], placeholder: '— Manual entry —', span: 's6', help: can('expenses.edit') ? 'Or type a manual item below' : '' })}
        ${UI.field({ name: 'itemName', label: isF ? 'Fabric' : isA ? 'Application type' : isC ? 'CMT operation / details' : 'Item / description', required: true, span: 's6' }, v0.itemName)}
        ${isF ? UI.field({ name: 'colour', label: 'Colour', span: 's3' }, v0.colour) + UI.field({ name: 'spec', label: 'Fabric specification', span: 's3' }, v0.spec) : UI.field({ name: 'spec', label: 'Details', span: 's6' }, v0.spec)}
        ${UI.field({ name: 'qty', label: isF ? 'Used weight / quantity' : 'Paid quantity', type: 'decimal', required: true, span: 's3', help: isF ? '' : '<span id="qtyHint"></span>' }, v0.qty)}
        ${UI.field({ name: 'unit', label: 'Unit', type: 'select', options: st.units, span: 's3', required: isF }, v0.unit)}
        ${UI.field({ name: 'rate', label: isF ? 'Rate per unit' : 'Confirmed rate / pc', type: 'decimal', required: true, span: 's3' }, v0.rate)}
        ${UI.field({ name: 'calc', label: 'Qty × rate', type: 'static', span: 's3', html: '<b id="eCalc">—</b>' })}
        ${UI.field({ name: 'billAmount', label: 'Bill amount (manual)', type: 'decimal', span: 's4', help: 'If entered, this is the actual expense; otherwise qty × rate is used' }, v0.billAmount)}
        ${UI.field({ name: 'act', label: 'Actual amount', type: 'static', span: 's4', html: '<b id="eAct">—</b>' })}
        ${isC ? UI.field({ name: 'factory', label: 'Factory', span: 's4' }, v0.factory) + UI.field({ name: 'sourcing', label: 'In-house / outsourced', type: 'select', options: [{ value: 'INHOUSE', label: 'In-house' }, { value: 'OUTSOURCED', label: 'Outsourced' }], required: true, span: 's4' }, v0.sourcing) : UI.field({ name: 'vendor', label: isA ? 'Party' : 'Vendor', span: 's4' }, v0.vendor)}
        ${UI.field({ name: 'billRef', label: 'Bill reference', span: 's4' }, v0.billRef)}
        ${UI.field({ name: 'billDate', label: 'Bill date', type: 'date', span: 's4' }, v0.billDate)}
        ${UI.field({ name: 'status', label: 'Entry status', type: 'select', options: [{ value: 'SAVED', label: 'Saved (counts as actual)' }, { value: 'DRAFT', label: 'Draft (not counted, blocks closure)' }], placeholder: false, span: 's4' }, v0.status)}
        ${UI.field({ name: 'remarks', label: 'Remarks', type: 'textarea', span: 's12' }, v0.remarks)}
        ${st.attachments.enabled ? `<div class="fld s12"><label>Bill attachment</label><div id="attBox"></div></div>` : ''}
        <input type="hidden" name="source" value="${esc(v0.source || 'MANUAL')}"><input type="hidden" name="costingRef" value="${esc(v0.costingRef || '')}">
      </div>`,
      actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: async (mm) => {
        const v = read(mm.el); delete v.calc; delete v.act; delete v.costingPick;
        const x = await svc.saveExpense(Object.assign(v, { id: e && e.id, poolId: p.id, category: cat, attachment }));
        toast(`${x.expNo} saved`, 'ok');
      } }],
    });
    const el = m.el; const S = (n) => $(`[name=${n}]`, el);
    let opts = [];
    const fillOpts = () => { opts = costingOptions(r, cat, S('styleId').value); UI.setOptions(S('costingPick'), opts.map((o) => ({ value: o.key, label: o.label })), '', opts.length ? '— Manual entry —' : 'No costing items for this selection'); };
    const hint = () => {
      const h = $('#qtyHint', el); if (!h) return;
      const s = r.styles.find((x) => x.styleId === S('styleId').value);
      h.innerHTML = s ? `Pool qty for ${esc(s.styleRef)}: <a href="#" data-q="${s.allocQty}">${s.allocQty}</a>${s.refQty ? ` · reference: <a href="#" data-q="${s.refQty.qty}">${s.refQty.qty}</a>` : ''}` : `Pool total: <a href="#" data-q="${r.totals.orderQty}">${r.totals.orderQty}</a>`;
      $$('[data-q]', h).forEach((a) => (a.onclick = (ev) => { ev.preventDefault(); S('qty').value = a.dataset.q; upd(); }));
    };
    const upd = () => {
      let calc = null;
      try { calc = D(S('qty').value || 0).mul(S('rate').value || 0).round(2).toString(); $('#eCalc', el).textContent = Fmt.inr(calc); } catch (x) { $('#eCalc', el).textContent = 'invalid'; }
      const b = S('billAmount').value.trim();
      $('#eAct', el).textContent = b ? (SP.Dec.valid(b) ? Fmt.inr(b) + ' (bill)' : 'invalid') : calc !== null ? Fmt.inr(calc) + ' (qty × rate)' : '—';
    };
    S('styleId').addEventListener('change', () => { fillOpts(); hint(); });
    S('costingPick').addEventListener('change', () => {
      const o = opts.find((x) => x.key === S('costingPick').value); if (!o) { S('source').value = 'MANUAL'; return; }
      S('itemName').value = o.l.name; S('rate').value = o.l.rate; if (o.l.unit) S('unit').value = isF ? (o.l.rateUnit || o.l.unit) : o.l.unit;
      if (isF) { S('colour').value = o.l.colour || ''; S('spec').value = [o.l.composition, o.l.gsm && o.l.gsm + ' GSM', o.l.description].filter(Boolean).join(' · '); }
      if (!S('styleId').value) S('styleId').value = o.styleId;
      if (!isF && !S('qty').value) { const s = r.styles.find((x) => x.styleId === o.styleId); if (s) S('qty').value = s.refQty ? s.refQty.qty : s.allocQty; }
      S('source').value = 'COSTING'; S('costingRef').value = `${o.v.label}:${o.l.name}`; upd(); hint();
    });
    ['qty', 'rate', 'billAmount'].forEach((n) => S(n).addEventListener('input', upd));
    const drawAtt = () => {
      const b = $('#attBox', el); if (!b) return;
      b.innerHTML = `${attachment ? `<a href="${esc(attachment.dataUrl)}" download="${esc(attachment.name)}">📎 ${esc(attachment.name)}</a> ` : '<span class="muted">No file</span> '}<button class="btn sm" type="button" id="attUp">${attachment ? 'Replace' : 'Attach file'}</button>${attachment ? ' <button class="btn sm danger" type="button" id="attRm">Remove</button>' : ''} <span class="help">Max ${st.attachments.maxKb} KB (PDF / image)</span>`;
      $('#attUp', b).onclick = async () => { const f = await UI.pickFile('application/pdf,image/*'); if (!f) return; if (f.size > st.attachments.maxKb * 1024) return toast(`File is larger than ${st.attachments.maxKb} KB`, 'bad'); attachment = { name: f.name, type: f.type, dataUrl: await UI.readDataUrl(f) }; drawAtt(); };
      const rm = $('#attRm', b); if (rm) rm.onclick = () => { attachment = null; drawAtt(); };
    };
    fillOpts(); hint(); upd(); drawAtt();
  }
  function payments(e, editable) {
    const m = modal({
      title: `Payments — ${e.expNo} (${Fmt.inr(e.amount)})`, size: 'lg', body: '<div id="payBox"></div>',
      actions: [{ label: 'Close' }],
    });
    const draw = () => {
      const x = byId(Store.db, 'expenses', e.id); const paid = sum(x.payments, (y) => D(y.amount));
      $('#payBox', m.el).innerHTML = `<p>Status: ${status(x.paymentStatus)} · Paid ${Fmt.inr(paid.toString())} of ${Fmt.inr(x.amount)} · Balance <b>${Fmt.inr(D(x.amount).sub(paid).toString())}</b></p>
        <table class="t"><thead><tr><th>Date</th><th class="num">Amount</th><th>Reference</th><th>By</th><th></th></tr></thead><tbody>${x.payments.map((y) => `<tr><td>${fmtDate(y.date)}</td><td class="num">${Fmt.inr(y.amount)}</td><td>${esc(y.ref)}</td><td>${esc(y.by)}</td><td>${editable ? `<button class="btn xs danger" data-rm="${y.id}" type="button">Remove</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="empty small">No payments recorded</td></tr>'}</tbody></table>
        ${editable && D(x.amount).sub(paid).gt(0) ? `<h3 style="margin:14px 0 6px">Record payment</h3><div class="form-grid" id="payF">${UI.field({ name: 'date', label: 'Date', type: 'date', span: 's4' }, SP.today())}${UI.field({ name: 'amount', label: 'Amount (INR)', type: 'decimal', span: 's4' }, D(x.amount).sub(paid).toString())}${UI.field({ name: 'ref', label: 'Reference', span: 's4' })}</div><div style="margin-top:10px"><button class="btn primary" id="payAdd" type="button">Add payment</button></div>` : ''}`;
      const add = $('#payAdd', m.el); if (add) add.onclick = () => run(add, async () => { await svc.addPayment(e.id, read($('#payF', m.el))); toast('Payment recorded', 'ok'); draw(); }, m.el);
      $$('[data-rm]', m.el).forEach((b) => (b.onclick = async () => { if (await confirm('Remove this payment?', { danger: true, ok: 'Remove' })) run(b, async () => { await svc.removePayment(e.id, b.dataset.rm); draw(); }); }));
    };
    draw();
  }
  function printExpenses(p, r) {
    const db = Store.db; const exps = db.expenses.filter((e) => e.poolId === p.id && !e.deletedAt);
    UI.printDoc(`Expense summary — ${p.poolNo}`, `${p.isTest ? '<div class="test">TEST DATA</div>' : ''}<div class="grid"><div><b>Buyer:</b> ${esc(H.buyer(p.buyerId).name)}</div><div><b>Status:</b> ${esc(p.status)}</div></div>
      <h2>Category totals</h2><table><thead><tr><th>Category</th><th class="num">Entries</th><th class="num">Actual</th><th class="num">Expense limit</th><th class="num">Difference (limit − actual)</th></tr></thead><tbody>${r.byCat.map((c) => `<tr><td>${esc(c.label)}</td><td class="num">${c.entries}</td><td class="num">${Fmt.inr(c.actual)}</td><td class="num">${Fmt.inr(c.limit)}</td><td class="num">${Fmt.inr(c.diff)}</td></tr>`).join('')}</tbody><tfoot><tr><td>Total</td><td></td><td class="num">${Fmt.inr(r.totals.totalActual)}</td><td class="num">${Fmt.inr(r.totals.totalLimits)}</td><td class="num">${Fmt.inr(r.totals.expenseDiff)}</td></tr></tfoot></table>
      ${H.cats().filter((c) => exps.some((e) => e.category === c.key)).map((c) => `<h2>${esc(c.label)}</h2><table><thead><tr><th>Entry</th><th>Style</th><th>Item</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Bill</th><th class="num">Amount</th><th>Vendor / factory</th><th>Bill ref</th><th>Payment</th><th>Status</th></tr></thead><tbody>${exps.filter((e) => e.category === c.key).map((e) => `<tr><td>${esc(e.expNo)}</td><td>${esc(e.styleId ? H.style(e.styleId).styleRef : 'Shared')}</td><td>${esc(e.itemName)} ${esc(e.colour || '')}</td><td class="num">${Fmt.num(e.qty, 3)} ${esc(e.unit || '')}</td><td class="num">${Fmt.num(e.rate)}</td><td class="num">${e.billAmount === null ? '—' : Fmt.num(e.billAmount)}</td><td class="num">${Fmt.num(e.amount)}</td><td>${esc(e.factory || e.vendor || '')}</td><td>${esc(e.billRef || '')}</td><td>${esc(e.paymentStatus)}</td><td>${esc(e.status)}</td></tr>`).join('')}</tbody></table>`).join('')}`);
  }

  /* ======================= MISSING & ADDITIONAL ITEMS ======================= */
  App.route('exceptions', 'exceptions.view', async (view, q) => {
    const db = Store.db;
    const p = q.pool ? byId(db, 'pools', q.pool) : null;
    view.innerHTML = pageHead('Missing & Additional Items', 'Costing items missing from production and items added. Every item needs an acceptance decision before the pool can be closed. Recording an item never adds cost — enter the expense separately.') + H.poolBar(view, q, 'exceptions', null);
    H.bindPoolBar(view, 'exceptions');
    const editable = p && ['ACTIVE', 'REOPENED', 'DRAFT'].includes(p.status);
    const rows = () => Store.db.exceptions.filter((x) => !p || x.poolId === p.id);
    const pend = rows().filter((x) => x.status === 'PENDING').length;
    view.insertAdjacentHTML('beforeend', `${pend ? `<div class="notice warn"><b>${pend} item(s) awaiting decision.</b> Pools cannot be closed until all missing and additional items are accepted or resolved.</div>` : ''}
      ${p && editable ? `<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">${guard('exceptions.edit', btn('Add missing item', 'id="addM"', 'primary', 'plus') + btn('Add additional item', 'id="addAd"', '', 'plus'))}</div>` : p ? '' : '<div class="notice info">Select a pool to add items. Showing items of all pools.</div>'}
      <div class="card"><div class="hd"><h2>Missing items</h2></div><div class="bd p0" id="mt"></div></div><div class="card"><div class="hd"><h2>Additional items</h2></div><div class="bd p0" id="at"></div></div>`);
    const cols = (type) => [
      { key: 'excNo', label: 'ID', render: (x) => `<span class="mono">${esc(x.excNo)}</span>${testTag(x)}` },
      { key: 'pool', label: 'Pool', value: (x) => (H.pool(x.poolId) || {}).poolNo, hidden: !!p },
      { key: 'style', label: 'Style', value: (x) => H.style(x.styleId).styleRef }, { key: 'category', label: 'Category', value: (x) => H.catLabel(x.category) },
      { key: 'itemName', label: type === 'MISSING' ? 'Missing item' : 'Additional item', render: (x) => `<b>${esc(x.itemName)}</b>` },
      { key: 'link', label: type === 'MISSING' ? 'Replaced by' : 'Replaces', wrap: true, value: (x) => (type === 'MISSING' ? Store.db.exceptions.filter((y) => y.replacesId === x.id).map((y) => y.itemName).join(', ') : (byId(Store.db, 'exceptions', x.replacesId) || {}).itemName || '') },
      { key: 'reason', label: 'Reason', wrap: true }, { key: 'date', label: 'Date', render: (x) => fmtDate(x.date) },
      { key: 'status', label: type === 'MISSING' ? 'Accepted / resolved' : 'Accepted', render: (x) => status(x.status) },
      { key: 'decidedBy', label: 'Resolved by', render: (x) => (x.decidedBy ? `${esc(x.decidedBy)}<div class="small faint">${fmtDT(x.decidedAt)}</div>` : '—') },
      { key: 'decisionRemarks', label: 'Remarks', wrap: true, value: (x) => [x.remarks, x.decisionRemarks].filter(Boolean).join(' / ') },
    ];
    ['MISSING', 'ADDITIONAL'].forEach((type) => table($(type === 'MISSING' ? '#mt' : '#at', view), {
      id: `exc-${type}-${p ? p.id : 'all'}`, exportName: `${type.toLowerCase()}-items`, rows: () => rows().filter((x) => x.type === type),
      initialFilters: { status: q.status || '' },
      filters: [{ key: 'status', label: 'Status', options: ['PENDING', 'ACCEPTED', 'RESOLVED', 'REJECTED'] }, { key: 'category', label: 'Category', options: () => H.cats().map((c) => ({ value: c.key, label: c.label })) }],
      columns: cols(type),
      actions: (x) => { const pp = H.pool(x.poolId); const open = pp && !['CLOSED', 'CANCELLED'].includes(pp.status); return open ? guard('exceptions.decide', act('decide', 'Decide', 'accent')) + (x.status === 'PENDING' ? guard('exceptions.edit', act('edit', '', '', 'edit', false, 'Edit') + (!x.decidedAt ? act('del', '', 'danger', 'trash', false, 'Delete') : '')) : '') : ''; },
      on: {
        decide: (x) => decide(x), edit: (x) => editExc(H.pool(x.poolId), x.type, x),
        del: async (x) => { if (await confirm(`Delete draft item ${esc(x.itemName)}?`, { danger: true, ok: 'Delete' })) run(null, async () => { await svc.deleteException(x.id); toast('Deleted', 'ok'); }); },
      },
    }));
    const am = $('#addM', view); if (am) am.onclick = () => editExc(p, 'MISSING');
    const ad = $('#addAd', view); if (ad) ad.onclick = () => editExc(p, 'ADDITIONAL');
  });
  function editExc(p, type, x) {
    const r = SP.computePool(Store.db, p.id);
    const missing = Store.db.exceptions.filter((y) => y.poolId === p.id && y.type === 'MISSING');
    const m = modal({
      title: `${x ? 'Edit' : 'Add'} ${type === 'MISSING' ? 'missing' : 'additional'} item — ${p.poolNo}`,
      body: form([
        { name: 'styleId', label: 'Style', type: 'select', options: r.styles.map((s) => ({ value: s.styleId, label: s.styleRef })), required: true, span: 's6' },
        { name: 'category', label: 'Category', type: 'select', options: H.cats().map((c) => ({ value: c.key, label: c.label })), required: true, span: 's6' },
        { name: 'itemName', label: type === 'MISSING' ? 'Missing item' : 'Additional item', required: true, span: 's6', attrs: 'list="costItems"' },
        { name: 'date', label: 'Date', type: 'date', span: 's6' },
        ...(type === 'ADDITIONAL' ? [{ name: 'replacesId', label: 'Replacement for (missing item)', type: 'select', options: missing.map((y) => ({ value: y.id, label: `${y.excNo} ${y.itemName} (${H.style(y.styleId).styleRef}, ${H.catLabel(y.category)})` })), placeholder: '— Not a replacement —', span: 's12', help: 'Link the replacement so both items are visible together' }] : []),
        { name: 'reason', label: 'Reason', type: 'textarea', required: true, span: 's12' },
        { name: 'remarks', label: 'Remarks', type: 'textarea', span: 's12' },
      ], x || { date: SP.today() }) + '<datalist id="costItems"></datalist><p class="help">Saved items stay <b>pending</b> until accepted or resolved by an authorised user.</p>',
      actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: async (mm) => { await svc.saveException(Object.assign(read(mm.el), { id: x && x.id, poolId: p.id, type })); toast('Saved — pending decision', 'ok'); } }],
    });
    const fill = () => {
      const sid = $('[name=styleId]', m.el).value, cat = $('[name=category]', m.el).value;
      const names = costingOptions(r, cat, sid).map((o) => o.l.name);
      $('#costItems', m.el).innerHTML = Array.from(new Set(names)).map((n) => `<option value="${esc(n)}">`).join('');
    };
    m.el.addEventListener('change', fill); fill();
  }
  function decide(x) {
    const link = x.type === 'MISSING' ? Store.db.exceptions.filter((y) => y.replacesId === x.id) : [byId(Store.db, 'exceptions', x.replacesId)].filter(Boolean);
    modal({
      title: `Decision — ${x.excNo} ${x.itemName}`,
      body: `<dl class="dl"><dt>Type</dt><dd>${x.type === 'MISSING' ? 'Missing item' : 'Additional item'}</dd><dt>Style</dt><dd>${esc(H.style(x.styleId).styleRef)}</dd><dt>Category</dt><dd>${esc(H.catLabel(x.category))}</dd><dt>Reason</dt><dd>${esc(x.reason)}</dd>${link.length ? `<dt>${x.type === 'MISSING' ? 'Replaced by' : 'Replaces'}</dt><dd>${link.map((y) => `${esc(y.itemName)} (${y.status.toLowerCase()})`).join(', ')}</dd>` : ''}<dt>Current</dt><dd>${status(x.status)}</dd></dl>` +
        form([{ name: 'status', label: 'Decision', type: 'select', options: [{ value: 'ACCEPTED', label: 'Accept' }, { value: 'RESOLVED', label: 'Resolved' }, { value: 'REJECTED', label: 'Reject (blocks closure)' }, { value: 'PENDING', label: 'Reopen (pending)' }], placeholder: false, span: 's12' }, { name: 'remarks', label: 'Decision remarks', type: 'textarea', span: 's12' }], { status: 'ACCEPTED', remarks: x.decisionRemarks }),
      actions: [{ label: 'Cancel' }, { label: 'Save decision', cls: 'primary', onClick: async (m) => { const v = read(m.el); await svc.decideException(x.id, v.status, v.remarks); toast('Decision recorded', 'ok'); } }],
    });
  }
  Pages.costingOptions = costingOptions;
})(window);
