/* ==========================================================================
   pages-c.js — Shipments, pool shipment summary & adjustments, expense limits,
   profitability, pool closure, exchange rates, users & permissions, audit,
   settings, CSV import, bootstrap.
   ========================================================================== */
(function (G) {
  'use strict';
  const SP = G.SP;
  const { Store, svc, D, sum, Calc, Fmt, AppError, can, UI, App, Pages, byId, H } = SP;
  const { esc, $, $$, ico, toast, modal, confirm, ask, run, form, read, table, act, badge, status, testTag, signed, pageHead, btn, guard, empty, fmtDate, fmtDT } = UI;

  /* ======================= SHIPMENTS ======================= */
  App.route('shipments', 'shipments.view', async (view, q) => {
    const f = { from: q.from || '', to: q.to || '' };
    view.innerHTML = pageHead('Shipment Management', 'Shipments against confirmed PO lines. The exchange rate and its date are stored on each shipment and never recalculated.', guard('shipments.edit', btn('Record shipment', 'id="addSh"', 'primary', 'plus')) + `<a class="btn" href="#/shipments/summary${q.pool ? '?pool=' + q.pool : ''}">Pool shipment summary</a>`) +
      `<form class="filters" id="shf">${UI.field({ name: 'from', label: 'Shipment date from', type: 'date' }, f.from)}${UI.field({ name: 'to', label: 'To', type: 'date' }, f.to)}</form><div class="card"><div class="bd p0" id="sht"></div></div>`;
    $('#shf', view).onchange = () => App.go('shipments', Object.assign({}, q, read($('#shf', view))));
    table($('#sht', view), {
      id: 'shipments', exportName: 'shipments', sort: { key: 'shipmentDate', dir: 'desc' },
      rows: () => Store.db.shipments.filter((s) => !s.deletedAt && (!f.from || s.shipmentDate >= f.from) && (!f.to || s.shipmentDate <= f.to)),
      initialFilters: { poolId: q.pool || '', buyerId: q.buyer || '' },
      filters: [{ key: 'poolId', label: 'Pool', options: () => H.poolOpts() }, { key: 'buyerId', label: 'Buyer', options: H.allBuyerOpts }, { key: 'poId', label: 'PO', options: () => Store.db.pos.map((p) => ({ value: p.id, label: p.poNumber })) }, { key: 'styleId', label: 'Style', options: () => H.styleOpts(null, true) }, { key: 'kind', label: 'Difference', options: [{ value: 'short', label: 'Shortage' }, { value: 'excess', label: 'Excess' }, { value: 'partial', label: 'Partial (not final)' }], test: (s, v) => (v === 'short' ? s.diffQty < 0 : v === 'excess' ? s.diffQty > 0 : !s.isFinal) }],
      columns: [
        { key: 'shipNo', label: 'Shipment', render: (s) => `<span class="mono">${esc(s.shipNo)}</span>${testTag(s)}` },
        { key: 'pool', label: 'Pool', value: (s) => (H.pool(s.poolId) || {}).poolNo || '—' },
        { key: 'buyer', label: 'Buyer', value: (s) => H.buyer(s.buyerId).name, hideSm: true },
        { key: 'po', label: 'PO', value: (s) => H.po(s.poId).poNumber },
        { key: 'style', label: 'Style', value: (s) => H.style(s.styleId).styleRef, render: (s) => `${esc(H.style(s.styleId).styleRef)}<div class="small muted">${esc(H.style(s.styleId).description || '')}</div>`, wrap: true },
        { key: 'combo', label: 'Combo', value: (s) => (byId(Store.db, 'lines', s.lineId) || {}).combo },
        { key: 'orderQty', label: 'Order qty', num: true, value: (s) => (byId(Store.db, 'lines', s.lineId) || {}).orderQty, hideSm: true },
        { key: 'unitPrice', label: 'Price', num: true, render: (s) => Fmt.money(s.unitPrice, s.currency) },
        { key: 'shippedQty', label: 'Shipped', num: true, render: (s) => `<b>${Fmt.qty(s.shippedQty)}</b>` },
        { key: 'shipmentDate', label: 'Date', render: (s) => fmtDate(s.shipmentDate) },
        { key: 'exchangeRate', label: 'Rate', num: true, render: (s) => `${Fmt.num(s.exchangeRate, 2)}<div class="small faint">${fmtDate(s.rateDate)}</div>`, hideSm: true },
        { key: 'foreignValue', label: 'Value', num: true, render: (s) => Fmt.money(s.foreignValue, s.currency) },
        { key: 'inrValue', label: 'INR value', num: true, render: (s) => Fmt.inr(s.inrValue) },
        { key: 'diffQty', label: 'Short / excess', num: true, render: (s) => (s.isFinal ? (s.diffQty === 0 ? '0' : `<span class="${s.diffQty < 0 ? 'neg' : 'pos'}">${s.diffQty > 0 ? '+' : ''}${s.diffQty}</span>`) : badge('partial', 'info')) },
        { key: 'differenceReason', label: 'Reason', wrap: true, hideSm: true }, { key: 'invoiceRef', label: 'Invoice', hideSm: true },
      ],
      footer: (rows) => `<td colspan="8">Total</td><td class="num">${Fmt.qty(rows.reduce((a, s) => a + s.shippedQty, 0))}</td><td colspan="3"></td><td class="num">${Fmt.inr(sum(rows, (s) => D(s.inrValue)).toString())}</td><td colspan="3"></td>`,
      actions: (s) => { const p = H.pool(s.poolId); const open = !p || !['CLOSED', 'CANCELLED'].includes(p.status); return act('view', '', '', 'eye', false, 'View') + (open ? guard('shipments.edit', act('edit', '', '', 'edit', false, 'Edit')) + guard('shipments.delete', act('del', '', 'danger', 'trash', false, 'Delete')) : ''); },
      on: {
        view: (s) => viewShipment(s), edit: (s) => editShipment(s),
        del: async (s) => { const why = await ask(`Delete shipment ${s.shipNo}`, 'Reason (kept in audit history)', { danger: true, ok: 'Delete' }); if (why) run(null, async () => { await svc.deleteShipment(s.id, why); toast('Shipment deleted', 'ok'); }); },
      },
    });
    const a = $('#addSh', view); if (a) a.onclick = () => editShipment(null, { poolId: q.pool });
    if (q.view) { UI.consume('view'); const s = byId(Store.db, 'shipments', q.view); if (s) viewShipment(s); }
  });
  function viewShipment(s) {
    const l = byId(Store.db, 'lines', s.lineId);
    modal({
      title: `Shipment ${s.shipNo}`, size: 'lg',
      body: `<dl class="dl"><dt>Pool</dt><dd>${esc((H.pool(s.poolId) || {}).poolNo || '— (not pooled)')}</dd><dt>Order</dt><dd>${esc(H.lineLabel(l))}</dd><dt>Order quantity</dt><dd>${Fmt.qty(l.orderQty)}</dd><dt>Shipped</dt><dd><b>${Fmt.qty(s.shippedQty)}</b> on ${fmtDate(s.shipmentDate)} (cumulative ${Fmt.qty(s.cumulativeShipped)})</dd>
        <dt>Confirmed price</dt><dd>${Fmt.money(s.unitPrice, s.currency)}</dd><dt>Exchange rate</dt><dd>₹${Fmt.num(s.exchangeRate, 4)} per ${esc(s.currency)} — dated ${fmtDate(s.rateDate)} (${s.rateSource === 'TABLE' ? 'from rate table' : 'entered manually'})</dd>
        <dt>Foreign value</dt><dd>${Fmt.money(s.foreignValue, s.currency)} = ${s.shippedQty} × ${Fmt.num(s.unitPrice, 4)}</dd><dt>INR value</dt><dd><b>${Fmt.inr(s.inrValue)}</b> = ${Fmt.num(s.foreignValue)} × ${Fmt.num(s.exchangeRate, 4)}</dd>
        <dt>Final shipment</dt><dd>${s.isFinal ? `Yes — difference ${s.diffQty > 0 ? '+' : ''}${s.diffQty} pcs` : 'No (partial)'}</dd><dt>Reason</dt><dd>${esc(s.differenceReason || '—')}</dd>${s.excessAccepted ? `<dt>Excess accepted</dt><dd>${esc(s.excessRef)}</dd>` : ''}
        <dt>Invoice</dt><dd>${esc(s.invoiceRef || '—')}</dd><dt>Remarks</dt><dd>${esc(s.remarks || '—')}</dd><dt>Recorded</dt><dd>${esc(s.createdBy)} · ${fmtDT(s.createdAt)}</dd></dl>`,
      actions: [{ label: 'Close' }],
    });
  }
  function editShipment(s, preset) {
    const db = Store.db;
    const lines = db.lines.filter((l) => l.status === 'CONFIRMED');
    const v0 = s ? Object.assign({}, s) : Object.assign({ shipmentDate: SP.today(), isFinal: true }, preset || {});
    const m = modal({
      title: s ? `Edit shipment ${s.shipNo}` : 'Record shipment', size: 'xl',
      body: `<div class="form-grid">
        ${UI.field({ name: 'lineId', label: 'Order (PO / style / combo)', type: 'select', search: true, required: true, span: 's8', options: lines.map((l) => ({ value: l.id, label: `${H.lineLabel(l)} — ${l.orderQty} pcs` })), disabled: !!s }, v0.lineId)}
        ${UI.field({ name: 'poolId', label: 'Pool', type: 'select', options: [], span: 's4', placeholder: '— Not pooled —' }, v0.poolId)}
        <div class="fld s12"><div id="lineInfo" class="notice info" style="margin:0">Select an order line.</div></div>
        ${UI.field({ name: 'shippedQty', label: 'Shipped quantity', type: 'int', required: true, span: 's3', min: 1 }, v0.shippedQty)}
        ${UI.field({ name: 'shipmentDate', label: 'Shipment date', type: 'date', required: true, span: 's3' }, v0.shipmentDate)}
        ${UI.field({ name: 'rateId', label: 'Exchange rate (table)', type: 'select', options: [], span: 's3', placeholder: 'Manual entry' }, v0.rateId)}
        ${UI.field({ name: 'exchangeRate', label: 'INR per unit', type: 'decimal', required: true, span: 's3' }, v0.exchangeRate)}
        ${UI.field({ name: 'rateDate', label: 'Exchange-rate date', type: 'date', required: true, span: 's3' }, v0.rateDate)}
        ${UI.field({ name: 'fv', label: 'Foreign value', type: 'static', span: 's3', html: '<b id="shF">—</b>' })}
        ${UI.field({ name: 'iv', label: 'INR value', type: 'static', span: 's3', html: '<b id="shI">—</b>' })}
        ${UI.field({ name: 'dv', label: 'Order vs shipped', type: 'static', span: 's3', html: '<b id="shD">—</b>' })}
        ${UI.field({ name: 'isFinal', label: 'Final shipment for this order line (completes it)', type: 'checkbox', span: 's6' }, v0.isFinal)}
        ${UI.field({ name: 'invoiceRef', label: 'Invoice reference', span: 's6', help: 'Used to prevent double counting' }, v0.invoiceRef)}
        ${UI.field({ name: 'differenceReason', label: 'Difference reason', type: 'textarea', span: 's6', help: 'Required when the final shipped total differs from the order' }, v0.differenceReason)}
        ${UI.field({ name: 'remarks', label: 'Remarks', type: 'textarea', span: 's6' }, v0.remarks)}
        <div class="fld s12 hidden" id="excessBox"><div class="notice warn" style="margin:0 0 8px">Shipped total exceeds the allowed excess (${esc(db.settings.shipment.maxExcessPct)}%). Commercial acceptance by the buyer is required.</div><div class="form-grid">${UI.field({ name: 'excessAccepted', label: 'Excess commercially accepted', type: 'checkbox', span: 's6' }, v0.excessAccepted)}${UI.field({ name: 'excessRef', label: 'Acceptance reference', span: 's6' }, v0.excessRef)}</div></div>
      </div>`,
      actions: [{ label: 'Cancel' }, { label: 'Save shipment', cls: 'primary', onClick: async (mm) => { const v = read(mm.el); ['fv', 'iv', 'dv'].forEach((k) => delete v[k]); if (s) v.lineId = s.lineId; const x = await svc.saveShipment(Object.assign(v, { id: s && s.id })); toast(`${x.shipNo} saved`, 'ok'); } }],
    });
    const el = m.el; const S = (n) => $(`[name=${n}]`, el);
    const line = () => byId(Store.db, 'lines', s ? s.lineId : S('lineId').value);
    const fillLine = (first) => {
      const l = line();
      if (!l) { $('#lineInfo', el).textContent = 'Select an order line.'; UI.setOptions(S('poolId'), [], '', '— Not pooled —'); return; }
      const pools = Store.db.allocations.filter((a) => a.lineId === l.id && a.status === 'ACTIVE').map((a) => H.pool(a.poolId)).filter((p) => p && ['ACTIVE', 'REOPENED'].includes(p.status));
      UI.setOptions(S('poolId'), pools.map((p) => ({ value: p.id, label: p.poolNo })), first && v0.poolId ? v0.poolId : pools.length === 1 ? pools[0].id : '', '— Not pooled —');
      const rs = Store.db.rates.filter((r) => r.currency === l.currency).sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
      UI.setOptions(S('rateId'), rs.map((r) => ({ value: r.id, label: `₹${Fmt.num(r.inrPerUnit, 4)} — ${fmtDate(r.effectiveDate)}` })), first && s ? (s.rateId || '') : '', 'Manual entry');
      if (!s && first !== 'keep') { const r = SP.rateOn(Store.db, l.currency, S('shipmentDate').value); if (r) { S('rateId').value = r.id; S('exchangeRate').value = r.inrPerUnit; S('rateDate').value = r.effectiveDate; } }
      calc();
    };
    const calc = () => {
      const l = line(); if (!l) return;
      const mtr = SP.lineMetrics(Store.db, l);
      const prev = mtr.shipped - (s ? s.shippedQty : 0);
      const qty = Number(S('shippedQty').value || 0);
      const cum = prev + (Number.isInteger(qty) ? qty : 0);
      $('#lineInfo', el).innerHTML = `Order <b>${Fmt.qty(l.orderQty)}</b> pcs · confirmed price <b>${Fmt.money(l.confirmedPrice, l.currency)}</b> · already shipped ${Fmt.qty(prev)} · remaining ${Fmt.qty(Math.max(0, l.orderQty - prev))} · pooled in ${Store.db.allocations.filter((a) => a.lineId === l.id && a.status === 'ACTIVE').map((a) => (H.pool(a.poolId) || {}).poolNo).join(', ') || 'none'}`;
      try { const v = Calc.shipmentValues(qty || 0, l.confirmedPrice, S('exchangeRate').value || '0'); $('#shF', el).textContent = Fmt.money(v.foreign, l.currency); $('#shI', el).textContent = Fmt.inr(v.inr); }
      catch (e) { $('#shF', el).textContent = Fmt.money(D(qty || 0).mul(l.confirmedPrice).round(2).toString(), l.currency); $('#shI', el).textContent = 'enter rate'; }
      const final = S('isFinal').checked || cum >= l.orderQty;
      const d = cum - l.orderQty;
      $('#shD', el).innerHTML = final ? (d === 0 ? 'Matches order' : `<span class="${d < 0 ? 'neg' : 'pos'}">${d < 0 ? 'Shortage' : 'Excess'} ${Math.abs(d)} pcs</span>`) : `Partial — ${Fmt.qty(Math.max(0, l.orderQty - cum))} pcs pending`;
      const reqR = final && d !== 0; const rf = S('differenceReason').closest('.fld'); rf.querySelector('label').innerHTML = 'Difference reason' + (reqR ? ' <span class="req">*</span>' : '');
      const maxEx = D(l.orderQty).mul(D(1).add(D(Store.db.settings.shipment.maxExcessPct).div(100))).toNumber();
      $('#excessBox', el).classList.toggle('hidden', !(cum > maxEx));
    };
    if (!s) S('lineId').addEventListener('change', () => fillLine(false));
    S('rateId').addEventListener('change', () => { const r = byId(Store.db, 'rates', S('rateId').value); if (r) { S('exchangeRate').value = r.inrPerUnit; S('rateDate').value = r.effectiveDate; } calc(); });
    S('exchangeRate').addEventListener('input', () => { S('rateId').value = ''; if (S('rateId')._refresh) S('rateId')._refresh(); calc(); });
    S('shipmentDate').addEventListener('change', () => { if (!s && !S('rateId').value && !S('exchangeRate').value) fillLine('date'); calc(); });
    ['shippedQty', 'isFinal'].forEach((n) => { S(n).addEventListener('input', calc); S(n).addEventListener('change', calc); });
    fillLine(true);
  }

  /* ---------- Pool shipment summary + adjustments ---------- */
  App.route('shipments/summary', 'shipments.view', async (view, q) => {
    const p = q.pool ? byId(Store.db, 'pools', q.pool) : null;
    view.innerHTML = pageHead('Pool Shipment Summary', 'All values are fetched from shipment and adjustment records. Totals cannot be edited directly.', p ? btn('Print / PDF', 'id="prS"', '', 'print') + btn('Excel', 'id="xlS"', '', 'dl') : '', '<a href="#/shipments">Shipments</a> / Pool summary') + H.poolBar(view, q, 'shipments/summary', (x) => x.status !== 'CANCELLED');
    H.bindPoolBar(view, 'shipments/summary');
    if (!p) { view.insertAdjacentHTML('beforeend', '<div class="card">' + empty('Select a pool') + '</div>'); return; }
    const r = SP.computePool(Store.db, p.id);
    const rows = flatShipRows(p, r);
    const open = ['ACTIVE', 'REOPENED'].includes(p.status);
    view.insertAdjacentHTML('beforeend', `<div class="kpis"><div class="kpi"><div class="l">Pool order qty</div><div class="v">${Fmt.qty(r.totals.orderQty)}</div></div><div class="kpi"><div class="l">Shipped qty</div><div class="v">${Fmt.qty(r.totals.shippedQty)}</div></div>${Object.entries(r.shipments.foreignByCur).map(([c, v]) => `<div class="kpi"><div class="l">Shipment value (${esc(c)})</div><div class="v">${Fmt.money(v, c)}</div></div>`).join('')}<div class="kpi"><div class="l">INR shipment value</div><div class="v">${Fmt.inr(r.totals.shipmentInr)}</div></div><div class="kpi ok"><div class="l">+ Additions</div><div class="v">${Fmt.inr(r.totals.additions)}</div></div><div class="kpi bad"><div class="l">− Deductions</div><div class="v">${Fmt.inr(r.totals.deductions)}</div></div><div class="kpi"><div class="l">Overall adjusted INR</div><div class="v">${Fmt.inr(r.totals.inrReceived)}</div><div class="s">INR value + additions − deductions</div></div></div>
      <div class="card"><div class="hd"><h2>Pooled orders — ${esc(p.poolNo)}</h2>${status(p.status)}</div><div class="bd p0" id="ss"></div></div>
      <div class="card"><div class="hd"><h2>Additions &amp; deductions (INR)</h2>${open ? guard('adjustments.edit', btn('Add addition', 'id="adA"', 'sm', 'plus') + btn('Add deduction', 'id="adD"', 'sm', 'plus')) : ''}</div><div class="bd p0" id="adj"></div></div>`);
    table($('#ss', view), {
      id: 'ss-' + p.id, noPaging: true, rows, exportName: `${p.poolNo}-shipment-summary`,
      columns: [
        { key: 'poNumber', label: 'PO' }, { key: 'styleRef', label: 'Style' }, { key: 'description', label: 'Description', wrap: true, hideSm: true }, { key: 'combo', label: 'Combo' },
        { key: 'allocQty', label: 'Order qty', num: true }, { key: 'price', label: 'Confirmed price', num: true, render: (x) => Fmt.money(x.price, x.currency), exportValue: (x) => x.price },
        { key: 'shipped', label: 'Shipped qty', num: true }, { key: 'date', label: 'Shipment date', render: (x) => fmtDate(x.date) },
        { key: 'foreign', label: 'Value', num: true, render: (x) => (x.foreign === null ? '—' : Fmt.money(x.foreign, x.currency)), exportValue: (x) => x.foreign },
        { key: 'rate', label: 'Exchange INR', num: true, render: (x) => (x.rate ? Fmt.num(x.rate, 2) : '—') }, { key: 'rateDate', label: 'Exchange date', render: (x) => fmtDate(x.rateDate) },
        { key: 'inr', label: 'INR value', num: true, render: (x) => (x.inr === null ? '—' : Fmt.inr(x.inr)), exportValue: (x) => x.inr },
        { key: 'diff', label: 'Order vs shipped', num: true, render: (x) => (x.diff === null ? '—' : x.diff === 0 ? '0' : `<span class="${x.diff < 0 ? 'neg' : 'pos'}">${x.diff > 0 ? '+' : ''}${x.diff}</span>`) },
        { key: 'reason', label: 'Reason', wrap: true },
      ],
      footer: () => `<td colspan="4">Total</td><td class="num">${Fmt.qty(r.totals.orderQty)}</td><td></td><td class="num">${Fmt.qty(r.totals.shippedQty)}</td><td></td><td class="num">${Object.entries(r.shipments.foreignByCur).map(([c, v]) => Fmt.money(v, c)).join('<br>')}</td><td colspan="2"></td><td class="num">${Fmt.inr(r.totals.shipmentInr)}</td><td colspan="2"></td>`,
    });
    table($('#adj', view), {
      id: 'adj-' + p.id, noToolbar: true, noPaging: true, rows: r.adjustments.list, empty: 'No additions or deductions',
      columns: [{ key: 'adjNo', label: 'ID', render: (x) => `<span class="mono">${esc(x.adjNo)}</span>${testTag(x)}` }, { key: 'type', label: 'Type', render: (x) => badge(x.type === 'ADDITION' ? 'Addition' : 'Deduction', x.type === 'ADDITION' ? 'ok' : 'bad') }, { key: 'date', label: 'Date', render: (x) => fmtDate(x.date) }, { key: 'amount', label: 'Amount', num: true, render: (x) => `${x.type === 'DEDUCTION' ? '−' : '+'}${Fmt.inr(x.amount)}` }, { key: 'reason', label: 'Reason', wrap: true }, { key: 'reference', label: 'Reference' }, { key: 'createdBy', label: 'By' }],
      footer: () => `<td colspan="3">Net adjustment</td><td class="num">${Fmt.inr(D(r.totals.additions).sub(r.totals.deductions).toString())}</td><td colspan="3"></td>`,
      actions: () => (open ? guard('adjustments.edit', act('edit', '', '', 'edit', false, 'Edit') + act('del', '', 'danger', 'trash', false, 'Delete')) : ''),
      on: {
        edit: (x) => editAdj(p, x.type, x),
        del: async (x) => { const why = await ask(`Delete ${x.adjNo}`, 'Reason', { danger: true, ok: 'Delete' }); if (why) run(null, async () => { await svc.deleteAdjustment(x.id, why); toast('Deleted', 'ok'); }); },
      },
    });
    const aa = $('#adA', view); if (aa) aa.onclick = () => editAdj(p, 'ADDITION');
    const ad = $('#adD', view); if (ad) ad.onclick = () => editAdj(p, 'DEDUCTION');
    $('#prS', view).onclick = () => printShipSummary(p, r, rows);
    $('#xlS', view).onclick = () => { if (!can('reports.export')) return toast('No export permission', 'bad'); UI.downloadXLS(`${p.poolNo}-shipment-summary`, [{ name: 'Shipments', head: ['Pool', 'PO', 'Style', 'Description', 'Combo', 'Order qty', 'Confirmed price', 'Currency', 'Shipped qty', 'Shipment date', 'Value', 'Exchange INR', 'Exchange date', 'INR value', 'Reason'], rows: rows.map((x) => [p.poolNo, x.poNumber, x.styleRef, x.description, x.combo, x.allocQty, x.price, x.currency, x.shipped, x.date, x.foreign, x.rate, x.rateDate, x.inr, x.reason]) }, { name: 'Adjustments', head: ['ID', 'Type', 'Date', 'Amount INR', 'Reason', 'Reference'], rows: r.adjustments.list.map((x) => [x.adjNo, x.type, x.date, x.amount, x.reason, x.reference]) }, { name: 'Totals', head: ['Item', 'Value'], rows: [['Total INR shipment value', r.totals.shipmentInr], ['Additions', r.totals.additions], ['Deductions', r.totals.deductions], ['Overall adjusted INR', r.totals.inrReceived]] }]); };
  });
  function flatShipRows(p, r) {
    const out = [];
    r.shipments.rows.forEach((row) => {
      if (!row.shipments.length) out.push({ poNumber: row.poNumber, styleRef: row.styleRef, description: row.description, combo: row.combo, allocQty: row.allocQty, price: row.price, currency: row.currency, shipped: 0, date: null, foreign: null, rate: null, rateDate: null, inr: null, diff: null, reason: 'Not shipped' });
      row.shipments.forEach((s, i) => out.push({ poNumber: row.poNumber, styleRef: row.styleRef, description: row.description, combo: row.combo, allocQty: i === 0 ? row.allocQty : '', price: s.unitPrice, currency: s.currency, shipped: s.shippedQty, date: s.shipmentDate, foreign: s.foreignValue, rate: s.exchangeRate, rateDate: s.rateDate, inr: s.inrValue, diff: s.isFinal ? row.shipped - row.allocQty : null, reason: s.differenceReason || '' }));
    });
    return out;
  }
  function editAdj(p, type, x) {
    modal({
      title: `${x ? 'Edit' : 'Add'} ${type === 'ADDITION' ? 'addition' : 'deduction'} — ${p.poolNo}`,
      body: form([{ name: 'amount', label: 'Amount (INR)', type: 'decimal', required: true, span: 's6' }, { name: 'date', label: 'Date', type: 'date', required: true, span: 's6' }, { name: 'reason', label: 'Reason', type: 'textarea', required: true, span: 's12' }, { name: 'reference', label: 'Reference (debit/credit note etc.)', span: 's12' }], x || { date: SP.today() }),
      actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: async (m) => { await svc.saveAdjustment(Object.assign(read(m.el), { id: x && x.id, poolId: p.id, type })); toast('Saved', 'ok'); } }],
    });
  }
  function printShipSummary(p, r, rows) {
    UI.printDoc(`Pool shipment summary — ${p.poolNo}`, `${p.isTest ? '<div class="test">TEST DATA</div>' : ''}<div class="grid"><div><b>Buyer:</b> ${esc(H.buyer(p.buyerId).name)}</div><div><b>Status:</b> ${esc(p.status)}</div></div>
      <table><thead><tr><th>PO</th><th>Style</th><th>Description</th><th>Combo</th><th class="num">Order qty</th><th class="num">Price</th><th class="num">Shipped</th><th>Date</th><th class="num">Value</th><th class="num">Exch.</th><th>Exch. date</th><th class="num">INR value</th><th>Reason</th></tr></thead><tbody>${rows.map((x) => `<tr><td>${esc(x.poNumber)}</td><td>${esc(x.styleRef)}</td><td>${esc(x.description || '')}</td><td>${esc(x.combo)}</td><td class="num">${esc(x.allocQty)}</td><td class="num">${Fmt.money(x.price, x.currency)}</td><td class="num">${x.shipped}</td><td>${fmtDate(x.date)}</td><td class="num">${x.foreign === null ? '—' : Fmt.money(x.foreign, x.currency)}</td><td class="num">${x.rate ? Fmt.num(x.rate) : '—'}</td><td>${fmtDate(x.rateDate)}</td><td class="num">${x.inr === null ? '—' : Fmt.num(x.inr)}</td><td>${esc(x.reason)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="4">Total</td><td class="num">${r.totals.orderQty}</td><td></td><td class="num">${r.totals.shippedQty}</td><td></td><td class="num">${Object.entries(r.shipments.foreignByCur).map(([c, v]) => Fmt.money(v, c)).join(' ')}</td><td colspan="2"></td><td class="num">${Fmt.num(r.totals.shipmentInr)}</td><td></td></tr></tfoot></table>
      <h2>Additions &amp; deductions</h2><table><thead><tr><th>Type</th><th>Date</th><th class="num">Amount</th><th>Reason</th></tr></thead><tbody>${r.adjustments.list.map((x) => `<tr><td>${esc(x.type)}</td><td>${fmtDate(x.date)}</td><td class="num">${Fmt.num(x.amount)}</td><td>${esc(x.reason)}</td></tr>`).join('') || '<tr><td colspan="4">None</td></tr>'}</tbody></table>
      <table><tbody><tr><td>Total INR shipment value</td><td class="num">${Fmt.inr(r.totals.shipmentInr)}</td></tr><tr><td>+ Additions</td><td class="num">${Fmt.inr(r.totals.additions)}</td></tr><tr><td>− Deductions</td><td class="num">${Fmt.inr(r.totals.deductions)}</td></tr><tr><td><b>Overall adjusted INR</b></td><td class="num"><b>${Fmt.inr(r.totals.inrReceived)}</b></td></tr></tbody></table>`);
  }

  /* ======================= EXPENSE LIMITS ======================= */
  App.route('limits', ['reports.view', 'expenses.view'], async (view, q) => {
    const p = q.pool ? byId(Store.db, 'pools', q.pool) : null;
    view.innerHTML = pageHead('Expense Limit Analysis', 'Expense limit = applicable order qty × costing cost per piece × (1 + costing variance %). Difference = limit − actual (positive = under the limit).') + H.poolBar(view, q, 'limits', (x) => x.status !== 'CANCELLED');
    H.bindPoolBar(view, 'limits');
    if (!p) { view.insertAdjacentHTML('beforeend', '<div class="card">' + empty('Select a pool') + '</div>'); return; }
    const r = SP.computePool(Store.db, p.id); const v = r.variance;
    const METH = { SIMPLE_AVG: 'Simple average of style variances', QTY_WEIGHTED: 'Quantity-weighted average', VALUE_WEIGHTED: 'Value-weighted average' };
    view.insertAdjacentHTML('beforeend', `${r.errors.length ? `<div class="notice bad">${r.errors.map(esc).join('<br>')}</div>` : ''}
      <div class="kpis"><div class="kpi"><div class="l">Total expense limits</div><div class="v">${Fmt.inr(r.totals.totalLimits)}</div></div><div class="kpi"><div class="l">Total actual expenses</div><div class="v">${Fmt.inr(r.totals.totalActual)}</div></div><div class="kpi ${D(r.totals.expenseDiff).isNeg() ? 'bad' : 'ok'}"><div class="l">Difference (limit − actual)</div><div class="v">${Fmt.inr(r.totals.expenseDiff)}</div><div class="s">${r.totals.expenseDiffPct === null ? '' : Fmt.pct(r.totals.expenseDiffPct) + ' of limits'}</div></div><div class="kpi"><div class="l">Variance applied</div><div class="v">${v.override ? Fmt.pct(v.override.pct) : v.scope === 'STYLE' ? 'Per style' : Fmt.pct(v.computedPoolPct)}</div><div class="s">${v.override ? 'manual override' : esc(METH[v.method])}</div></div></div>
      <div class="card"><div class="hd"><h2>Costing variance (confirmed price vs costing)</h2>${['CLOSED', 'CANCELLED'].includes(p.status) ? '' : guard('pools.edit', btn(v.override ? 'Change / clear override' : 'Set approved override', 'id="ovr"', 'sm'))}</div><div class="bd">
        ${v.approved ? '' : '<div class="notice warn">The variance aggregation method is <b>pending client confirmation</b> (Settings → Expense limits). The workbook shows −3.99% for BGPL-001, which none of the standard methods reproduce from the source prices.</div>'}
        <p class="small muted" style="margin-top:0">Per order: (confirmed price × costing exchange rate − costing total INR) ÷ costing total INR. Style value = quantity-weighted over its orders. Pool value = ${esc(METH[v.method])}. Scope: ${v.scope === 'STYLE' ? 'each style uses its own variance' : 'one pool-level variance for all styles'}. Applied to: ${v.categories.map((c) => esc(H.catLabel(c))).join(', ')}.</p>
        <div class="table-wrap"><table class="t"><thead><tr><th>Style</th><th>Costing</th><th class="num">Costing INR</th><th class="num">Rate</th><th class="num">Costing price</th><th class="num">Confirmed price</th><th class="num">Qty</th><th class="num">Variance %</th></tr></thead><tbody>
        ${v.styles.flatMap((s) => s.parts.map((x, i) => `<tr><td>${i === 0 ? `<b>${esc(s.styleRef)}</b>` : ''}</td><td>${esc(x.costingLabel)}</td><td class="num">${Fmt.inr(x.costingInr)}</td><td class="num">${Fmt.num(x.rate, 2)}</td><td class="num">${Fmt.num(x.costingPrice, 4)}</td><td class="num">${Fmt.num(x.confirmed, 2)}</td><td class="num">${Fmt.qty(x.qty)}</td><td class="num">${signed(x.pct, (y) => Fmt.pct(y))}</td></tr>`).concat(s.parts.length > 1 ? [`<tr class="sub"><td colspan="7">${esc(s.styleRef)} weighted</td><td class="num">${Fmt.pct(s.pct)}</td></tr>`] : [])).join('')}
        </tbody><tfoot><tr><td colspan="7">Pool variance (${esc(METH[v.method])})</td><td class="num">${Fmt.pct(v.computedPoolPct)}</td></tr>${v.override ? `<tr><td colspan="7">Approved override — ${esc(v.override.reason)} (${esc(v.override.by)}, ${fmtDate(v.override.at)})</td><td class="num">${Fmt.pct(v.override.pct)}</td></tr>` : ''}</tfoot></table></div></div></div>
      <div class="card"><div class="hd"><h2>By category</h2></div><div class="bd p0" id="lc"></div></div>
      <div class="card"><div class="hd"><h2>By style and category</h2></div><div class="bd p0" id="ls"></div></div>`);
    const stCell = (x) => (x.status === 'OVER' ? badge('Over limit', 'bad') : x.status === 'UNDER' ? badge('Within limit', 'ok') : badge('At limit', 'info'));
    table($('#lc', view), {
      id: 'lim-cat-' + p.id, noPaging: true, rows: r.byCat, exportName: `${p.poolNo}-expense-limits-by-category`,
      columns: [{ key: 'label', label: 'Category', render: (x) => `<b>${esc(x.label)}</b>` }, { key: 'limit', label: 'Expense limit', num: true, render: (x) => Fmt.inr(x.limit) }, { key: 'actual', label: 'Actual', num: true, render: (x) => Fmt.inr(x.actual) }, { key: 'diff', label: 'Difference', num: true, render: (x) => signed(x.diff) }, { key: 'diffPct', label: 'Diff %', num: true, render: (x) => (x.diffPct === null ? '—' : Fmt.pct(x.diffPct)) }, { key: 'status', label: 'Status', render: stCell }, { key: 'entries', label: 'Entries', num: true }],
      footer: () => `<td>Total</td><td class="num">${Fmt.inr(r.totals.totalLimits)}</td><td class="num">${Fmt.inr(r.totals.totalActual)}</td><td class="num">${signed(r.totals.expenseDiff)}</td><td class="num">${r.totals.expenseDiffPct === null ? '—' : Fmt.pct(r.totals.expenseDiffPct)}</td><td colspan="2"></td>`,
      onRow: (x) => drill(p, r, null, x.category),
    });
    table($('#ls', view), {
      id: 'lim-sty-' + p.id, rows: r.limits, exportName: `${p.poolNo}-expense-limits`, pageSize: 30,
      filters: [{ key: 'styleRef', label: 'Style', options: () => Array.from(new Set(r.limits.map((x) => x.styleRef))) }, { key: 'category', label: 'Category', options: () => r.byCat.map((c) => ({ value: c.category, label: c.label })) }, { key: 'status', label: 'Status', options: ['UNDER', 'OVER', 'EQUAL'] }],
      columns: [
        { key: 'styleRef', label: 'Style', render: (x) => `<b>${esc(x.styleRef)}</b>` }, { key: 'categoryLabel', label: 'Category' },
        { key: 'qty', label: 'Applicable qty', num: true, render: (x) => (x.qty === null ? '—' : Fmt.qty(x.qty)) },
        { key: 'costPerPiece', label: 'Cost / pc (costing)', num: true, render: (x) => (x.costPerPiece === null ? '—' : Fmt.inr(x.costPerPiece)) },
        { key: 'variancePct', label: 'Variance %', num: true, render: (x) => (x.variancePct === null ? '—' : x.varianceApplied ? Fmt.pct(x.variancePct) : '<span class="faint">not applied</span>') },
        { key: 'limit', label: 'Expense limit', num: true, render: (x) => Fmt.inr(x.limit) }, { key: 'actual', label: 'Actual', num: true, render: (x) => Fmt.inr(x.actual) },
        { key: 'diff', label: 'Difference', num: true, render: (x) => signed(x.diff) }, { key: 'diffPct', label: 'Diff %', num: true, render: (x) => (x.diffPct === null ? '—' : Fmt.pct(x.diffPct)) }, { key: 'status', label: 'Status', render: stCell },
      ],
      onRow: (x) => drill(p, r, x.styleId, x.category),
    });
    const ov = $('#ovr', view);
    if (ov) ov.onclick = () => modal({
      title: 'Costing variance override', body: `<p class="small muted">Use only for a client-approved variance (e.g. the workbook's value). Leave the percentage blank to remove the override and use the calculated value (${Fmt.pct(v.computedPoolPct)}).</p>` + form([{ name: 'pct', label: 'Variance %', type: 'decimal', span: 's6', placeholder: 'e.g. -3.99' }, { name: 'reason', label: 'Approval / reason', type: 'textarea', span: 's12' }], v.override || {}),
      actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: async (m) => { const x = read(m.el); await svc.setVarianceOverride(p.id, x.pct, x.reason); toast('Saved', 'ok'); } }],
    });
  });
  function drill(p, r, styleId, cat) {
    const db = Store.db;
    const exps = db.expenses.filter((e) => e.poolId === p.id && !e.deletedAt && e.category === cat && (styleId === null || (e.styleId || null) === styleId) && (styleId !== null || true));
    const allocs = r.allocations.filter((a) => styleId === null || a.styleId === styleId);
    const vp = (sid) => (r.limits.find((l) => l.styleId === sid && l.category === cat) || {}).variancePct;
    modal({
      title: `${H.catLabel(cat)}${styleId ? ' — ' + H.style(styleId).styleRef : ''} — ${p.poolNo}`, size: 'xl',
      body: `<h3 style="margin:0 0 6px">Limit build-up (from costing × allocated qty)</h3><div class="table-wrap"><table class="t"><thead><tr><th>Order</th><th>Style</th><th>Costing</th><th class="num">Allocated qty</th><th class="num">Cost / pc</th><th class="num">Qty × cost</th><th class="num">Variance %</th></tr></thead><tbody>${allocs.map((a) => { const l = byId(db, 'lines', a.lineId); const c = byId(db, 'costings', l.costingId); const cpp = c ? c.results.categories[cat] || '0' : '0'; return `<tr><td>${esc(a.confNo)} ${esc(a.poNumber)} ${esc(a.combo)}</td><td>${esc(a.styleRef)}</td><td>${esc(c ? c.label : '—')}</td><td class="num">${a.qty}</td><td class="num">${Fmt.inr(cpp)}</td><td class="num">${Fmt.inr(D(a.qty).mul(cpp).toString())}</td><td class="num">${vp(a.styleId) ? Fmt.pct(vp(a.styleId)) : '—'}</td></tr>`; }).join('')}</tbody></table></div>
        <h3 style="margin:14px 0 6px">Actual expense entries</h3><div class="table-wrap"><table class="t"><thead><tr><th>Entry</th><th>Style</th><th>Item</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th><th>Status</th></tr></thead><tbody>${exps.map((e) => `<tr><td>${esc(e.expNo)}</td><td>${esc(e.styleId ? H.style(e.styleId).styleRef : 'Shared')}</td><td>${esc(e.itemName)}</td><td class="num">${Fmt.num(e.qty, 3)} ${esc(e.unit || '')}</td><td class="num">${Fmt.num(e.rate)}</td><td class="num">${Fmt.inr(e.amount)}</td><td>${status(e.status)}</td></tr>`).join('') || '<tr><td colspan="7" class="empty small">No entries</td></tr>'}</tbody><tfoot><tr><td colspan="5">Total saved</td><td class="num">${Fmt.inr(sum(exps.filter((e) => e.status === 'SAVED'), (e) => D(e.amount)).toString())}</td><td></td></tr></tfoot></table></div>
        <p style="margin-top:12px"><a class="btn sm" href="#/expenses?pool=${p.id}&cat=${cat}">Open in expense workspace</a></p>`,
      actions: [{ label: 'Close' }],
    });
  }

  /* ======================= PROFITABILITY ======================= */
  App.route('profitability', 'reports.view', async (view, q) => {
    const db = Store.db;
    const tab = q.tab || (q.pool ? 'pool' : 'pools');
    const f = { buyer: q.buyer || '', season: q.season || '', from: q.from || '', to: q.to || '', st: q.st || '' };
    const pools = db.pools.filter((p) => p.status !== 'CANCELLED' && (!f.buyer || p.buyerId === f.buyer) && (!f.season || p.season === f.season) && (!f.st || (f.st === 'CLOSED' ? p.status === 'CLOSED' : p.status !== 'CLOSED')) &&
      (!f.from && !f.to || db.shipments.some((s) => s.poolId === p.id && !s.deletedAt && (!f.from || s.shipmentDate >= f.from) && (!f.to || s.shipmentDate <= f.to))));
    const reps = pools.map((p) => SP.computePool(db, p.id));
    const TABS = [['pools', 'Pool-level'], ['pool', 'Pool detail'], ['style', 'Style-wise'], ['buyer', 'Buyer-wise'], ['season', 'Season-wise'], ['category', 'Category comparison']];
    view.innerHTML = pageHead('Profitability Reports', 'Budget-based margin = INR received − expense limits (estimate). Actual expense-based margin = INR received − actual expenses (result). Additions and deductions are included once, inside INR received.') +
      `<div class="tabs" role="tablist">${TABS.map(([k, l]) => `<button role="tab" class="${k === tab ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>` +
      (tab !== 'pool' ? `<form class="filters" id="pf">${UI.field({ name: 'buyer', label: 'Buyer', type: 'select', options: H.allBuyerOpts(), placeholder: 'All' }, f.buyer)}${UI.field({ name: 'season', label: 'Season', type: 'select', options: H.seasonOpts(), placeholder: 'All' }, f.season)}${UI.field({ name: 'st', label: 'Closure', type: 'select', options: [{ value: 'CLOSED', label: 'Closed' }, { value: 'OPEN', label: 'Open' }], placeholder: 'All' }, f.st)}${UI.field({ name: 'from', label: 'Shipments from', type: 'date' }, f.from)}${UI.field({ name: 'to', label: 'to', type: 'date' }, f.to)}</form>` : '') + '<div id="pbody"></div>';
    $$('[data-tab]', view).forEach((b) => (b.onclick = () => App.go('profitability', Object.assign({}, q, { tab: b.dataset.tab }))));
    const pf = $('#pf', view); if (pf) pf.onchange = () => App.go('profitability', Object.assign({ tab }, read(pf)));
    const body = $('#pbody', view);
    const mcell = (m, pct) => `${signed(m)}${pct !== null && pct !== undefined ? `<div class="small faint">${Fmt.pct(pct)}</div>` : ''}`;
    const agg = (key, label, group) => {
      const map = new Map();
      reps.forEach((r) => { const k = group(r); if (!map.has(k)) map.set(k, { key: k, label: label(r), pools: 0, qty: 0, shipped: 0, inr: D(0), lim: D(0), act: D(0), add: D(0), ded: D(0) }); const x = map.get(k); x.pools++; x.qty += r.totals.orderQty; x.shipped += r.totals.shippedQty; x.inr = x.inr.add(r.totals.inrReceived); x.lim = x.lim.add(r.totals.totalLimits); x.act = x.act.add(r.totals.totalActual); x.add = x.add.add(r.totals.additions); x.ded = x.ded.add(r.totals.deductions); });
      return Array.from(map.values()).map((x) => Object.assign(x, { inr: x.inr.toString(), lim: x.lim.toString(), act: x.act.toString(), add: x.add.toString(), ded: x.ded.toString() }, Calc.margins({ inrReceived: x.inr, totalLimits: x.lim, totalActual: x.act })));
    };
    const aggCols = (label) => [
      { key: 'label', label, render: (x) => `<b>${esc(x.label)}</b>` }, { key: 'pools', label: 'Pools', num: true }, { key: 'qty', label: 'Pool qty', num: true, render: (x) => Fmt.qty(x.qty) }, { key: 'shipped', label: 'Shipped', num: true, render: (x) => Fmt.qty(x.shipped) },
      { key: 'inr', label: 'INR received', num: true, render: (x) => Fmt.inr(x.inr) }, { key: 'lim', label: 'Expense limits', num: true, render: (x) => Fmt.inr(x.lim) }, { key: 'act', label: 'Actual expenses', num: true, render: (x) => Fmt.inr(x.act) },
      { key: 'budgetMargin', label: 'Budget-based margin', num: true, render: (x) => mcell(x.budgetMargin, x.budgetMarginPct) }, { key: 'actualMargin', label: 'Actual-based margin', num: true, render: (x) => mcell(x.actualMargin, x.actualMarginPct) },
    ];
    if (tab === 'pools') {
      body.innerHTML = '<div class="card"><div class="bd p0" id="pt"></div></div>';
      table($('#pt', body), {
        id: 'profit-pools', rows: reps, exportName: 'pool-profitability', sort: { key: 'poolNo', dir: 'desc' },
        columns: [
          { key: 'poolNo', label: 'Pool', value: (r) => r.pool.poolNo, render: (r) => `<a href="#/profitability?pool=${r.pool.id}"><b>${esc(r.pool.poolNo)}</b></a>${testTag(r.pool)}` },
          { key: 'buyer', label: 'Buyer', value: (r) => (r.buyer || {}).name }, { key: 'season', label: 'Season', value: (r) => r.pool.season, hideSm: true },
          { key: 'qty', label: 'Order qty', num: true, value: (r) => r.totals.orderQty }, { key: 'shipped', label: 'Shipped', num: true, value: (r) => r.totals.shippedQty },
          { key: 'inrShip', label: 'Shipment INR', num: true, value: (r) => r.totals.shipmentInr, render: (r) => Fmt.inr(r.totals.shipmentInr), hideSm: true },
          { key: 'adj', label: 'Add / ded', num: true, value: (r) => D(r.totals.additions).sub(r.totals.deductions).toString(), render: (r) => `<span class="pos">+${Fmt.num(r.totals.additions, 0)}</span><br><span class="neg">−${Fmt.num(r.totals.deductions, 0)}</span>`, hideSm: true },
          { key: 'inr', label: 'INR received', num: true, value: (r) => r.totals.inrReceived, render: (r) => `<b>${Fmt.inr(r.totals.inrReceived)}</b>` },
          { key: 'lim', label: 'Expense limits', num: true, value: (r) => r.totals.totalLimits, render: (r) => Fmt.inr(r.totals.totalLimits) },
          { key: 'act', label: 'Actual expenses', num: true, value: (r) => r.totals.totalActual, render: (r) => Fmt.inr(r.totals.totalActual) },
          { key: 'bm', label: 'Budget-based margin', num: true, value: (r) => r.margins.budgetMargin, render: (r) => mcell(r.margins.budgetMargin, r.margins.budgetMarginPct) },
          { key: 'am', label: 'Actual-based margin', num: true, value: (r) => r.margins.actualMargin, render: (r) => mcell(r.margins.actualMargin, r.margins.actualMarginPct) },
          { key: 'exc', label: 'Items', value: (r) => r.exceptions.pending, render: (r) => (r.exceptions.pending ? badge(r.exceptions.pending + ' pending', 'warn') : r.exceptions.total ? badge('decided', 'ok') : '—') },
          { key: 'status', label: 'Closure', value: (r) => r.pool.status, render: (r) => status(r.pool.status) },
        ],
        footer: (rows) => { const t = (k) => sum(rows, (r) => D(r.totals[k])).toString(); const m = Calc.margins({ inrReceived: t('inrReceived'), totalLimits: t('totalLimits'), totalActual: t('totalActual') }); return `<td colspan="3">Total</td><td class="num">${Fmt.qty(rows.reduce((a, r) => a + r.totals.orderQty, 0))}</td><td class="num">${Fmt.qty(rows.reduce((a, r) => a + r.totals.shippedQty, 0))}</td><td class="num hide-sm">${Fmt.inr(t('shipmentInr'))}</td><td class="hide-sm"></td><td class="num">${Fmt.inr(t('inrReceived'))}</td><td class="num">${Fmt.inr(t('totalLimits'))}</td><td class="num">${Fmt.inr(t('totalActual'))}</td><td class="num">${mcell(m.budgetMargin, m.budgetMarginPct)}</td><td class="num">${mcell(m.actualMargin, m.actualMarginPct)}</td><td colspan="2"></td>`; },
        toolbarExtra: btn('PDF', 'data-pdf', 'sm', 'print'),
      });
      const pb = $('[data-pdf]', body); if (pb) pb.onclick = () => { if (!can('reports.export')) return toast('No export permission', 'bad'); UI.printDoc('Pool profitability', `<table><thead><tr><th>Pool</th><th>Buyer</th><th class="num">Qty</th><th class="num">Shipped</th><th class="num">INR received</th><th class="num">Limits</th><th class="num">Actual</th><th class="num">Budget margin</th><th class="num">Actual margin</th><th>Status</th></tr></thead><tbody>${reps.map((r) => `<tr><td>${esc(r.pool.poolNo)}${r.pool.isTest ? ' (TEST)' : ''}</td><td>${esc((r.buyer || {}).name)}</td><td class="num">${r.totals.orderQty}</td><td class="num">${r.totals.shippedQty}</td><td class="num">${Fmt.num(r.totals.inrReceived)}</td><td class="num">${Fmt.num(r.totals.totalLimits)}</td><td class="num">${Fmt.num(r.totals.totalActual)}</td><td class="num">${Fmt.num(r.margins.budgetMargin)}</td><td class="num">${Fmt.num(r.margins.actualMargin)}</td><td>${esc(r.pool.status)}</td></tr>`).join('')}</tbody></table><p class="muted">Budget-based margin = INR received − expense limits (estimate). Actual-based margin = INR received − actual expenses.</p>`); };
    } else if (tab === 'pool') {
      body.innerHTML = H.poolBar(view, q, 'profitability', (x) => x.status !== 'CANCELLED');
      const s = $('#poolSel', body); UI.enhance(body); if (s) s.addEventListener('change', () => App.go('profitability', { tab: 'pool', pool: s.value }));
      const p = q.pool && byId(db, 'pools', q.pool);
      if (!p) { body.insertAdjacentHTML('beforeend', '<div class="card">' + empty('Select a pool') + '</div>'); return; }
      poolReport(body, p);
    } else if (tab === 'style') {
      const rows = []; reps.forEach((r) => r.styleProfit.forEach((x) => rows.push(Object.assign({ poolNo: r.pool.poolNo, poolId: r.pool.id }, x))));
      body.innerHTML = '<div class="notice info">Style-wise: INR from that style\'s shipments; limits and actuals from style-specific entries. Pool-level additions/deductions and shared (all-style) expenses are <b>not</b> allocated to styles, so style totals will not add up to pool totals.</div><div class="card"><div class="bd p0" id="pt"></div></div>';
      table($('#pt', body), {
        id: 'profit-style', rows, exportName: 'style-profitability',
        columns: [{ key: 'styleRef', label: 'Style', render: (x) => `<b>${esc(x.styleRef)}</b><div class="small muted">${esc(x.description || '')}</div>` }, { key: 'poolNo', label: 'Pool' }, { key: 'allocQty', label: 'Pool qty', num: true }, { key: 'shipped', label: 'Shipped', num: true }, { key: 'inr', label: 'Shipment INR', num: true, render: (x) => Fmt.inr(x.inr) }, { key: 'limit', label: 'Expense limits', num: true, render: (x) => Fmt.inr(x.limit) }, { key: 'actual', label: 'Actual (style entries)', num: true, render: (x) => Fmt.inr(x.actual) }, { key: 'budgetMargin', label: 'Budget-based', num: true, render: (x) => signed(x.budgetMargin) }, { key: 'actualMargin', label: 'Actual-based', num: true, render: (x) => signed(x.actualMargin) }],
      });
    } else if (tab === 'buyer' || tab === 'season') {
      const rows = tab === 'buyer' ? agg('buyer', (r) => (r.buyer || {}).name, (r) => r.pool.buyerId) : agg('season', (r) => r.pool.season || '(no season)', (r) => r.pool.season || '');
      body.innerHTML = '<div class="card"><div class="bd p0" id="pt"></div></div>';
      table($('#pt', body), { id: 'profit-' + tab, rows, exportName: `${tab}-profitability`, columns: aggCols(tab === 'buyer' ? 'Buyer' : 'Season') });
    } else if (tab === 'category') {
      const map = new Map();
      reps.forEach((r) => r.byCat.forEach((c) => { if (!map.has(c.category)) map.set(c.category, { label: c.label, limit: D(0), actual: D(0) }); const x = map.get(c.category); x.limit = x.limit.add(c.limit); x.actual = x.actual.add(c.actual); }));
      const rows = Array.from(map.values()).map((x) => Object.assign({ label: x.label, limit: x.limit.toString(), actual: x.actual.toString() }, Calc.expenseDifference(x.limit, x.actual)));
      body.innerHTML = '<div class="card"><div class="bd p0" id="pt"></div></div>';
      table($('#pt', body), { id: 'profit-cat', rows, exportName: 'category-comparison', noPaging: true, columns: [{ key: 'label', label: 'Category', render: (x) => `<b>${esc(x.label)}</b>` }, { key: 'limit', label: 'Expense limits', num: true, render: (x) => Fmt.inr(x.limit) }, { key: 'actual', label: 'Actual', num: true, render: (x) => Fmt.inr(x.actual) }, { key: 'diff', label: 'Difference (limit − actual)', num: true, render: (x) => signed(x.diff) }, { key: 'pct', label: 'Diff %', num: true, render: (x) => (x.pct === null ? '—' : Fmt.pct(x.pct)) }, { key: 'status', label: 'Status', render: (x) => status(x.status) }] });
    }
  });
  function poolReport(body, p) {
    const r = SP.computePool(Store.db, p.id);
    const cl = Store.db.closures.filter((x) => x.poolId === p.id);
    body.insertAdjacentHTML('beforeend', `
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px" class="noprint">${btn('Print / PDF', 'id="rpP"', '', 'print')}${btn('Excel', 'id="rpX"', '', 'dl')}${btn('CSV', 'id="rpC"', '', 'dl')}<a class="btn" href="#/closure?pool=${p.id}">Close entry</a></div>
      ${r.errors.length ? `<div class="notice bad">${r.errors.map(esc).join('<br>')}</div>` : ''}
      <div class="kpis">
        <div class="kpi"><div class="l">Pool / buyer</div><div class="v" style="font-size:16px">${esc(p.poolNo)}</div><div class="s">${esc((r.buyer || {}).name)} · ${status(p.status)}</div></div>
        <div class="kpi"><div class="l">Order / shipped qty</div><div class="v">${Fmt.qty(r.totals.orderQty)} / ${Fmt.qty(r.totals.shippedQty)}</div></div>
        <div class="kpi"><div class="l">INR received</div><div class="v">${Fmt.inr(r.totals.inrReceived)}</div><div class="s">shipments ${Fmt.inr(r.totals.shipmentInr, 0)} + ${Fmt.num(r.totals.additions, 0)} − ${Fmt.num(r.totals.deductions, 0)}</div></div>
        <div class="kpi"><div class="l">Total expense limits</div><div class="v">${Fmt.inr(r.totals.totalLimits)}</div></div>
        <div class="kpi"><div class="l">Total actual expenses</div><div class="v">${Fmt.inr(r.totals.totalActual)}</div></div>
      </div>
      <div class="grid2">
        <div class="card"><div class="hd"><h2>Budget-based margin <span class="badge info">estimate</span></h2></div><div class="bd"><div class="sumrow"><span>INR received</span><span class="num">${Fmt.inr(r.totals.inrReceived)}</span></div><div class="sumrow"><span>− Total expense limits</span><span class="num">${Fmt.inr(r.totals.totalLimits)}</span></div><div class="sumrow big"><span>Budget-based margin</span><span class="num ${D(r.margins.budgetMargin).isNeg() ? 'neg' : ''}">${Fmt.inr(r.margins.budgetMargin)}</span></div><div class="small muted">${Fmt.pct(r.margins.budgetMarginPct)} of INR received. Based on costing limits, not on bills.</div></div></div>
        <div class="card"><div class="hd"><h2>Actual expense-based margin <span class="badge ok">result</span></h2></div><div class="bd"><div class="sumrow"><span>INR received (incl. additions / deductions)</span><span class="num">${Fmt.inr(r.totals.inrReceived)}</span></div><div class="sumrow"><span>− Actual expenses (saved entries)</span><span class="num">${Fmt.inr(r.totals.totalActual)}</span></div><div class="sumrow big"><span>Actual expense-based margin</span><span class="num ${D(r.margins.actualMargin).isNeg() ? 'neg' : ''}">${Fmt.inr(r.margins.actualMargin)}</span></div><div class="small muted">${Fmt.pct(r.margins.actualMarginPct)} of INR received. No other adjustments are deducted — additions/deductions are already in INR received.</div></div></div>
      </div>
      <div class="card"><div class="hd"><h2>Category-wise expense variance</h2></div><div class="bd p0" id="rc"></div></div>
      <div class="card"><div class="hd"><h2>Style-wise</h2></div><div class="bd p0" id="rs"></div></div>
      <div class="grid2"><div class="card"><div class="hd"><h2>Costing variance</h2></div><div class="bd">${r.variance.styles.map((s) => `<div class="sumrow"><span>${esc(s.styleRef)}</span><span class="num">${Fmt.pct(s.pct)}</span></div>`).join('')}<div class="sumrow total"><span>Applied</span><span class="num">${r.variance.override ? Fmt.pct(r.variance.override.pct) + ' (override)' : r.variance.scope === 'STYLE' ? 'per style' : Fmt.pct(r.variance.computedPoolPct)}</span></div></div></div>
      <div class="card"><div class="hd"><h2>Status</h2></div><div class="bd"><div class="sumrow"><span>Missing / additional items</span><span>${r.exceptions.total} total · ${r.exceptions.pending ? badge(r.exceptions.pending + ' pending', 'warn') : badge('all decided', 'ok')}</span></div><div class="sumrow"><span>Draft expense entries</span><span>${r.expenses.drafts}</span></div><div class="sumrow"><span>Closure</span><span>${status(p.status)} ${cl.length ? `v${cl[cl.length - 1].version} ${fmtDT(cl[cl.length - 1].closedAt)}` : ''}</span></div></div></div></div>`);
    table($('#rc', body), { id: 'rep-cat-' + p.id, noToolbar: true, noPaging: true, rows: r.byCat, columns: [{ key: 'label', label: 'Category' }, { key: 'limit', label: 'Limit', num: true, render: (x) => Fmt.inr(x.limit) }, { key: 'actual', label: 'Actual', num: true, render: (x) => Fmt.inr(x.actual) }, { key: 'diff', label: 'Difference', num: true, render: (x) => signed(x.diff) }, { key: 'diffPct', label: '%', num: true, render: (x) => (x.diffPct === null ? '—' : Fmt.pct(x.diffPct)) }, { key: 'status', label: 'Status', render: (x) => status(x.status) }], footer: () => `<td>Total</td><td class="num">${Fmt.inr(r.totals.totalLimits)}</td><td class="num">${Fmt.inr(r.totals.totalActual)}</td><td class="num">${signed(r.totals.expenseDiff)}</td><td class="num">${r.totals.expenseDiffPct === null ? '—' : Fmt.pct(r.totals.expenseDiffPct)}</td><td></td>` });
    table($('#rs', body), { id: 'rep-sty-' + p.id, noToolbar: true, noPaging: true, rows: r.styleProfit, columns: [{ key: 'styleRef', label: 'Style' }, { key: 'allocQty', label: 'Qty', num: true }, { key: 'shipped', label: 'Shipped', num: true }, { key: 'inr', label: 'Shipment INR', num: true, render: (x) => Fmt.inr(x.inr) }, { key: 'limit', label: 'Limits', num: true, render: (x) => Fmt.inr(x.limit) }, { key: 'actual', label: 'Actual', num: true, render: (x) => Fmt.inr(x.actual) }, { key: 'budgetMargin', label: 'Budget-based', num: true, render: (x) => signed(x.budgetMargin) }, { key: 'actualMargin', label: 'Actual-based', num: true, render: (x) => signed(x.actualMargin) }] });
    const sheets = () => [
      { name: 'Summary', head: ['Item', 'Value'], rows: [['Pool', p.poolNo], ['Buyer', (r.buyer || {}).name], ['Status', p.status], ['Order qty', r.totals.orderQty], ['Shipped qty', r.totals.shippedQty], ['Shipment INR', r.totals.shipmentInr], ['Additions', r.totals.additions], ['Deductions', r.totals.deductions], ['INR received', r.totals.inrReceived], ['Total expense limits', r.totals.totalLimits], ['Total actual expenses', r.totals.totalActual], ['Budget-based margin', r.margins.budgetMargin], ['Budget-based margin %', r.margins.budgetMarginPct], ['Actual expense-based margin', r.margins.actualMargin], ['Actual expense-based margin %', r.margins.actualMarginPct], ['Variance applied %', r.variance.override ? r.variance.override.pct : r.variance.computedPoolPct]] },
      { name: 'Categories', head: ['Category', 'Limit', 'Actual', 'Difference', 'Diff %', 'Status'], rows: r.byCat.map((c) => [c.label, c.limit, c.actual, c.diff, c.diffPct, c.status]) },
      { name: 'Style x Category', head: ['Style', 'Category', 'Qty', 'Cost/pc', 'Variance %', 'Limit', 'Actual', 'Difference', 'Status'], rows: r.limits.map((l) => [l.styleRef, l.categoryLabel, l.qty, l.costPerPiece, l.variancePct, l.limit, l.actual, l.diff, l.status]) },
      { name: 'Styles', head: ['Style', 'Qty', 'Shipped', 'Shipment INR', 'Limits', 'Actual', 'Budget margin', 'Actual margin'], rows: r.styleProfit.map((x) => [x.styleRef, x.allocQty, x.shipped, x.inr, x.limit, x.actual, x.budgetMargin, x.actualMargin]) },
    ];
    $('#rpX', body).onclick = () => { if (!can('reports.export')) return toast('No export permission', 'bad'); UI.downloadXLS(`${p.poolNo}-profitability`, sheets()); };
    $('#rpC', body).onclick = () => { if (!can('reports.export')) return toast('No export permission', 'bad'); const s = sheets(); UI.downloadCSV(`${p.poolNo}-profitability`, ['Section', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'], s.flatMap((x) => [[x.name].concat(x.head)].concat(x.rows.map((row) => [x.name].concat(row))))); };
    $('#rpP', body).onclick = () => { if (!can('reports.export')) return toast('No export permission', 'bad'); UI.printDoc(`Profitability report — ${p.poolNo}`, profitPrintHtml(p, r)); };
  }
  function profitPrintHtml(p, r) {
    return `${p.isTest ? '<div class="test">TEST DATA</div>' : ''}<div class="grid"><div><b>Pool:</b> ${esc(p.poolNo)}</div><div><b>Buyer:</b> ${esc((r.buyer || {}).name)}</div><div><b>Season:</b> ${esc(p.season || '—')}</div><div><b>Status:</b> ${esc(p.status)}</div><div><b>Order qty:</b> ${r.totals.orderQty}</div><div><b>Shipped qty:</b> ${r.totals.shippedQty}</div></div>
      <h2>INR received</h2><table><tbody><tr><td>Total INR shipment value</td><td class="num">${Fmt.inr(r.totals.shipmentInr)}</td></tr><tr><td>+ Additions</td><td class="num">${Fmt.inr(r.totals.additions)}</td></tr><tr><td>− Deductions</td><td class="num">${Fmt.inr(r.totals.deductions)}</td></tr><tr><td><b>INR received</b></td><td class="num"><b>${Fmt.inr(r.totals.inrReceived)}</b></td></tr></tbody></table>
      <h2>Margins</h2><table><tbody><tr><td>Budget-based margin (INR received − expense limits ${Fmt.inr(r.totals.totalLimits)}) — estimate</td><td class="num">${Fmt.inr(r.margins.budgetMargin)} (${Fmt.pct(r.margins.budgetMarginPct)})</td></tr><tr><td>Actual expense-based margin (INR received − actual expenses ${Fmt.inr(r.totals.totalActual)}) — result</td><td class="num"><b>${Fmt.inr(r.margins.actualMargin)}</b> (${Fmt.pct(r.margins.actualMarginPct)})</td></tr></tbody></table>
      <h2>Category-wise expense variance</h2><table><thead><tr><th>Category</th><th class="num">Limit</th><th class="num">Actual</th><th class="num">Limit − actual</th><th class="num">%</th></tr></thead><tbody>${r.byCat.map((c) => `<tr><td>${esc(c.label)}</td><td class="num">${Fmt.num(c.limit)}</td><td class="num">${Fmt.num(c.actual)}</td><td class="num">${Fmt.num(c.diff)}</td><td class="num">${c.diffPct === null ? '—' : Fmt.pct(c.diffPct)}</td></tr>`).join('')}</tbody><tfoot><tr><td>Total</td><td class="num">${Fmt.num(r.totals.totalLimits)}</td><td class="num">${Fmt.num(r.totals.totalActual)}</td><td class="num">${Fmt.num(r.totals.expenseDiff)}</td><td class="num">${r.totals.expenseDiffPct === null ? '—' : Fmt.pct(r.totals.expenseDiffPct)}</td></tr></tfoot></table>
      <h2>Style-wise</h2><table><thead><tr><th>Style</th><th class="num">Qty</th><th class="num">Shipped</th><th class="num">Shipment INR</th><th class="num">Limits</th><th class="num">Actual</th></tr></thead><tbody>${r.styleProfit.map((x) => `<tr><td>${esc(x.styleRef)}</td><td class="num">${x.allocQty}</td><td class="num">${x.shipped}</td><td class="num">${Fmt.num(x.inr)}</td><td class="num">${Fmt.num(x.limit)}</td><td class="num">${Fmt.num(x.actual)}</td></tr>`).join('')}</tbody></table>
      <p class="muted">Costing variance applied: ${r.variance.override ? Fmt.pct(r.variance.override.pct) + ' (approved override: ' + esc(r.variance.override.reason) + ')' : Fmt.pct(r.variance.computedPoolPct)}. Missing/additional items: ${r.exceptions.total} (${r.exceptions.pending} pending). Formula ${esc(Calc.FORMULA_VERSION)}.</p>`;
  }

  /* ======================= POOL CLOSURE ======================= */
  App.route('closure', 'pools.view', async (view, q) => {
    const db = Store.db;
    const p = q.pool ? byId(db, 'pools', q.pool) : null;
    view.innerHTML = pageHead('Pool Closure — Close Entry', 'All orders in the pool must be entered and every missing/additional item accepted before closing. Closing saves an immutable snapshot and locks financial records.') + H.poolBar(view, q, 'closure', (x) => x.status !== 'CANCELLED');
    H.bindPoolBar(view, 'closure');
    if (!p) {
      view.insertAdjacentHTML('beforeend', '<div class="card"><div class="hd"><h2>Readiness</h2></div><div class="bd p0" id="rd"></div></div>');
      table($('#rd', view), {
        id: 'closure-ready', rows: db.pools.filter((x) => x.status !== 'CANCELLED').map((x) => ({ p: x, c: SP.closureChecks(db, x.id) })),
        columns: [{ key: 'poolNo', label: 'Pool', value: (x) => x.p.poolNo, render: (x) => `<a href="#/closure?pool=${x.p.id}"><b>${esc(x.p.poolNo)}</b></a>${testTag(x.p)}` }, { key: 'buyer', label: 'Buyer', value: (x) => H.buyer(x.p.buyerId).name }, { key: 'status', label: 'Status', value: (x) => x.p.status, render: (x) => status(x.p.status) }, { key: 'ready', label: 'Checks passed', num: true, value: (x) => x.c.checks.filter((c) => c.ok).length, render: (x) => `${x.c.checks.filter((c) => c.ok).length} / ${x.c.checks.length}` }, { key: 'ok', label: 'Ready to close', value: (x) => (x.c.ok ? 'Yes' : 'No'), render: (x) => (x.p.status === 'CLOSED' ? badge('Closed', 'brand') : x.c.ok ? badge('Ready', 'ok') : badge('Not ready', 'warn')) }],
        onRow: (x) => App.go('closure', { pool: x.p.id }),
      });
      return;
    }
    const c = SP.closureChecks(db, p.id);
    const history = db.closures.filter((x) => x.poolId === p.id).sort((a, b) => b.version - a.version);
    const canClose = ['ACTIVE', 'REOPENED'].includes(p.status);
    view.insertAdjacentHTML('beforeend', `
      <div class="notice ${p.status === 'CLOSED' ? 'ok' : c.ok ? 'ok' : 'warn'}">${p.status === 'CLOSED' ? `<b>${esc(p.poolNo)} is closed</b> (v${p.final ? p.final.version : ''}, ${fmtDT(p.closedAt)} by ${esc(p.closedBy)}). Financial records are locked.` : c.ok ? '<b>All checks passed.</b> The pool can be closed.' : `<b>${c.checks.filter((x) => !x.ok).length} check(s) pending.</b> Closure is blocked until every requirement is met.`}</div>
      <div class="grid2"><div class="card"><div class="hd"><h2>Closure checklist</h2>${status(p.status)}</div><div class="bd p0"><ul class="checklist">${c.checks.map((x) => `<li><span class="ic ${x.ok ? 'ok' : 'bad'}">${x.ok ? '✓' : '!'}</span><div style="min-width:0"><b>${esc(x.label)}</b>${x.ok ? '' : `<ul>${x.problems.slice(0, 8).map((pr) => `<li>${esc(pr)}</li>`).join('')}${x.problems.length > 8 ? `<li>… ${x.problems.length - 8} more</li>` : ''}</ul><a class="small" href="${x.link}">Go to records →</a>`}</div></li>`).join('')}</ul></div></div>
      <div><div class="card"><div class="hd"><h2>Final figures (live)</h2></div><div class="bd">
        <div class="sumrow"><span>INR received</span><span class="num">${Fmt.inr(c.report.totals.inrReceived)}</span></div><div class="sumrow"><span>Total expense limits</span><span class="num">${Fmt.inr(c.report.totals.totalLimits)}</span></div><div class="sumrow"><span>Total actual expenses</span><span class="num">${Fmt.inr(c.report.totals.totalActual)}</span></div>
        <div class="sumrow total"><span>Budget-based margin</span><span class="num">${Fmt.inr(c.report.margins.budgetMargin)}</span></div><div class="sumrow total"><span>Actual expense-based margin</span><span class="num">${Fmt.inr(c.report.margins.actualMargin)}</span></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">${canClose ? guard('closure.close', `<button class="btn primary" id="doClose" ${c.ok ? '' : 'disabled title="Complete all checks first"'} type="button">${ico('lock')}Close entry</button>`) : ''}${p.status === 'CLOSED' ? guard('closure.reopen', btn('Reopen for correction', 'id="doReopen"', 'danger')) : ''}<a class="btn" href="#/profitability?pool=${p.id}">Profitability report</a></div>
      </div></div>
      <div class="card"><div class="hd"><h2>Closure history</h2></div><div class="bd p0" id="ch"></div></div></div></div>`);
    table($('#ch', view), {
      id: 'closure-hist-' + p.id, noToolbar: true, noPaging: true, rows: history, empty: 'Not closed yet',
      columns: [{ key: 'version', label: 'Ver.', num: true }, { key: 'status', label: 'Status', render: (x) => status(x.status) }, { key: 'closedAt', label: 'Closed', render: (x) => `${fmtDT(x.closedAt)}<div class="small muted">${esc(x.closedBy)}</div>` }, { key: 'inr', label: 'Actual margin', num: true, value: (x) => x.snapshot.margins.actualMargin, render: (x) => Fmt.inr(x.snapshot.margins.actualMargin) }, { key: 'reopen', label: 'Reopened', wrap: true, render: (x) => (x.reopenedAt ? `${fmtDT(x.reopenedAt)} — ${esc(x.reopenedBy)}<div class="small">${esc(x.reopenReason)}</div>` : '—') }],
      actions: () => act('snap', 'Snapshot') + act('print', '', '', 'print', false, 'Print'),
      on: { snap: (x) => showSnapshot(x), print: (x) => UI.printDoc(`Closure snapshot ${p.poolNo} v${x.version}`, snapshotHtml(x)) },
    });
    const dc = $('#doClose', view);
    if (dc) dc.onclick = async () => { const rem = await ask(`Close ${p.poolNo}`, 'Closing remarks', { required: false, ok: 'Close pool', help: 'All checks are re-validated. An immutable snapshot of the final figures is saved and financial records are locked.' }); if (rem === null) return; run(dc, async () => { const cl = await svc.closePool(p.id, rem); toast(`${p.poolNo} closed (snapshot v${cl.version})`, 'ok'); }); };
    const dr = $('#doReopen', view);
    if (dr) dr.onclick = async () => { const why = await ask(`Reopen ${p.poolNo} for correction`, 'Reason for reopening', { danger: true, ok: 'Reopen', help: 'The current snapshot is kept as superseded. Records can then be corrected and the pool closed again (new snapshot version).' }); if (why) run(dr, async () => { await svc.reopenPool(p.id, why); toast('Pool reopened for correction', 'ok'); }); };
  });
  function snapshotHtml(x) {
    const s = x.snapshot;
    return `<div class="grid"><div><b>Pool:</b> ${esc(s.poolNo)}</div><div><b>Buyer:</b> ${esc(s.buyer)}</div><div><b>Version:</b> ${x.version} (${esc(x.status)})</div><div><b>Closed:</b> ${fmtDT(x.closedAt)} by ${esc(x.closedBy)}</div><div><b>Formula:</b> ${esc(s.formulaVersion)}</div><div><b>Remarks:</b> ${esc(x.remarks || '—')}</div></div>
      <h2>Totals</h2><table><tbody>${[['Order qty', s.totals.orderQty], ['Shipped qty', s.totals.shippedQty], ['Shipment INR', Fmt.inr(s.totals.shipmentInr)], ['Additions', Fmt.inr(s.totals.additions)], ['Deductions', Fmt.inr(s.totals.deductions)], ['INR received', Fmt.inr(s.totals.inrReceived)], ['Expense limits', Fmt.inr(s.totals.totalLimits)], ['Actual expenses', Fmt.inr(s.totals.totalActual)], ['Budget-based margin', Fmt.inr(s.margins.budgetMargin)], ['Actual expense-based margin', Fmt.inr(s.margins.actualMargin)], ['Variance applied', s.variance.override ? Fmt.pct(s.variance.override.pct) + ' (override)' : Fmt.pct(s.variance.computedPoolPct)]].map(([a, b]) => `<tr><td>${a}</td><td class="num">${b}</td></tr>`).join('')}</tbody></table>
      <h2>Categories</h2><table><thead><tr><th>Category</th><th class="num">Limit</th><th class="num">Actual</th><th class="num">Diff</th></tr></thead><tbody>${s.byCat.map((c) => `<tr><td>${esc(c.label)}</td><td class="num">${Fmt.num(c.limit)}</td><td class="num">${Fmt.num(c.actual)}</td><td class="num">${Fmt.num(c.diff)}</td></tr>`).join('')}</tbody></table>
      <h2>Shipments</h2><table><thead><tr><th>PO</th><th>Style</th><th>Combo</th><th class="num">Qty</th><th class="num">Shipped</th><th class="num">INR</th></tr></thead><tbody>${s.shipments.map((r) => `<tr><td>${esc(r.poNumber)}</td><td>${esc(r.styleRef)}</td><td>${esc(r.combo)}</td><td class="num">${r.allocQty}</td><td class="num">${r.shipped}</td><td class="num">${Fmt.num(r.inr)}</td></tr>`).join('')}</tbody></table>
      <h2>Missing / additional items</h2><table><thead><tr><th>Type</th><th>Item</th><th>Status</th><th>Decided by</th></tr></thead><tbody>${s.exceptions.map((e) => `<tr><td>${esc(e.type)}</td><td>${esc(e.itemName)}</td><td>${esc(e.status)}</td><td>${esc(e.decidedBy || '')}</td></tr>`).join('') || '<tr><td colspan="4">None</td></tr>'}</tbody></table>`;
  }
  function showSnapshot(x) { modal({ title: `Closure snapshot v${x.version} (${x.status})`, size: 'xl', body: `<div class="notice info">Immutable record saved at closure. Later corrections create a new version; this one is preserved for audit.</div>${snapshotHtml(x).replace(/<table>/g, '<div class="table-wrap"><table class="t">').replace(/<\/table>/g, '</table></div>').replace(/<h2>/g, '<h3 style="margin:14px 0 6px">').replace(/<\/h2>/g, '</h3>')}`, actions: [{ label: 'Close' }] }); }

  /* ======================= EXCHANGE RATES ======================= */
  App.route('rates', 'rates.view', async (view) => {
    view.innerHTML = pageHead('Exchange Rates', 'INR per unit of foreign currency by effective date. Adding a new rate never changes costings or shipments that already copied an older rate.', guard('rates.edit', btn('Add rate', 'id="addR"', 'primary', 'plus') + btn('Add currency', 'id="addC"'))) +
      '<div class="card"><div class="hd"><h2>Rates</h2></div><div class="bd p0" id="rt"></div></div><div class="card"><div class="hd"><h2>Currencies</h2></div><div class="bd p0" id="cc"></div></div>';
    const used = (r) => Store.db.shipments.filter((s) => s.rateId === r.id && !s.deletedAt).length + Store.db.costings.filter((c) => c.rateId === r.id).length;
    table($('#rt', view), {
      id: 'rates', rows: () => Store.db.rates, exportName: 'exchange-rates', sort: { key: 'effectiveDate', dir: 'desc' },
      filters: [{ key: 'currency', label: 'Currency', options: () => Store.db.currencies.map((c) => c.code) }],
      columns: [{ key: 'currency', label: 'Currency', render: (r) => `<b>${esc(r.currency)}</b>${testTag(r)}` }, { key: 'name', label: 'Name', value: (r) => (Store.db.currencies.find((c) => c.code === r.currency) || {}).name, hideSm: true }, { key: 'inrPerUnit', label: 'INR per unit', num: true, render: (r) => `₹${Fmt.num(r.inrPerUnit, 4)}` }, { key: 'effectiveDate', label: 'Effective date', render: (r) => fmtDate(r.effectiveDate) }, { key: 'source', label: 'Source / remarks', wrap: true }, { key: 'createdBy', label: 'Created by', hideSm: true }, { key: 'createdAt', label: 'Created', render: (r) => fmtDT(r.createdAt), hideSm: true }, { key: 'used', label: 'Used by', num: true, value: used, render: (r) => (used(r) ? `${used(r)} record(s)` : '—') }],
      actions: () => guard('rates.edit', act('edit', '', '', 'edit', false, 'Edit') + act('del', '', 'danger', 'trash', false, 'Delete')),
      on: {
        edit: (r) => editRate(r),
        del: async (r) => { if (await confirm(`Delete ${esc(r.currency)} rate of ${fmtDate(r.effectiveDate)}?`, { danger: true, ok: 'Delete' })) run(null, async () => { await svc.deleteRate(r.id); toast('Deleted', 'ok'); }); },
      },
    });
    table($('#cc', view), {
      id: 'currencies', noToolbar: true, noPaging: true, rows: () => Store.db.currencies,
      columns: [{ key: 'code', label: 'Code', render: (c) => `<b>${esc(c.code)}</b>` }, { key: 'name', label: 'Name' }, { key: 'active', label: 'Status', render: (c) => status(c.active !== false ? 'ACTIVE' : 'INACTIVE') }, { key: 'latest', label: 'Latest rate', num: true, value: (c) => { const r = SP.rateOn(Store.db, c.code); return r ? `₹${Fmt.num(r.inrPerUnit, 4)} (${fmtDate(r.effectiveDate)})` : '—'; } }],
      actions: () => guard('rates.edit', act('edit', '', '', 'edit', false, 'Edit') + act('del', '', 'danger', 'trash', false, 'Delete')),
      on: {
        edit: (c) => editCur(c),
        del: async (c) => { if (await confirm(`Delete currency ${esc(c.code)}?`, { danger: true, ok: 'Delete' })) run(null, async () => { await svc.deleteCurrency(c.id); toast('Deleted', 'ok'); }); },
      },
    });
    const ar = $('#addR', view); if (ar) ar.onclick = () => editRate();
    const ac = $('#addC', view); if (ac) ac.onclick = () => editCur();
  });
  function editRate(r) {
    modal({
      title: r ? 'Edit exchange rate' : 'Add exchange rate',
      body: (r ? '<div class="notice info">Records that already used this rate keep the value they copied. Editing affects only future selections.</div>' : '') + form([{ name: 'currency', label: 'Currency', type: 'select', options: H.currencyOpts(), required: true, span: 's6' }, { name: 'inrPerUnit', label: 'INR per currency unit', type: 'decimal', required: true, span: 's6', help: 'Must be greater than zero' }, { name: 'effectiveDate', label: 'Effective date', type: 'date', required: true, span: 's6' }, { name: 'source', label: 'Source / remarks', span: 's12' }], r || { effectiveDate: SP.today(), currency: 'GBP' }),
      actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: async (m) => { await svc.saveRate(Object.assign(read(m.el), { id: r && r.id })); toast('Rate saved', 'ok'); } }],
    });
  }
  function editCur(c) {
    modal({
      title: c ? `Edit ${c.code}` : 'Add currency',
      body: form([{ name: 'code', label: 'ISO code', required: true, span: 's4', placeholder: 'GBP' }, { name: 'name', label: 'Name', required: true, span: 's8' }, { name: 'active', label: 'Active', type: 'checkbox', span: 's12' }], c || { active: true }),
      actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: async (m) => { await svc.saveCurrency(Object.assign(read(m.el), { id: c && c.id })); toast('Saved', 'ok'); } }],
    });
  }

  /* ======================= USERS & PERMISSIONS ======================= */
  App.route('users', 'users.manage', async (view, q) => {
    const tab = q.tab || 'users';
    view.innerHTML = pageHead('User Management', 'Users, roles and configurable permissions. Permissions are enforced by every data operation, not only by hiding buttons.', tab === 'users' ? btn('Add user', 'id="addU"', 'primary', 'plus') : '') +
      `<div class="tabs"><button class="${tab === 'users' ? 'on' : ''}" data-tab="users">Users</button><button class="${tab === 'perms' ? 'on' : ''}" data-tab="perms">Roles &amp; permissions</button></div><div id="ub"></div>`;
    $$('[data-tab]', view).forEach((b) => (b.onclick = () => App.go('users', { tab: b.dataset.tab })));
    const ub = $('#ub', view);
    if (tab === 'users') {
      ub.innerHTML = '<div class="card"><div class="bd p0" id="ut"></div></div>';
      table($('#ut', ub), {
        id: 'users', rows: () => Store.db.users, exportName: 'users',
        filters: [{ key: 'role', label: 'Role', options: Object.entries(SP.ROLES).map(([value, label]) => ({ value, label })) }, { key: 'active', label: 'Status', options: [{ value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }], get: (u) => String(u.active) }],
        columns: [{ key: 'name', label: 'Name', render: (u) => `<b>${esc(u.name)}</b>${u.id === Store.user.id ? ' ' + badge('you', 'info') : ''}` }, { key: 'email', label: 'Email' }, { key: 'role', label: 'Role', value: (u) => SP.ROLES[u.role] }, { key: 'active', label: 'Status', render: (u) => status(u.active ? 'ACTIVE' : 'INACTIVE') + (u.lockedUntil && Date.parse(u.lockedUntil) > Date.now() ? ' ' + badge('locked', 'bad') : '') }, { key: 'lastLogin', label: 'Last login', render: (u) => fmtDT(u.lastLogin) }, { key: 'createdAt', label: 'Created', render: (u) => fmtDate(u.createdAt), hideSm: true }],
        actions: (u) => act('edit', '', '', 'edit', false, 'Edit') + act('pw', 'Reset password') + (u.id !== Store.user.id ? act('del', '', 'danger', 'trash', false, 'Delete') : ''),
        on: {
          edit: (u) => editUser(u),
          pw: (u) => modal({ title: `Reset password — ${u.name}`, body: form([{ name: 'password', label: 'New password', type: 'password', required: true, span: 's12', help: 'At least 8 characters with letters and numbers', autocomplete: 'new-password' }]), actions: [{ label: 'Cancel' }, { label: 'Reset', cls: 'primary', onClick: async (m) => { await svc.resetPassword(u.id, read(m.el).password); toast('Password reset', 'ok'); } }] }),
          del: async (u) => { if (await confirm(`Delete user ${esc(u.name)}? Users with recorded activity can only be deactivated.`, { danger: true, ok: 'Delete' })) run(null, async () => { await svc.deleteUser(u.id); toast('Deleted', 'ok'); }); },
        },
      });
      $('#addU', view).onclick = () => editUser();
    } else {
      const rp = Store.db.settings.rolePerms;
      const roles = Object.keys(SP.ROLES);
      ub.innerHTML = `<div class="card"><div class="hd"><h2>Permission matrix</h2><button class="btn primary sm" id="savePerm" type="button">Save permissions</button><button class="btn sm" id="resetPerm" type="button">Restore defaults</button></div><div class="bd p0"><div class="table-wrap"><table class="t perm-matrix"><thead><tr><th>Permission</th>${roles.map((r) => `<th>${esc(SP.ROLES[r])}</th>`).join('')}</tr></thead><tbody>
        ${Object.entries(SP.PERMS).map(([k, l]) => `<tr><td>${esc(l)} <span class="faint small mono">${esc(k)}</span></td>${roles.map((r) => `<td><input type="checkbox" data-r="${r}" data-p="${k}" ${r === 'ADMIN' || (rp[r] || []).includes(k) ? 'checked' : ''} ${r === 'ADMIN' ? 'disabled' : ''} aria-label="${esc(SP.ROLES[r] + ': ' + l)}"></td>`).join('')}</tr>`).join('')}
      </tbody></table></div></div></div>`;
      $('#savePerm', ub).onclick = (e) => run(e.target, async () => { const out = {}; roles.forEach((r) => (out[r] = $$(`input[data-r="${r}"]:checked`, ub).map((i) => i.dataset.p))); await svc.saveRolePerms(out); toast('Permissions saved', 'ok'); });
      $('#resetPerm', ub).onclick = async (e) => { if (await confirm('Restore the default permissions for all roles?')) run(e.target, async () => { await svc.saveRolePerms(SP.clone(SP.DEFAULT_ROLE_PERMS)); toast('Defaults restored', 'ok'); }); };
    }
  });
  function editUser(u) {
    modal({
      title: u ? `Edit ${u.name}` : 'Add user',
      body: form([{ name: 'name', label: 'Full name', required: true, span: 's6' }, { name: 'email', label: 'Email (login)', type: 'email', required: true, span: 's6' }, { name: 'role', label: 'Role', type: 'select', options: Object.entries(SP.ROLES).map(([value, label]) => ({ value, label })), required: true, span: 's6' }, ...(u ? [] : [{ name: 'password', label: 'Initial password', type: 'password', required: true, span: 's6', help: 'At least 8 characters with letters and numbers', autocomplete: 'new-password' }]), { name: 'active', label: 'Active', type: 'checkbox', span: 's12' }], u || { active: true, role: 'COSTING' }),
      actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: async (m) => { await svc.saveUser(Object.assign(read(m.el), { id: u && u.id })); toast('User saved', 'ok'); } }],
    });
  }
  Pages.changePassword = () => modal({
    title: 'Change password', size: 'sm',
    body: form([{ name: 'oldPassword', label: 'Current password', type: 'password', required: true, span: 's12', autocomplete: 'current-password' }, { name: 'password', label: 'New password', type: 'password', required: true, span: 's12', autocomplete: 'new-password' }, { name: 'password2', label: 'Confirm new password', type: 'password', required: true, span: 's12', autocomplete: 'new-password' }]),
    actions: [{ label: 'Cancel' }, { label: 'Change', cls: 'primary', onClick: async (m) => { const v = read(m.el); if (v.password !== v.password2) throw new AppError('Passwords do not match', 'password2'); await svc.changeOwnPassword(v.oldPassword, v.password); toast('Password changed', 'ok'); } }],
  });

  /* ======================= AUDIT LOG ======================= */
  App.route('audit', 'audit.view', async (view, q) => {
    const f = { from: q.from || '', to: q.to || '' };
    view.innerHTML = pageHead('Audit Logs', 'Every create, update, delete, allocation, decision, closure and reopening with before/after values.') + `<form class="filters" id="af">${UI.field({ name: 'from', label: 'From', type: 'date' }, f.from)}${UI.field({ name: 'to', label: 'To', type: 'date' }, f.to)}</form><div class="card"><div class="bd p0" id="aut"></div></div>`;
    $('#af', view).onchange = () => App.go('audit', read($('#af', view)));
    table($('#aut', view), {
      id: 'audit', exportName: 'audit-log', pageSize: 25, sort: { key: 'at', dir: 'desc' },
      rows: () => Store.db.audit.filter((a) => (!f.from || a.at.slice(0, 10) >= f.from) && (!f.to || a.at.slice(0, 10) <= f.to)),
      filters: [{ key: 'entity', label: 'Entity', options: () => Array.from(new Set(Store.db.audit.map((a) => a.entity))).sort() }, { key: 'action', label: 'Action', options: () => Array.from(new Set(Store.db.audit.map((a) => a.action))).sort() }, { key: 'userName', label: 'User', options: () => Array.from(new Set(Store.db.audit.map((a) => a.userName))).sort() }],
      columns: [{ key: 'at', label: 'When', render: (a) => fmtDT(a.at) }, { key: 'userName', label: 'User' }, { key: 'action', label: 'Action', render: (a) => badge(a.action, /DELETE|RELEASE|REJECT|CANCEL/.test(a.action) ? 'bad' : /CLOSE|APPROVE|ACCEPT/.test(a.action) ? 'ok' : /REOPEN/.test(a.action) ? 'warn' : 'info') }, { key: 'entity', label: 'Entity' }, { key: 'ref', label: 'Reference', wrap: true }, { key: 'reason', label: 'Reason', wrap: true }],
      actions: () => act('view', '', '', 'eye', false, 'Details'),
      on: { view: (a) => auditDetail(a) },
    });
  });
  function auditDetail(a) {
    const b = a.before || {}, c = a.after || {};
    const keys = Array.from(new Set(Object.keys(b).concat(Object.keys(c)))).filter((k) => !['updatedAt'].includes(k));
    const show = (v) => (v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v, null, 1) : String(v));
    const rows = keys.map((k) => ({ k, b: show(b[k]), c: show(c[k]) })).filter((x) => !a.before || x.b !== x.c);
    modal({
      title: `${a.action} ${a.entity} ${a.ref || ''}`, size: 'xl',
      body: `<dl class="dl"><dt>When</dt><dd>${fmtDT(a.at)}</dd><dt>User</dt><dd>${esc(a.userName)}</dd>${a.reason ? `<dt>Reason</dt><dd>${esc(a.reason)}</dd>` : ''}</dl><h3 style="margin:14px 0 6px">${a.before ? 'Changed fields' : 'Values'}</h3><div class="table-wrap"><table class="t"><thead><tr><th>Field</th>${a.before ? '<th>Before</th>' : ''}<th>${a.before ? 'After' : 'Value'}</th></tr></thead><tbody>${rows.map((x) => `<tr><td class="mono">${esc(x.k)}</td>${a.before ? `<td class="wrap mono" style="white-space:pre-wrap;max-width:420px">${esc(x.b.slice(0, 2000))}</td>` : ''}<td class="wrap mono" style="white-space:pre-wrap;max-width:420px">${esc(x.c.slice(0, 2000))}</td></tr>`).join('') || '<tr><td colspan="3" class="empty small">No field changes</td></tr>'}</tbody></table></div>`,
      actions: [{ label: 'Close' }],
    });
  }

  /* ======================= SETTINGS ======================= */
  App.route('settings', 'settings.manage', async (view, q) => {
    const s = Store.db.settings;
    const tab = q.tab || 'general';
    const TABS = [['general', 'General'], ['costing', 'Costing'], ['limits', 'Expense limits'], ['ops', 'Shipments & pools'], ['files', 'Images & attachments'], ['data', 'Data, import & backup']];
    view.innerHTML = pageHead('Settings', 'Configuration of formulas, master lists, policies and data.') + `<div class="tabs">${TABS.map(([k, l]) => `<button class="${k === tab ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div><div id="sb"></div>`;
    $$('[data-tab]', view).forEach((b) => (b.onclick = () => App.go('settings', { tab: b.dataset.tab })));
    const sb = $('#sb', view);
    const card = (title, body, saveId) => `<div class="card"><div class="hd"><h2>${title}</h2>${saveId ? `<button class="btn primary sm" id="${saveId}" type="button">Save</button>` : ''}</div><div class="bd"><div class="form-error hidden" role="alert"></div>${body}</div></div>`;
    const save = (id, fn) => { const b = $('#' + id, sb); if (b) b.onclick = () => run(b, async () => { await svc.saveSettings(fn(b.closest('.card'))); toast('Settings saved', 'ok'); }, b.closest('.card')); };
    if (tab === 'general') {
      sb.innerHTML = card('General', form([{ name: 'company', label: 'Company name', required: true, span: 's6' }, { name: 'numberFormat', label: 'Number grouping', type: 'select', options: [{ value: 'western', label: 'Western — 224,645.60 (as in source sheets)' }, { name: 'indian', value: 'indian', label: 'Indian — 2,24,645.60' }], placeholder: false, span: 's6' }, { name: 'sessionMinutes', label: 'Session length (minutes)', type: 'int', span: 's6' }], s), 'sG') +
        card('Rounding & precision (fixed)', `<ul class="small" style="margin:0;padding-left:18px"><li>All money is calculated with exact decimal arithmetic (no floating point).</li><li>Costing row amounts, expense amounts, shipment values and INR values: 2 dp, rounded half away from zero, per row.</li><li>Foreign unit price from costing: 4 dp (shown to 2 dp); quoted / confirmed prices up to 4 dp.</li><li>Exchange rates: up to 4 dp. Variance percentages: 4 dp.</li><li>Expense limits: rounded once per style × category (matches the workbook).</li></ul>`);
      save('sG', (c) => { const v = read(c); return { company: v.company, numberFormat: v.numberFormat, sessionMinutes: v.sessionMinutes }; });
    } else if (tab === 'costing') {
      sb.innerHTML = card('Costing formula', `<p class="small muted" style="margin-top:0">Row amount = qty/consumption × rate × (1 + allowance %). Fabric uses a loss allowance: the workbook's fabric amounts (e.g. 0.080 kg × ₹500 = 40 → 42.00) are all reproduced with 5%. New fabric rows default to the value below; each row can override it.</p>` + form([{ name: 'fabricLossPct', label: 'Default fabric loss %', type: 'decimal', span: 's4' }], s) + `<h3 style="margin:16px 0 6px">Default overall percentage components (new costings)</h3><div id="pctList"></div><button class="btn sm" type="button" id="pctAdd">${ico('plus')}Add component</button>`, 'sC') +
        card('Master lists', form([{ name: 'units', label: 'Units (comma separated)', span: 's12', help: 'Consumption and rate units must match on a costing row; incompatible units are rejected.' }, { name: 'productTypes', label: 'Product types', span: 's12' }, { name: 'extraCategories', label: 'Additional expense categories', span: 's12', help: 'Added after Fabric, Application, Others, CMT, Trims, Labelling, Packing accessories, Packaging, Forwarding, Bank charges' }, { name: 'sizeSets', label: 'Size sets (one per line: Name: size1, size2, …)', type: 'textarea', span: 's12', attrs: 'rows="5"' }], { units: s.units.join(', '), productTypes: s.productTypes.join(', '), extraCategories: s.extraCategories.join(', '), sizeSets: s.sizeSets.map((x) => `${x.name}: ${x.sizes.join(', ')}`).join('\n') }), 'sM');
      let pcts = SP.clone(s.defaultPercentages);
      const drawP = () => { $('#pctList', sb).innerHTML = `<table class="t"><thead><tr><th>Name</th><th>%</th><th>Basis</th><th></th></tr></thead><tbody>${pcts.map((p, i) => `<tr><td><input class="cell" data-i="${i}" data-f="name" value="${esc(p.name)}"></td><td style="width:90px"><input class="cell num" data-i="${i}" data-f="pct" value="${esc(p.pct)}"></td><td><select class="cell" data-i="${i}" data-f="basis"><option value="ITEMS"${p.basis === 'ITEMS' ? ' selected' : ''}>% of items total</option><option value="CUMULATIVE"${p.basis === 'CUMULATIVE' ? ' selected' : ''}>% of running total</option></select></td><td><button class="btn xs danger" data-rm="${i}" type="button">${ico('trash')}</button></td></tr>`).join('')}</tbody></table>`; $$('[data-i]', sb).forEach((x) => (x.oninput = x.onchange = () => (pcts[+x.dataset.i][x.dataset.f] = x.value))); $$('[data-rm]', sb).forEach((b) => (b.onclick = () => { pcts.splice(+b.dataset.rm, 1); drawP(); })); };
      drawP(); $('#pctAdd', sb).onclick = () => { pcts.push({ name: 'Component', pct: '0', basis: 'ITEMS' }); drawP(); };
      save('sC', (c) => ({ fabricLossPct: read(c).fabricLossPct, defaultPercentages: pcts }));
      save('sM', (c) => { const v = read(c); const split = (x) => x.split(',').map((y) => y.trim()).filter(Boolean); return { units: split(v.units), productTypes: split(v.productTypes), extraCategories: split(v.extraCategories), sizeSets: v.sizeSets.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const i = l.indexOf(':'); if (i < 0) throw new AppError(`Size set line "${l}" must be "Name: size1, size2"`); return { name: l.slice(0, i).trim(), sizes: split(l.slice(i + 1)) }; }) }; });
    } else if (tab === 'limits') {
      const v = s.variance;
      sb.innerHTML = card('Expense limit & costing variance', `<div class="notice ${v.approved ? 'ok' : 'warn'}">${v.approved ? 'Method marked as <b>approved by the client</b>.' : '<b>Pending confirmation.</b> The source shows an "average costing difference" of −3.99% for BGPL-001 but does not show how it is derived. From the source prices the per-style differences are −8.98% (HRT-BABY-001: £1.65 vs £1.8127) and −3.12% (HRT-BABY-002: £2.00 vs £2.0644); simple average −6.05%, qty-weighted −5.60%, value-weighted −5.33%. Until confirmed, use the method below or set an approved per-pool override (Expense Limit Analysis).'}</div>
        <p class="small muted">Limit per style × category = Σ(allocated qty × costing cost per piece) × (1 + variance %/100). Variance per order = (confirmed price × costing exchange rate − costing total INR) ÷ costing total INR.</p>` +
        form([{ name: 'method', label: 'Pool aggregation method', type: 'select', options: [{ value: 'SIMPLE_AVG', label: 'Simple average of style variances' }, { value: 'QTY_WEIGHTED', label: 'Quantity-weighted' }, { value: 'VALUE_WEIGHTED', label: 'Confirmed-value-weighted' }], placeholder: false, span: 's6' }, { name: 'scope', label: 'Scope', type: 'select', options: [{ value: 'POOL', label: 'One pool-level % for all styles (workbook)' }, { name: 'STYLE', value: 'STYLE', label: 'Each style uses its own %' }], placeholder: false, span: 's6' }, { name: 'approved', label: 'Method approved by the client', type: 'checkbox', span: 's12' }], v) +
        `<h3 style="margin:14px 0 6px">Apply the variance to these categories</h3><p class="small muted" style="margin-top:0">The workbook demonstrates Fabric, Application and CMT and notes “For all other category Trims, Labelling… same calculation”.</p><div style="display:flex;flex-wrap:wrap;gap:6px 18px">${H.cats().map((c) => `<label class="check"><input type="checkbox" data-vc="${c.key}" ${v.categories.includes(c.key) ? 'checked' : ''}> ${esc(c.label)}</label>`).join('')}</div>`, 'sV');
      save('sV', (c) => { const x = read(c); return { variance: { method: x.method, scope: x.scope, approved: x.approved, categories: $$('[data-vc]:checked', c).map((i) => i.dataset.vc) } }; });
    } else if (tab === 'ops') {
      sb.innerHTML = card('Shipments', form([{ name: 'maxExcessPct', label: 'Maximum excess without commercial acceptance (%)', type: 'decimal', span: 's6', help: 'Shipped totals above order × (1 + %) require a buyer acceptance reference and the “accept excess” permission' }, { name: 'requireFinalForClosure', label: 'Pool closure requires a final shipment for every pooled order line', type: 'checkbox', span: 's12' }], s.shipment), 'sS') +
        card('Order pools', form([{ name: 'poolPrefix', label: 'Pool number prefix', span: 's4', help: 'e.g. BGPL → BGPL-001' }, { name: 'allowPartialAllocation', label: 'Allow partial allocation of a PO line', type: 'checkbox', span: 's12' }], { poolPrefix: s.poolPrefix, allowPartialAllocation: s.pool.allowPartialAllocation }), 'sP');
      save('sS', (c) => ({ shipment: read(c) }));
      save('sP', (c) => { const v = read(c); return { poolPrefix: v.poolPrefix, pool: { allowPartialAllocation: v.allowPartialAllocation } }; });
    } else if (tab === 'files') {
      sb.innerHTML = card('Images & attachments', form([{ name: 'imageStorage', label: 'Style image storage provider', type: 'select', options: [{ value: 'embedded', label: 'Embedded — resized image stored in the local database' }, { value: 'url', label: 'External URL — store a link to an image host / CDN' }], placeholder: false, span: 's12' }, { name: 'enabled', label: 'Allow bill attachments on expenses', type: 'checkbox', span: 's12' }, { name: 'maxKb', label: 'Maximum attachment size (KB)', type: 'int', span: 's6' }], Object.assign({ imageStorage: s.imageStorage }, s.attachments)), 'sF');
      save('sF', (c) => { const v = read(c); return { imageStorage: v.imageStorage, attachments: { enabled: v.enabled, maxKb: v.maxKb } }; });
    } else if (tab === 'data') {
      const db = Store.db; const size = new Blob([JSON.stringify(db)]).size;
      const hasTest = db.buyers.some((b) => b.isTest);
      sb.innerHTML = card('Backup & restore', `<p class="small muted" style="margin-top:0">All data lives in this browser's IndexedDB (${(size / 1024).toFixed(0)} KB, revision ${db.meta.rev}). Download a backup regularly and before clearing browser data. Restoring replaces <b>all</b> current data.</p><div style="display:flex;gap:8px;flex-wrap:wrap">${btn('Download backup (.json)', 'id="bk"', 'primary', 'dl')}${btn('Restore from backup…', 'id="rs"', 'danger')}</div>`) +
        card('CSV import', `<p class="small muted" style="margin-top:0">Every row is validated (references, currencies, quantities, duplicates) before anything is saved; if any row fails, nothing is imported.</p><div style="display:flex;gap:8px;flex-wrap:wrap">${guard('import.run', btn('Import buyers', 'data-imp="buyers"') + btn('Import styles', 'data-imp="styles"') + btn('Import order confirmations', 'data-imp="orders"'))}</div>`) +
        card('Regression test data (BGPL-001)', `<p class="small muted" style="margin-top:0">Loads the BGPL-001 example from the source PDFs, flagged <span class="badge test">TEST DATA</span> everywhere: buyer, 2 styles, costings (+ revision), quotes, PO 3532 / 4246, pool, expenses, shipments, adjustments and missing/additional items. Use it to verify the formulas, then remove it.</p><div style="display:flex;gap:8px;flex-wrap:wrap">${hasTest ? btn('Remove test data', 'id="rmT"', 'danger') : btn('Load BGPL-001 test data', 'id="ldT"', 'accent')}</div>`);
      $('#bk', sb).onclick = () => { UI.download(`sportspro-backup-${SP.today()}.json`, 'application/json', svc.exportBackup()); toast('Backup downloaded', 'ok'); };
      $('#rs', sb).onclick = async () => { const f = await UI.pickFile('application/json,.json'); if (!f) return; if (!(await confirm(`Replace ALL current data with <b>${esc(f.name)}</b>? This cannot be undone — download a backup first.`, { danger: true, ok: 'Restore' }))) return; run(null, async () => { await svc.restoreBackup(await UI.readText(f)); toast('Backup restored', 'ok'); document.getElementById('root').innerHTML = ''; App.refresh(); }); };
      $$('[data-imp]', sb).forEach((b) => (b.onclick = () => Pages.importDialog(b.dataset.imp)));
      const ld = $('#ldT', sb); if (ld) ld.onclick = () => run(ld, async () => { const p = await SP.seedBGPL001(); toast(`Test data loaded — pool ${p.poolNo}`, 'ok'); App.go('pools/view', { id: p.id }); });
      const rm = $('#rmT', sb); if (rm) rm.onclick = async () => { if (await confirm('Remove all records flagged as TEST DATA (including the test pool, its expenses, shipments and closures)?', { danger: true, ok: 'Remove' })) run(rm, async () => { await svc.removeTestData(); toast('Test data removed', 'ok'); }); };
    }
  });

  /* ---------- CSV import dialog ---------- */
  const TEMPLATES = {
    buyers: { title: 'Buyers', sample: [['BUY-0100', 'Example Buyer Ltd', 'Jane Doe', 'jane@example.com', '+44 20 0000 0000', '1 High St, London', 'United Kingdom', 'GBP', '']] },
    styles: { title: 'Styles', sample: [['Example Buyer Ltd', 'S-27', 'EX-001', 'Example T-shirt', 'T-Shirt', 'S-XL', 'S|M|L|XL', '250', '4', '2026-05-25', '']], help: 'buyer = buyer name or ID; sizes separated by |' },
    orders: { title: 'Order confirmations', sample: [['Example Buyer Ltd', 'PO 1001', '2026-06-01', 'S-27', 'EX-001', 'Navy', 'QT-0001', '1.65', 'GBP', '2026-06-02', 'S:50|M:65|L:65|XL:70', '']], help: 'POs are created if missing; quoteNo must exist; sizes as SIZE:QTY separated by |' },
  };
  Pages.importDialog = (kind) => {
    const cfg = SP.IMPORTS[kind], t = TEMPLATES[kind];
    const m = modal({
      title: `Import ${t.title} (CSV)`, size: 'lg',
      body: `<p class="small">Columns: <span class="mono">${cfg.columns.join(', ')}</span>${t.help ? `<br>${esc(t.help)}` : ''}</p><p><button class="btn sm" type="button" id="tpl">${ico('dl')}Download template</button></p><div id="impRes"></div>`,
      actions: [{ label: 'Close' }, { label: 'Choose CSV file…', cls: 'primary', onClick: async (mm) => {
        const f = await UI.pickFile('.csv,text/csv'); if (!f) return false;
        const res = await svc.importCsv(kind, await UI.readText(f));
        $('#impRes', mm.el).innerHTML = res.errors.length ? `<div class="notice bad"><b>Nothing was imported.</b> ${res.errors.length} of ${res.total} row(s) failed validation:</div><div class="table-wrap"><table class="t"><thead><tr><th>Row</th><th>Problem</th></tr></thead><tbody>${res.errors.map((e) => `<tr><td>${e.row}</td><td>${esc(e.message)}</td></tr>`).join('')}</tbody></table></div>` : `<div class="notice ok"><b>${res.imported} row(s) imported.</b></div>`;
        if (!res.errors.length) toast(`${res.imported} ${t.title.toLowerCase()} imported`, 'ok');
        return false;
      } }],
    });
    $('#tpl', m.el).onclick = () => UI.downloadCSV(`${kind}-template`, cfg.columns, t.sample);
  };

  /* ======================= BOOT ======================= */
  async function boot() {
    const root = document.getElementById('root');
    if (!G.localStorage) { root.innerHTML = '<div class="loading">This browser does not support local storage.</div>'; return; }
    try { await Store.init(SP.LocalStorageAdapter); }
    catch (e) { console.error(e); root.innerHTML = `<div class="loading">Could not open local storage: ${esc(e.message)}. Private browsing may block it.</div>`; return; }
    svc.restoreSession();
    let lastHash = location.hash;
    G.addEventListener('hashchange', () => {
      if (App.dirty && App.dirty() && !G.confirm('You have unsaved changes. Leave this page?')) { App._revert = true; location.hash = lastHash; return; }
      if (App._revert) { App._revert = false; return; }
      App.dirty = null; lastHash = location.hash; App.refresh();
    });
    G.addEventListener('beforeunload', (e) => { if (App.dirty && App.dirty()) { e.preventDefault(); e.returnValue = ''; } });
    Store.on(() => {
      if (!Store.user) return;
      const u = byId(Store.db, 'users', Store.user.id);
      if (!u || !u.active) { svc.logout(); root.innerHTML = ''; App.refresh(); return; }
      Store.user = u;
      if (App.dirty && App.dirty()) return;
      if (UI.modalStack.length) { App.pendingRefresh = true; return; }
      App.refresh();
    });
    setInterval(() => { if (Store.user && !svc.restoreSession()) { svc.logout(); root.innerHTML = ''; App.renderAuth(); UI.toast('Session expired — please sign in again', 'warn'); } }, 60000);
    App.refresh();
  }
  document.addEventListener('DOMContentLoaded', boot);
})(window);
