/* ==========================================================================
   pages-a.js — Dashboard, Buyers, Style Master, Costing (list + live editor),
   Quotes & revisions.
   ========================================================================== */
(function (G) {
  'use strict';
  const SP = G.SP;
  const { Store, svc, D, sum, Calc, Fmt, AppError, can, UI, App, Pages, byId } = SP;
  const { esc, $, $$, ico, toast, modal, confirm, ask, run, form, read, table, act, badge, status, testTag, signed, pageHead, btn, guard, empty, fmtDate, fmtDT } = UI;

  /* ---------------- shared helpers ---------------- */
  const H = SP.H = {
    db: () => Store.db,
    buyer: (id) => byId(Store.db, 'buyers', id) || { name: '—' },
    style: (id) => byId(Store.db, 'styles', id) || { styleRef: '—' },
    po: (id) => byId(Store.db, 'pos', id) || { poNumber: '—' },
    pool: (id) => byId(Store.db, 'pools', id),
    buyerOpts: (includeId) => Store.db.buyers.filter((b) => b.active || b.id === includeId).sort((a, b) => a.name.localeCompare(b.name)).map((b) => ({ value: b.id, label: `${b.name} (${b.code})` })),
    allBuyerOpts: () => Store.db.buyers.slice().sort((a, b) => a.name.localeCompare(b.name)).map((b) => ({ value: b.id, label: b.name })),
    seasonOpts: () => Array.from(new Set(Store.db.styles.map((s) => s.season).concat(Store.db.pools.map((p) => p.season)).filter(Boolean))).sort().map((s) => ({ value: s, label: s })),
    styleOpts: (buyerId, includeArchived) => Store.db.styles.filter((s) => (!buyerId || s.buyerId === buyerId) && (includeArchived || s.status !== 'ARCHIVED')).sort((a, b) => a.styleRef.localeCompare(b.styleRef)).map((s) => ({ value: s.id, label: `${s.styleRef} — ${s.description || ''} [${s.season}]` })),
    currencyOpts: () => Store.db.currencies.filter((c) => c.active !== false).map((c) => ({ value: c.code, label: `${c.code} — ${c.name}` })),
    poolOpts: (pred) => Store.db.pools.filter((p) => !pred || pred(p)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((p) => ({ value: p.id, label: `${p.poolNo} — ${H.buyer(p.buyerId).name} [${p.status}]` })),
    lineLabel: (l) => `${l.confNo} · ${H.po(l.poId).poNumber} · ${H.style(l.styleId).styleRef} · ${l.combo}`,
    cats: () => SP.categories(),
    catLabel: (k) => SP.catLabel(k),
    /** Pool selector bar used by pool-scoped pages. */
    poolBar(view, q, route, pred, extra) {
      const opts = H.poolOpts(pred || ((p) => p.status !== 'CANCELLED'));
      const sel = q.pool && opts.some((o) => o.value === q.pool) ? q.pool : '';
      return `<div class="filters noprint"><div class="fld" style="flex:1 1 320px;max-width:460px"><label for="poolSel">Pool</label><select id="poolSel" data-search>${'<option value="">— Select a pool —</option>' + opts.map((o) => `<option value="${o.value}"${o.value === sel ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select></div>${extra || ''}</div>`;
    },
    bindPoolBar(view, route) { const s = $('#poolSel', view); UI.enhance(view); if (s) s.addEventListener('change', () => App.go(route, { pool: s.value })); },
    poolStatus: (p) => status(p.status) + testTag(p),
  };

  /* ======================= DASHBOARD ======================= */
  App.route('dashboard', 'reports.view', async (view, q) => {
    const db = Store.db;
    const f = { buyer: q.buyer || '', season: q.season || '', pool: q.pool || '', style: q.style || '', po: q.po || '', from: q.from || '', to: q.to || '' };
    const inRange = (d) => (!f.from || (d || '') >= f.from) && (!f.to || (d || '').slice(0, 10) <= f.to);
    const lines = db.lines.filter((l) => (!f.buyer || l.buyerId === f.buyer) && (!f.style || l.styleId === f.style) && (!f.po || l.poId === f.po) && (!f.season || H.style(l.styleId).season === f.season) && inRange(l.confirmationDate || l.createdAt));
    const conf = lines.filter((l) => l.status === 'CONFIRMED');
    const poolLines = f.pool ? new Set(db.allocations.filter((a) => a.poolId === f.pool && a.status === 'ACTIVE').map((a) => a.lineId)) : null;
    const confP = poolLines ? conf.filter((l) => poolLines.has(l.id)) : conf;
    const ships = db.shipments.filter((s) => !s.deletedAt && (!f.buyer || s.buyerId === f.buyer) && (!f.style || s.styleId === f.style) && (!f.po || s.poId === f.po) && (!f.pool || s.poolId === f.pool) && (!f.season || H.style(s.styleId).season === f.season) && inRange(s.shipmentDate));
    const pools = db.pools.filter((p) => p.status !== 'CANCELLED' && (!f.buyer || p.buyerId === f.buyer) && (!f.pool || p.id === f.pool) && (!f.season || p.season === f.season) && inRange(p.createdAt.slice(0, 10)) &&
      (!f.style || db.allocations.some((a) => a.poolId === p.id && a.status === 'ACTIVE' && byId(db, 'lines', a.lineId).styleId === f.style)) && (!f.po || db.allocations.some((a) => a.poolId === p.id && a.status === 'ACTIVE' && byId(db, 'lines', a.lineId).poId === f.po)));
    const reps = pools.map((p) => SP.computePool(db, p.id));
    const styles = db.styles.filter((s) => (!f.buyer || s.buyerId === f.buyer) && (!f.season || s.season === f.season) && (!f.style || s.id === f.style));
    const quotes = db.quotes.filter((x) => (!f.buyer || x.buyerId === f.buyer) && (!f.season || x.season === f.season) && (!f.style || x.styleId === f.style) && inRange(x.quoteDate));
    const pendingShip = confP.filter((l) => { const m = SP.lineMetrics(db, l); return !m.finalShipped && m.remainingShip > 0; });
    const tot = (k) => sum(reps, (r) => D(r.totals[k]));
    const inr = tot('inrReceived'), lim = tot('totalLimits'), actl = tot('totalActual');
    const qsBase = { buyer: f.buyer, season: f.season };
    const K = (label, value, href, sub, cls) => `<a class="kpi ${cls || ''}" href="${href}"><div class="l"><span>${esc(label)}</span></div><div class="v">${value}</div>${sub ? `<div class="s">${sub}</div>` : ''}</a>`;
    const filterBar = `<form class="filters card" style="padding:12px 14px" id="dashf">
      ${UI.field({ name: 'buyer', label: 'Buyer', type: 'select', options: H.allBuyerOpts(), placeholder: 'All buyers' }, f.buyer)}
      ${UI.field({ name: 'season', label: 'Season', type: 'select', options: H.seasonOpts(), placeholder: 'All seasons' }, f.season)}
      ${UI.field({ name: 'style', label: 'Style', type: 'select', search: true, options: H.styleOpts(f.buyer, true), placeholder: 'All styles' }, f.style)}
      ${UI.field({ name: 'po', label: 'PO', type: 'select', search: true, options: db.pos.filter((p) => !f.buyer || p.buyerId === f.buyer).map((p) => ({ value: p.id, label: p.poNumber })), placeholder: 'All POs' }, f.po)}
      ${UI.field({ name: 'pool', label: 'Pool', type: 'select', options: H.poolOpts((p) => !f.buyer || p.buyerId === f.buyer), placeholder: 'All pools' }, f.pool)}
      ${UI.field({ name: 'from', label: 'From', type: 'date' }, f.from)}
      ${UI.field({ name: 'to', label: 'To', type: 'date' }, f.to)}
      <div class="fld" style="flex:0 0 auto"><label>&nbsp;</label><button class="btn" type="button" id="dashClear">Clear</button></div></form>`;
    const chartPools = reps.filter((r) => !D(r.totals.inrReceived).isZero() || !D(r.totals.totalLimits).isZero()).slice(0, 12);
    view.innerHTML = pageHead('Dashboard', 'Live figures calculated from saved records. Click any figure to open the matching records.') + filterBar + `
      <div class="kpis">
        ${K('Buyers', db.buyers.filter((b) => b.active).length, '#/buyers', `${db.buyers.length} total`)}
        ${K('Styles', styles.length, '#/styles?' + UI.qs(qsBase))}
        ${K('Quotations', quotes.length, '#/quotes?' + UI.qs(qsBase), `${quotes.filter((x) => x.status === 'ACCEPTED').length} accepted`)}
        ${K('Confirmed orders', confP.length, '#/confirmations?' + UI.qs(Object.assign({ status: 'CONFIRMED' }, qsBase)))}
        ${K('Ordered quantity', Fmt.qty(confP.reduce((a, l) => a + l.orderQty, 0)), '#/confirmations?' + UI.qs(Object.assign({ status: 'CONFIRMED' }, qsBase)), 'pcs')}
        ${K('Shipped quantity', Fmt.qty(ships.reduce((a, s) => a + s.shippedQty, 0)), '#/shipments?' + UI.qs({ pool: f.pool, buyer: f.buyer }), 'pcs')}
        ${K('Pending shipments', pendingShip.length, '#/confirmations?' + UI.qs(Object.assign({ ship: 'pending' }, qsBase)), 'order lines not finally shipped', pendingShip.length ? 'warn' : '')}
        ${K('Open pools', pools.filter((p) => p.status !== 'CLOSED').length, '#/pools?status=open', `${pools.filter((p) => p.status === 'DRAFT').length} draft · ${pools.filter((p) => p.status === 'REOPENED').length} reopened`)}
        ${K('Closed pools', pools.filter((p) => p.status === 'CLOSED').length, '#/pools?status=CLOSED')}
        ${K('Pending expense entries', db.expenses.filter((e) => !e.deletedAt && e.status === 'DRAFT' && pools.some((p) => p.id === e.poolId)).length, '#/expenses' + (f.pool ? '?pool=' + f.pool : ''), 'draft entries', '')}
        ${K('Pending item decisions', db.exceptions.filter((x) => x.status === 'PENDING' && pools.some((p) => p.id === x.poolId)).length, '#/exceptions?status=PENDING' + (f.pool ? '&pool=' + f.pool : ''), 'missing / additional')}
        ${K('Shipment revenue', Fmt.inr(sum(ships, (s) => D(s.inrValue)).toString(), 0), '#/shipments?' + UI.qs({ pool: f.pool, buyer: f.buyer }), 'INR, before adjustments')}
        ${K('INR received (pools)', Fmt.inr(inr.toString(), 0), '#/profitability', 'after additions / deductions')}
        ${K('Budgeted expenses', Fmt.inr(lim.toString(), 0), '#/limits' + (f.pool ? '?pool=' + f.pool : ''), 'Σ expense limits')}
        ${K('Actual expenses', Fmt.inr(actl.toString(), 0), '#/limits' + (f.pool ? '?pool=' + f.pool : ''), 'Σ saved expense entries')}
        ${K('Budget-based margin', Fmt.inr(inr.sub(lim).toString(), 0), '#/profitability', 'estimate: INR − limits', inr.sub(lim).isNeg() ? 'bad' : 'ok')}
        ${K('Actual expense-based margin', Fmt.inr(inr.sub(actl).toString(), 0), '#/profitability', 'result: INR − actual', inr.sub(actl).isNeg() ? 'bad' : 'ok')}
      </div>
      <div class="grid2">
        <div class="card"><div class="hd"><h2>Pools: INR received vs budget vs actual</h2></div><div class="bd chart">${chartPools.length ? barChart(chartPools) : empty('No pool figures yet', '<p>Shipments and expenses will appear here once recorded.</p>')}</div></div>
        <div class="card"><div class="hd"><h2>Pools</h2><a class="btn sm" href="#/profitability">Profitability</a></div><div class="bd p0" id="dpools"></div></div>
      </div>`;
    table($('#dpools', view), {
      id: 'dash-pools', noToolbar: true, pageSize: 8, rows: reps, empty: 'No pools for this filter',
      columns: [
        { key: 'poolNo', label: 'Pool', value: (r) => r.pool.poolNo, render: (r) => `<a href="#/pools/view?id=${r.pool.id}">${esc(r.pool.poolNo)}</a> ${status(r.pool.status)}` },
        { key: 'inr', label: 'INR received', num: true, value: (r) => r.totals.inrReceived, render: (r) => Fmt.inr(r.totals.inrReceived, 0) },
        { key: 'bm', label: 'Budget margin', num: true, value: (r) => r.margins.budgetMargin, render: (r) => signed(r.margins.budgetMargin, (x) => Fmt.inr(x, 0)) },
        { key: 'am', label: 'Actual margin', num: true, value: (r) => r.margins.actualMargin, render: (r) => signed(r.margins.actualMargin, (x) => Fmt.inr(x, 0)) },
      ],
    });
    const fm = $('#dashf', view); UI.enhance(fm);
    fm.addEventListener('change', () => App.go('dashboard', read(fm)));
    $('#dashClear', view).onclick = () => App.go('dashboard');
  });
  function barChart(reps) {
    const series = [['INR received', 'inrReceived', '#1f3a5f'], ['Expense limits', 'totalLimits', '#8fb3e6'], ['Actual expenses', 'totalActual', '#0f766e']];
    const max = Math.max(1, ...reps.flatMap((r) => series.map((s) => D(r.totals[s[1]]).toNumber())));
    const W = 560, H = 240, pad = 44, gw = (W - pad - 10) / reps.length, bw = Math.min(26, (gw - 12) / 3);
    const y = (v) => H - 28 - (v / max) * (H - 48);
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => max * t);
    const short = (v) => (v >= 1e7 ? (v / 1e7).toFixed(1) + 'Cr' : v >= 1e5 ? (v / 1e5).toFixed(1) + 'L' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'k' : v.toFixed(0));
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Bar chart of INR received, expense limits and actual expenses per pool">
      ${ticks.map((t) => `<line x1="${pad}" x2="${W - 6}" y1="${y(t)}" y2="${y(t)}" stroke="#e5e9f0"/><text x="${pad - 6}" y="${y(t) + 4}" font-size="10" text-anchor="end" fill="#5b6678">${short(t)}</text>`).join('')}
      ${reps.map((r, i) => { const x0 = pad + i * gw + (gw - bw * 3) / 2; return series.map((s, j) => { const v = D(r.totals[s[1]]).toNumber(); return `<rect x="${x0 + j * bw}" y="${y(v)}" width="${bw - 2}" height="${Math.max(0, H - 28 - y(v))}" fill="${s[2]}" rx="2"><title>${esc(r.pool.poolNo)} · ${s[0]}: ${Fmt.inr(r.totals[s[1]])}</title></rect>`; }).join('') + `<text x="${pad + i * gw + gw / 2}" y="${H - 10}" font-size="10.5" text-anchor="middle" fill="#1b2433">${esc(r.pool.poolNo)}</text>`; }).join('')}
    </svg><div class="legend">${series.map((s) => `<span><i style="background:${s[2]}"></i>${s[0]}</span>`).join('')}</div>`;
  }

  /* ======================= BUYERS ======================= */
  App.route('buyers', 'buyers.view', async (view, q) => {
    const db = Store.db;
    view.innerHTML = pageHead('Buyers', 'Buyer master: contacts, default currency and status.', guard('buyers.edit', btn('Add buyer', 'id="addB"', 'primary', 'plus')) + guard('import.run', btn('Import CSV', 'id="impB"', '', 'dl'))) + '<div class="card"><div class="bd p0" id="bt"></div></div>';
    const t = table($('#bt', view), {
      id: 'buyers', exportName: 'buyers', rows: () => Store.db.buyers, sort: { key: 'name', dir: 'asc' },
      filters: [{ key: 'active', label: 'Status', options: [{ value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }], get: (r) => String(r.active) }, { key: 'currency', label: 'Currency', options: () => Array.from(new Set(Store.db.buyers.map((b) => b.currency))) }, { key: 'country', label: 'Country', options: () => Array.from(new Set(Store.db.buyers.map((b) => b.country).filter(Boolean))).sort() }],
      columns: [
        { key: 'code', label: 'Buyer ID', render: (r) => `<span class="mono">${esc(r.code)}</span>` },
        { key: 'name', label: 'Buyer name', wrap: true, render: (r) => `<b>${esc(r.name)}</b>${testTag(r)}` },
        { key: 'contact', label: 'Contact', hideSm: true }, { key: 'email', label: 'Email', hideSm: true }, { key: 'phone', label: 'Phone', hideSm: true },
        { key: 'country', label: 'Country' }, { key: 'currency', label: 'Currency' },
        { key: 'active', label: 'Status', value: (r) => (r.active ? 'Active' : 'Inactive'), render: (r) => status(r.active ? 'ACTIVE' : 'INACTIVE') },
        { key: 'createdAt', label: 'Created', hideSm: true, render: (r) => fmtDate(r.createdAt) }, { key: 'updatedAt', label: 'Updated', hideSm: true, render: (r) => fmtDate(r.updatedAt) },
      ],
      actions: (r) => act('view', '', '', 'eye', false, 'View') + guard('buyers.edit', act('edit', '', '', 'edit', false, 'Edit') + act('tog', r.active ? 'Deactivate' : 'Activate')) + guard('buyers.delete', act('del', '', 'danger', 'trash', false, 'Delete')),
      on: {
        view: (r) => viewBuyer(r), edit: (r) => editBuyer(r),
        tog: async (r) => { if (await confirm(`${r.active ? 'Deactivate' : 'Activate'} buyer <b>${esc(r.name)}</b>?${r.active ? ' Inactive buyers cannot be used for new styles; history is kept.' : ''}`)) run(null, async () => { await svc.setBuyerActive(r.id, !r.active); toast('Buyer updated', 'ok'); }); },
        del: async (r) => { if (await confirm(`Delete buyer <b>${esc(r.name)}</b>? This cannot be undone.`, { danger: true, ok: 'Delete' })) run(null, async () => { await svc.deleteBuyer(r.id); toast('Buyer deleted', 'ok'); }); },
      },
    });
    const ab = $('#addB', view); if (ab) ab.onclick = () => editBuyer();
    const ib = $('#impB', view); if (ib) ib.onclick = () => Pages.importDialog('buyers');
    if (q.view) { UI.consume('view'); const b = byId(db, 'buyers', q.view); if (b) viewBuyer(b); }
    void t;
  });
  function editBuyer(b) {
    const cur = [{ value: 'INR', label: 'INR — Indian Rupee' }].concat(H.currencyOpts());
    modal({
      title: b ? `Edit buyer ${b.code}` : 'Add buyer', size: 'lg',
      body: form([
        { name: 'code', label: 'Buyer ID', help: b ? 'Unique identifier' : 'Leave blank to auto-generate (BUY-0001…)', span: 's4' },
        { name: 'name', label: 'Buyer name', required: true, span: 's8' },
        { name: 'contact', label: 'Contact person', span: 's4' }, { name: 'email', label: 'Email', type: 'email', span: 's4' }, { name: 'phone', label: 'Phone', type: 'tel', span: 's4' },
        { name: 'address', label: 'Address', type: 'textarea', span: 's12' },
        { name: 'country', label: 'Country', span: 's4' }, { name: 'currency', label: 'Default currency', type: 'select', options: cur, required: true, span: 's4' },
        { name: 'active', label: 'Status', type: 'select', options: [{ value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }], placeholder: false, span: 's4' },
        { name: 'notes', label: 'Notes', type: 'textarea', span: 's12' },
      ], b ? Object.assign({}, b, { active: String(b.active) }) : { currency: 'GBP', active: 'true' }),
      actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: async (m) => { const v = read(m.el); await svc.saveBuyer(Object.assign(v, { id: b && b.id, active: v.active === 'true' })); toast('Buyer saved', 'ok'); } }],
    });
  }
  function viewBuyer(b) {
    const db = Store.db;
    const styles = db.styles.filter((s) => s.buyerId === b.id), pos = db.pos.filter((p) => p.buyerId === b.id), pools = db.pools.filter((p) => p.buyerId === b.id);
    modal({
      title: `${b.name} (${b.code})`, size: 'lg',
      body: `<dl class="dl"><dt>Contact</dt><dd>${esc(b.contact || '—')}</dd><dt>Email</dt><dd>${esc(b.email || '—')}</dd><dt>Phone</dt><dd>${esc(b.phone || '—')}</dd><dt>Address</dt><dd>${esc(b.address || '—')}</dd><dt>Country</dt><dd>${esc(b.country || '—')}</dd><dt>Currency</dt><dd>${esc(b.currency)}</dd><dt>Status</dt><dd>${status(b.active ? 'ACTIVE' : 'INACTIVE')}${testTag(b)}</dd><dt>Notes</dt><dd>${esc(b.notes || '—')}</dd><dt>Created / updated</dt><dd>${fmtDT(b.createdAt)} / ${fmtDT(b.updatedAt)}</dd></dl>
        <h3 style="margin:16px 0 6px">Related records</h3><p><a href="#/styles?buyer=${b.id}">${styles.length} style(s)</a> · <a href="#/pos?buyer=${b.id}">${pos.length} PO(s)</a> · <a href="#/pools?buyer=${b.id}">${pools.length} pool(s)</a></p>`,
      actions: [{ label: 'Close' }].concat(can('buyers.edit') ? [{ label: 'Edit', cls: 'primary', onClick: (m) => { m.close(); editBuyer(b); return false; } }] : []),
    });
  }

  /* ======================= STYLE MASTER ======================= */
  App.route('styles', 'styles.view', async (view, q) => {
    view.innerHTML = pageHead('Style Master', 'Styles per buyer and season, size sets and expected quantities.', guard('styles.edit', btn('Add style', 'id="addS"', 'primary', 'plus')) + guard('import.run', btn('Import CSV', 'id="impS"', '', 'dl'))) + '<div class="card"><div class="bd p0" id="st"></div></div>';
    table($('#st', view), {
      id: 'styles', exportName: 'styles', rows: () => Store.db.styles, sort: { key: 'styleRef', dir: 'asc' },
      initialFilters: { buyerId: q.buyer || '', season: q.season || '' },
      filters: [{ key: 'buyerId', label: 'Buyer', options: H.allBuyerOpts }, { key: 'season', label: 'Season', options: H.seasonOpts }, { key: 'status', label: 'Status', options: ['ACTIVE', 'DRAFT', 'ARCHIVED'] }, { key: 'productType', label: 'Product', options: () => Array.from(new Set(Store.db.styles.map((s) => s.productType).filter(Boolean))) }],
      columns: [
        { key: 'image', label: 'Image', sortable: false, export: false, render: (r) => (r.image ? `<img class="thumb" src="${esc(r.image)}" alt="${esc(r.styleRef)}" loading="lazy">` : '<span class="thumb ph">—</span>') },
        { key: 'code', label: 'Style ID', render: (r) => `<span class="mono">${esc(r.code)}</span>` },
        { key: 'styleRef', label: 'Style ref', wrap: true, render: (r) => `<b>${esc(r.styleRef)}</b>${testTag(r)}` },
        { key: 'buyer', label: 'Buyer', value: (r) => H.buyer(r.buyerId).name, wrap: true }, { key: 'season', label: 'Season' },
        { key: 'description', label: 'Description', wrap: true, hideSm: true }, { key: 'productType', label: 'Product', hideSm: true }, { key: 'sizeRange', label: 'Size range', hideSm: true },
        { key: 'expectedQty', label: 'Expected qty', num: true, render: (r) => `${Fmt.qty(r.expectedQty)}<div class="small faint">${r.qtyPerCombo} × ${r.combos}</div>`, exportValue: (r) => r.expectedQty },
        { key: 'quoteDate', label: 'Quote date', render: (r) => fmtDate(r.quoteDate), hideSm: true }, { key: 'status', label: 'Status', render: (r) => status(r.status) },
      ],
      actions: (r) => act('view', '', '', 'eye', false, 'View') + guard('costing.view', act('cost', 'Costing')) + guard('styles.edit', act('edit', '', '', 'edit', false, 'Edit')) + guard('styles.delete', act('arch', r.status === 'ARCHIVED' ? 'Restore' : 'Archive') + act('del', '', 'danger', 'trash', false, 'Delete')),
      on: {
        view: (r) => viewStyle(r), edit: (r) => editStyle(r), cost: (r) => App.go('costing', { style: r.id }),
        arch: async (r) => { const to = r.status === 'ARCHIVED' ? 'ACTIVE' : 'ARCHIVED'; if (await confirm(`${to === 'ARCHIVED' ? 'Archive' : 'Restore'} style <b>${esc(r.styleRef)}</b>? Archived styles keep all costing and order history but cannot be used for new costings.`)) run(null, async () => { await svc.setStyleStatus(r.id, to); toast('Style updated', 'ok'); }); },
        del: async (r) => { if (await confirm(`Delete style <b>${esc(r.styleRef)}</b>? Only unused styles can be deleted.`, { danger: true, ok: 'Delete' })) run(null, async () => { await svc.deleteStyle(r.id); toast('Style deleted', 'ok'); }); },
      },
    });
    const a = $('#addS', view); if (a) a.onclick = () => editStyle();
    const ib = $('#impS', view); if (ib) ib.onclick = () => Pages.importDialog('styles');
    if (q.view) { UI.consume('view'); const s = byId(Store.db, 'styles', q.view); if (s) viewStyle(s); }
  });
  function editStyle(s) {
    const st = Store.db.settings;
    let image = s ? s.image : null;
    const imgHtml = () => `<div style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap"><div class="imgprev" id="imgPrev">${image ? `<img src="${esc(image)}" alt="Style image">` : 'No image'}</div>
      <div style="display:flex;flex-direction:column;gap:6px">${st.imageStorage === 'url' ? `<input class="inp" type="url" id="imgUrl" placeholder="https://… image URL" value="${esc(image && !image.startsWith('data:') ? image : '')}">` : `<button class="btn sm" type="button" id="imgUp">${image ? 'Replace image' : 'Upload image'}</button>`}<button class="btn sm danger" type="button" id="imgRm" ${image ? '' : 'disabled'}>Remove image</button><span class="help">Storage: ${st.imageStorage === 'url' ? 'external URL' : 'embedded (resized to max 900px)'}</span></div></div>`;
    const m = modal({
      title: s ? `Edit style ${s.styleRef}` : 'Add style', size: 'lg',
      body: form([
        { name: 'buyerId', label: 'Buyer', type: 'select', search: true, options: H.buyerOpts(s && s.buyerId), required: true, span: 's6' },
        { name: 'season', label: 'Season', required: true, span: 's3', placeholder: 'e.g. S-27', attrs: 'list="seasonList"' },
        { name: 'status', label: 'Status', type: 'select', options: ['ACTIVE', 'DRAFT', 'ARCHIVED'], placeholder: false, span: 's3' },
        { name: 'styleRef', label: 'Style reference', required: true, span: 's6', help: 'Unique per buyer + season' },
        { name: 'productType', label: 'Product type', span: 's6', attrs: 'list="ptList"' },
        { name: 'description', label: 'Style description', span: 's12' },
        { name: 'sizeRange', label: 'Size range', span: 's4', placeholder: 'e.g. 0M - 24M' },
        { name: 'sizeSet', label: 'Size set template', type: 'select', options: st.sizeSets.map((x, i) => ({ value: i, label: x.name })), placeholder: '— Apply a template —', span: 's4' },
        { name: 'sizes', label: 'Sizes (comma separated)', span: 's4', help: 'Used for size-wise order quantities' },
        { name: 'qtyPerCombo', label: 'Expected qty per combo', type: 'int', span: 's3' }, { name: 'combos', label: 'Expected number of combos', type: 'int', span: 's3' },
        { name: 'expected', label: 'Expected total qty', type: 'static', span: 's3', html: '<b id="expQ">0</b> pcs' },
        { name: 'quoteDate', label: 'Quote date', type: 'date', span: 's3' },
        { name: 'remarks', label: 'Remarks', type: 'textarea', span: 's12' },
        { name: 'img', label: 'Style image', type: 'html', html: '<div id="imgBox"></div>' },
      ], s ? Object.assign({}, s, { sizes: (s.sizes || []).join(', ') }) : { status: 'ACTIVE' }) + `<datalist id="seasonList">${H.seasonOpts().map((o) => `<option value="${esc(o.value)}">`).join('')}</datalist><datalist id="ptList">${st.productTypes.map((p) => `<option value="${esc(p)}">`).join('')}</datalist>`,
      actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: async (mm) => {
        const v = read(mm.el); if (st.imageStorage === 'url') { const u = $('#imgUrl', mm.el); image = u && u.value.trim() ? u.value.trim() : image && image.startsWith('data:') ? image : null; if (image && !/^(https?:|data:)/.test(image)) throw new AppError('Image URL must start with http(s)://'); }
        await svc.saveStyle(Object.assign(v, { id: s && s.id, image, sizes: v.sizes.split(',') })); toast('Style saved', 'ok');
      } }],
    });
    const el = m.el;
    const upd = () => { const a = Number($('[name=qtyPerCombo]', el).value || 0), b = Number($('[name=combos]', el).value || 0); $('#expQ', el).textContent = Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b >= 0 ? Fmt.qty(a * b) : 'invalid'; };
    $('[name=qtyPerCombo]', el).oninput = upd; $('[name=combos]', el).oninput = upd; upd();
    $('[name=sizeSet]', el).onchange = (e) => { const x = st.sizeSets[e.target.value]; if (x) $('[name=sizes]', el).value = x.sizes.join(', '); };
    const drawImg = () => {
      $('#imgBox', el).innerHTML = imgHtml();
      const up = $('#imgUp', el); if (up) up.onclick = async () => { const f = await UI.pickFile('image/*'); if (!f) return; run(up, async () => { image = await UI.imageToDataUrl(f); drawImg(); }, el); };
      $('#imgRm', el).onclick = () => { image = null; drawImg(); };
      const u = $('#imgUrl', el); if (u) u.onchange = () => { image = u.value.trim() || null; $('#imgPrev', el).innerHTML = image ? `<img src="${esc(image)}" alt="">` : 'No image'; };
    };
    drawImg();
  }
  function viewStyle(s) {
    const db = Store.db;
    const cv = db.costings.filter((c) => c.styleId === s.id), qt = db.quotes.filter((x) => x.styleId === s.id), ln = db.lines.filter((l) => l.styleId === s.id);
    modal({
      title: `${s.styleRef} (${s.code})`, size: 'lg',
      body: `<div style="display:flex;gap:16px;flex-wrap:wrap"><div class="imgprev">${s.image ? `<img src="${esc(s.image)}" alt="">` : 'No image'}</div><dl class="dl" style="flex:1;min-width:240px">
        <dt>Buyer</dt><dd>${esc(H.buyer(s.buyerId).name)}</dd><dt>Season</dt><dd>${esc(s.season)}</dd><dt>Description</dt><dd>${esc(s.description || '—')}</dd><dt>Product type</dt><dd>${esc(s.productType || '—')}</dd><dt>Size range</dt><dd>${esc(s.sizeRange || '—')}</dd><dt>Sizes</dt><dd>${esc((s.sizes || []).join(', ') || '—')}</dd>
        <dt>Expected qty</dt><dd>${s.qtyPerCombo} per combo × ${s.combos} combos = <b>${Fmt.qty(s.expectedQty)}</b></dd><dt>Quote date</dt><dd>${fmtDate(s.quoteDate)}</dd><dt>Status</dt><dd>${status(s.status)}${testTag(s)}</dd><dt>Remarks</dt><dd>${esc(s.remarks || '—')}</dd></dl></div>
        <h3 style="margin:16px 0 6px">History</h3><p><a href="#/costing?style=${s.id}">${cv.length} costing version(s)</a> · <a href="#/quotes?style=${s.id}">${qt.length} quote(s)</a> · <a href="#/confirmations?style=${s.id}">${ln.length} order line(s)</a></p>`,
      actions: [{ label: 'Close' }].concat(can('styles.edit') ? [{ label: 'Edit', cls: 'primary', onClick: (m) => { m.close(); editStyle(s); return false; } }] : []),
    });
  }

  /* ======================= COSTING LIST ======================= */
  App.route('costing', 'costing.view', async (view, q) => {
    view.innerHTML = pageHead('Costing Inputs', 'Costing versions per style. Approved versions are locked; use “Save As” to create a revision.', guard('costing.edit', btn('New costing', 'id="newC"', 'primary', 'plus'))) +
      `<div class="notice info">Formula ${esc(Calc.FORMULA_VERSION)}: row amount = qty/consumption × rate × (1 + allowance%). Fabric loss default ${esc(Store.db.settings.fabricLossPct)}% (verified against the workbook). Total INR = items total + overall %; foreign price = total INR ÷ INR per unit.</div>
      <div class="card"><div class="bd p0" id="ct"></div></div>`;
    table($('#ct', view), {
      id: 'costings', exportName: 'costing-versions', rows: () => Store.db.costings, sort: { key: 'updatedAt', dir: 'desc' },
      initialFilters: { styleId: q.style || '' },
      filters: [{ key: 'styleId', label: 'Style', options: () => H.styleOpts(null, true) }, { key: 'buyer', label: 'Buyer', options: H.allBuyerOpts, get: (r) => H.style(r.styleId).buyerId }, { key: 'season', label: 'Season', options: H.seasonOpts, get: (r) => H.style(r.styleId).season }, { key: 'status', label: 'Status', options: ['DRAFT', 'APPROVED'] }],
      columns: [
        { key: 'style', label: 'Style', value: (r) => H.style(r.styleId).styleRef, render: (r) => `<b>${esc(H.style(r.styleId).styleRef)}</b>${testTag(H.style(r.styleId))}<div class="small muted">${esc(H.buyer(H.style(r.styleId).buyerId).name)} · ${esc(H.style(r.styleId).season)}</div>` },
        { key: 'label', label: 'Version', render: (r) => `${esc(r.label)} <span class="faint small">v${r.versionNo}</span>` },
        { key: 'status', label: 'Status', render: (r) => status(r.status) },
        { key: 'items', label: 'Items total', num: true, value: (r) => r.results.itemsTotal, render: (r) => Fmt.inr(r.results.itemsTotal) },
        { key: 'total', label: 'Total INR', num: true, value: (r) => r.results.totalInr, render: (r) => `<b>${Fmt.inr(r.results.totalInr)}</b>` },
        { key: 'rate', label: 'Rate', num: true, value: (r) => r.exchangeRate, render: (r) => (r.exchangeRate ? `${esc(r.currency)} @ ${Fmt.num(r.exchangeRate, 2)}` : '—') },
        { key: 'price', label: 'Price', num: true, value: (r) => r.results.foreignPrice, render: (r) => Fmt.money(r.results.foreignPrice, r.currency, 4) },
        { key: 'updatedAt', label: 'Updated', hideSm: true, render: (r) => fmtDT(r.updatedAt) },
      ],
      onRow: (r) => App.go('costing/edit', { id: r.id }),
      actions: (r) => act('open', r.status === 'DRAFT' && can('costing.edit') ? 'Edit' : 'Open') + guard('costing.edit', act('saveas', 'Save As')) + (r.status === 'DRAFT' ? guard('costing.edit', act('del', '', 'danger', 'trash', false, 'Delete')) : ''),
      on: {
        open: (r) => App.go('costing/edit', { id: r.id }),
        saveas: (r) => run(null, async () => { const v = await svc.saveAsCosting(r.id); toast(`${v.label} created`, 'ok'); App.go('costing/edit', { id: v.id }); }),
        del: async (r) => { if (await confirm(`Delete draft ${esc(r.label)} of ${esc(H.style(r.styleId).styleRef)}?`, { danger: true, ok: 'Delete' })) run(null, async () => { await svc.deleteCosting(r.id); toast('Deleted', 'ok'); }); },
      },
    });
    const nb = $('#newC', view);
    if (nb) nb.onclick = () => modal({
      title: 'New costing', body: form([{ name: 'styleId', label: 'Style', type: 'select', search: true, options: H.styleOpts(), required: true, span: 's12', help: 'A new version is created (Original for the first costing, then Revised 1, 2…)' }], { styleId: q.style }),
      actions: [{ label: 'Cancel' }, { label: 'Create', cls: 'primary', onClick: async (m) => { const v = read(m.el); if (!v.styleId) throw new AppError('Select a style', 'styleId'); const c = await svc.newCosting(v.styleId); App.go('costing/edit', { id: c.id }); } }],
    });
  });

  /* ======================= COSTING EDITOR ======================= */
  const QTY_LABEL = { FABRIC: 'Consumption / pc', TRIMS: 'Qty / pc', APPLICATION: 'Qty / allowance', CMT: 'Basis qty', OTHERS: 'Basis qty' };
  App.route('costing/edit', 'costing.view', async (view, q) => {
    const v0 = byId(Store.db, 'costings', q.id);
    if (!v0) { view.innerHTML = empty('Costing version not found', '', '<a class="btn" href="#/costing">Back</a>'); return; }
    const style = H.style(v0.styleId);
    const editable = v0.status === 'DRAFT' && can('costing.edit');
    const st = SP.clone({ currency: v0.currency, exchangeRate: v0.exchangeRate, rateDate: v0.rateDate, rateId: v0.rateId, lines: v0.lines, percentages: v0.percentages, notes: v0.notes || '' });
    let dirty = false;
    const setDirty = (d) => { dirty = d; App.dirty = d ? () => true : null; const b = $('#dirtyTag', view); if (b) b.classList.toggle('hidden', !d); };
    App.dirty = null;
    const cats = H.cats();
    const units = Store.db.settings.units;
    const quotes = Store.db.quotes.filter((x) => x.costingId === v0.id);
    const siblings = Store.db.costings.filter((c) => c.styleId === v0.styleId).sort((a, b) => a.versionNo - b.versionNo);
    const unitSel = (l, f) => `<select class="cell" data-li="${l.id}" data-f="${f}" ${editable ? '' : 'disabled'}><option value=""></option>${units.map((u) => `<option${l[f] === u ? ' selected' : ''}>${esc(u)}</option>`).join('')}</select>`;
    const inp = (l, f, cls, ph) => `<input class="cell ${cls || ''}" data-li="${l.id}" data-f="${f}" value="${esc(l[f] === undefined || l[f] === null ? '' : l[f])}" ${editable ? '' : 'readonly'} ${cls === 'num' ? 'inputmode="decimal"' : ''} placeholder="${esc(ph || '')}" aria-label="${esc(f)}">`;
    const rowHtml = (l, i, n) => {
      const unitCols = l.category === 'FABRIC' || l.category === 'TRIMS';
      return `<tr data-row="${l.id}"><td class="faint small">${i + 1}</td>
        <td style="min-width:170px">${inp(l, 'name', '', 'Name')}${l.category === 'FABRIC' && (l.composition || l.gsm || l.colour) ? `<div class="small faint">${esc([l.composition, l.gsm && l.gsm + ' GSM', l.colour].filter(Boolean).join(' · '))}</div>` : ''}</td>
        ${l.category === 'FABRIC' ? '' : `<td style="min-width:140px" class="hide-sm">${inp(l, 'description', '', 'Description')}</td>`}
        <td style="width:110px">${inp(l, 'qty', 'num', '1')}</td>
        ${unitCols ? `<td style="width:90px">${unitSel(l, 'unit')}</td>` : ''}
        <td style="width:110px">${inp(l, 'rate', 'num', '0.00')}</td>
        ${unitCols ? `<td style="width:90px">${unitSel(l, 'rateUnit')}</td>` : ''}
        <td style="width:80px">${inp(l, 'allowancePct', 'num', '0')}</td>
        <td class="num" style="width:100px"><b data-amt="${l.id}">—</b></td>
        <td><div class="rowacts">${act('detail', '', '', 'edit', false, 'Details')}${editable ? act('up', '', '', 'up', i === 0, 'Move up') + act('down', '', '', 'down', i === n - 1, 'Move down') + act('dup', '', '', 'copy', false, 'Duplicate') + act('del', '', 'danger', 'trash', false, 'Delete') : ''}</div></td></tr>`;
    };
    const section = (c) => {
      const rows = st.lines.filter((l) => l.category === c.key);
      const unitCols = c.key === 'FABRIC' || c.key === 'TRIMS';
      return `<div class="card" data-sec="${c.key}"><div class="hd"><h2>${esc(c.label)}</h2><span class="sec-total" data-sectot="${c.key}"></span>
        ${editable ? `<button class="btn sm" data-add="${c.key}" type="button">${ico('plus')}Add ${esc(c.label.toLowerCase())}</button><button class="btn sm" data-copy="${c.key}" type="button">${ico('copy')}Copy rows…</button>` : ''}</div>
        <div class="bd p0">${rows.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>#</th><th>${c.key === 'FABRIC' ? 'Fabric' : c.key === 'APPLICATION' ? 'Application type' : c.key === 'CMT' ? 'CMT operation' : 'Item'}</th>${c.key === 'FABRIC' ? '' : '<th class="hide-sm">Description</th>'}<th>${esc(QTY_LABEL[c.key] || 'Qty / basis')}</th>${unitCols ? '<th>Unit</th>' : ''}<th>${c.key === 'FABRIC' ? 'Base rate' : 'Rate / pc'}</th>${unitCols ? '<th>Rate unit</th>' : ''}<th>${c.key === 'FABRIC' ? 'Loss %' : 'Allow. %'}</th><th class="num">Amount / pc</th><th></th></tr></thead><tbody>${rows.map((l, i) => rowHtml(l, i, rows.length)).join('')}</tbody></table></div>` : `<div class="empty small">No ${esc(c.label.toLowerCase())} rows${editable ? ' — use “Add”.' : '.'}</div>`}</div></div>`;
    };
    const rates = () => Store.db.rates.filter((r) => r.currency === st.currency).sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
    const draw = () => {
      view.innerHTML = pageHead(`${style.styleRef} — ${v0.label}`, `${esc(H.buyer(style.buyerId).name)} · Season ${esc(style.season)} · ${esc(style.description || '')}`,
        `<span class="badge warn hidden" id="dirtyTag">Unsaved changes</span>` +
        (editable ? btn('Save', 'id="cSave"', 'primary') + btn('Cancel', 'id="cCancel"') : '') +
        guard('costing.edit', btn('Save As (revise)', 'id="cSaveAs"')) +
        (v0.status === 'DRAFT' ? guard('costing.approve', btn('Approve', 'id="cApprove"')) : '') +
        guard('quotes.edit', btn(quotes.length ? 'View quote' : 'Generate quote', 'id="cQuote"', 'accent')) + btn('Print', 'id="cPrint"', '', 'print'),
        `<a href="#/costing">Costing</a> / <a href="#/costing?style=${style.id}">${esc(style.styleRef)}</a> / ${esc(v0.label)}`) +
        `<div class="notice ${v0.status === 'DRAFT' ? 'info' : 'warn'}">${status(v0.status)} ${v0.status === 'DRAFT' ? 'Draft — edit inputs; totals update instantly. On save, the data layer validates and recalculates everything with the same formula before storing it.' : `Approved by ${esc(v0.approvedBy || '')} on ${fmtDT(v0.approvedAt)} — locked. Use “Save As” to create the next revision.`} Versions: ${siblings.map((x) => x.id === v0.id ? `<b>${esc(x.label)}</b>` : `<a href="#/costing/edit?id=${x.id}">${esc(x.label)}</a>`).join(' · ')}</div>
        <div class="cost-layout"><div>
          <div class="card"><div class="hd"><h2>Currency &amp; exchange</h2></div><div class="bd"><div class="form-grid" id="fxBox">
            ${UI.field({ name: 'currency', label: 'Currency', type: 'select', options: H.currencyOpts(), placeholder: false, span: 's3', disabled: !editable }, st.currency)}
            ${UI.field({ name: 'rateId', label: 'Rate from table', type: 'select', options: rates().map((r) => ({ value: r.id, label: `${Fmt.num(r.inrPerUnit, 4)} — ${fmtDate(r.effectiveDate)}` })), placeholder: 'Manual entry', span: 's3', disabled: !editable }, st.rateId)}
            ${UI.field({ name: 'exchangeRate', label: 'INR per unit', type: 'decimal', required: true, span: 's3', readonly: !editable }, st.exchangeRate)}
            ${UI.field({ name: 'rateDate', label: 'Rate date', type: 'date', span: 's3', readonly: !editable }, st.rateDate)}
          </div></div></div>
          ${cats.map(section).join('')}
          <div class="card"><div class="hd"><h2>Overall percentage</h2>${editable ? `<button class="btn sm" id="addPct" type="button">${ico('plus')}Add component</button>` : ''}</div><div class="bd p0"><div class="table-wrap"><table class="t"><thead><tr><th>Component</th><th>%</th><th>Basis</th><th class="num">Base</th><th class="num">Amount</th><th></th></tr></thead><tbody id="pctBody">
            ${st.percentages.map((p) => `<tr><td><input class="cell" data-pi="${p.id}" data-f="name" value="${esc(p.name)}" ${editable ? '' : 'readonly'}></td><td style="width:90px"><input class="cell num" data-pi="${p.id}" data-f="pct" value="${esc(p.pct)}" inputmode="decimal" ${editable ? '' : 'readonly'}></td><td style="width:200px"><select class="cell" data-pi="${p.id}" data-f="basis" ${editable ? '' : 'disabled'}><option value="ITEMS"${p.basis === 'ITEMS' ? ' selected' : ''}>% of items total</option><option value="CUMULATIVE"${p.basis === 'CUMULATIVE' ? ' selected' : ''}>% of running total</option></select></td><td class="num" data-pbase="${p.id}"></td><td class="num"><b data-pamt="${p.id}"></b></td><td>${editable ? `<button class="btn xs danger" data-pdel="${p.id}" type="button" aria-label="Remove">${ico('trash')}</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="empty small">No percentage components</td></tr>'}
          </tbody></table></div><div class="bd small muted">Workbook method: one combined “REJ + OH + COMM + MARGIN” % applied to the items total. Split into separate components only when the client confirms each component's base.</div></div></div>
          <div class="card"><div class="hd"><h2>Notes</h2></div><div class="bd"><textarea class="inp" id="cNotes" style="width:100%;min-height:60px" ${editable ? '' : 'readonly'}>${esc(st.notes)}</textarea></div></div>
        </div>
        <aside class="card cost-summary"><div class="hd"><h2>Costing summary</h2></div><div class="bd" id="sumBox"></div></aside></div>`;
      bind(); calc();
    };
    const calc = () => {
      const r = Calc.costing(Object.assign({}, st), cats);
      r.lines.forEach((l) => { const e = view.querySelector(`[data-amt="${l.id}"]`); if (e) e.textContent = Fmt.num(l.amount); });
      cats.forEach((c) => { const e = view.querySelector(`[data-sectot="${c.key}"]`); if (e) e.textContent = Fmt.inr(r.categories[c.key] || 0); });
      r.percentages.forEach((p) => { const a = view.querySelector(`[data-pamt="${p.id}"]`), b = view.querySelector(`[data-pbase="${p.id}"]`); if (a) a.textContent = Fmt.inr(p.amount); if (b) b.textContent = Fmt.inr(p.base); });
      $('#sumBox', view).innerHTML = cats.filter((c) => !D(r.categories[c.key] || 0).isZero()).map((c) => `<div class="sumrow"><span>${esc(c.label)}</span><span class="num">${Fmt.inr(r.categories[c.key])}</span></div>`).join('') +
        `<div class="sumrow total"><span>All items total / pc</span><span class="num">${Fmt.inr(r.itemsTotal)}</span></div>` +
        r.percentages.map((p) => `<div class="sumrow"><span>${esc(p.name)} (${Fmt.pct(p.pct)})</span><span class="num">${Fmt.inr(p.amount)}</span></div>`).join('') +
        `<div class="sumrow total"><span>Total INR / pc</span><span class="num">${Fmt.inr(r.totalInr)}</span></div>
         <div class="sumrow"><span>Exchange (${esc(st.currency)})</span><span class="num">₹${Fmt.num(st.exchangeRate || 0, 4)}${st.rateDate ? ' · ' + fmtDate(st.rateDate) : ''}</span></div>
         <div class="sumrow big"><span>Price (${esc(st.currency)})</span><span class="num">${r.foreignPrice ? Fmt.money(r.foreignPrice, st.currency, 4) : '—'}</span></div>
         ${r.foreignPrice ? `<div class="small muted">Rounded: ${Fmt.money(r.foreignPrice, st.currency)} · ${esc(Calc.FORMULA_VERSION)}</div>` : ''}
         ${quotes.length ? `<div class="sumrow" style="margin-top:8px"><span>Quoted (${esc(quotes[0].quoteNo)})</span><span class="num">${Fmt.money(quotes[0].quotedPrice, quotes[0].currency)}</span></div>` : ''}
         ${r.errors.length ? `<div class="notice bad" style="margin-top:10px">${r.errors.map(esc).join('<br>')}</div>` : ''}`;
      $$('input.cell[data-f=qty],input.cell[data-f=rate],input.cell[data-f=allowancePct],input.cell[data-f=pct]', view).forEach((i) => i.classList.toggle('invalid', i.value.trim() !== '' && (!SP.Dec.valid(i.value) || D(i.value).isNeg())));
    };
    const line = (id) => st.lines.find((l) => l.id === id);
    const bind = () => {
      view.querySelectorAll('[data-li]').forEach((i) => {
        const h = () => { const l = line(i.dataset.li); l[i.dataset.f] = i.value; setDirty(true); if (['qty', 'rate', 'allowancePct', 'unit', 'rateUnit'].includes(i.dataset.f)) calc(); };
        i.addEventListener('input', h); i.addEventListener('change', h);
      });
      view.querySelectorAll('[data-pi]').forEach((i) => {
        const h = () => { const p = st.percentages.find((x) => x.id === i.dataset.pi); p[i.dataset.f] = i.value; setDirty(true); calc(); };
        i.addEventListener('input', h); i.addEventListener('change', h);
      });
      view.querySelectorAll('[data-pdel]').forEach((b) => (b.onclick = () => { st.percentages = st.percentages.filter((p) => p.id !== b.dataset.pdel); setDirty(true); draw(); }));
      const ap = $('#addPct', view); if (ap) ap.onclick = () => { st.percentages.push({ id: SP.uid(), name: 'New component', pct: '0', basis: 'ITEMS' }); setDirty(true); draw(); };
      view.querySelectorAll('[data-add]').forEach((b) => (b.onclick = () => {
        const c = b.dataset.add; const l = { id: SP.uid(), category: c, name: '', qty: c === 'FABRIC' ? '' : '1', rate: '', allowancePct: c === 'FABRIC' ? Store.db.settings.fabricLossPct : '0', unit: c === 'FABRIC' ? 'kg' : c === 'TRIMS' ? 'pc' : '', rateUnit: c === 'FABRIC' ? 'kg' : c === 'TRIMS' ? 'pc' : '' };
        st.lines.push(l); setDirty(true); draw(); if (c === 'FABRIC') lineDetail(l); else { const i = view.querySelector(`[data-li="${l.id}"][data-f=name]`); i && i.focus(); }
      }));
      view.querySelectorAll('[data-copy]').forEach((b) => (b.onclick = () => copyRows(b.dataset.copy)));
      view.querySelectorAll('tr[data-row]').forEach((tr) => tr.addEventListener('click', (e) => {
        const b = e.target.closest('[data-act]'); if (!b) return;
        const id = tr.dataset.row, l = line(id), same = st.lines.filter((x) => x.category === l.category), idx = st.lines.indexOf(l);
        if (b.dataset.act === 'detail') return lineDetail(l);
        if (b.dataset.act === 'dup') st.lines.splice(idx + 1, 0, Object.assign({}, l, { id: SP.uid(), name: l.name + ' (copy)' }));
        if (b.dataset.act === 'del') st.lines.splice(idx, 1);
        if (b.dataset.act === 'up' || b.dataset.act === 'down') { const k = same.indexOf(l), other = same[k + (b.dataset.act === 'up' ? -1 : 1)]; if (other) { const j = st.lines.indexOf(other); st.lines[idx] = other; st.lines[j] = l; } }
        setDirty(true); draw();
      }));
      const fx = $('#fxBox', view);
      if (fx && editable) {
        $('[name=currency]', fx).onchange = (e) => { st.currency = e.target.value; const r = rates()[0]; st.rateId = r ? r.id : null; st.exchangeRate = r ? r.inrPerUnit : ''; st.rateDate = r ? r.effectiveDate : ''; setDirty(true); draw(); };
        $('[name=rateId]', fx).onchange = (e) => { const r = byId(Store.db, 'rates', e.target.value); st.rateId = r ? r.id : null; if (r) { st.exchangeRate = r.inrPerUnit; st.rateDate = r.effectiveDate; } setDirty(true); draw(); };
        $('[name=exchangeRate]', fx).oninput = (e) => { st.exchangeRate = e.target.value; st.rateId = null; $('[name=rateId]', fx).value = ''; setDirty(true); calc(); };
        $('[name=rateDate]', fx).onchange = (e) => { st.rateDate = e.target.value; setDirty(true); calc(); };
      }
      const n = $('#cNotes', view); if (n) n.oninput = () => { st.notes = n.value; setDirty(true); };
      const save = $('#cSave', view);
      if (save) save.onclick = () => run(save, async () => { await svc.saveCosting(v0.id, st); setDirty(false); toast('Costing saved', 'ok'); App.refresh(); }, view);
      const cancel = $('#cCancel', view);
      if (cancel) cancel.onclick = async () => { if (!dirty || await confirm('Discard unsaved changes?', { ok: 'Discard', danger: true })) { setDirty(false); App.refresh(); } };
      const sa = $('#cSaveAs', view);
      if (sa) sa.onclick = async () => {
        if (dirty && editable) { if (!(await confirm('Save current changes first, then create the new revision?'))) return; await run(sa, async () => { await svc.saveCosting(v0.id, st); setDirty(false); }, view); if (dirty) return; }
        run(sa, async () => { const nv = await svc.saveAsCosting(v0.id); setDirty(false); toast(`${nv.label} created — edit and generate the revised quote`, 'ok'); App.go('costing/edit', { id: nv.id }); }, view);
      };
      const ap2 = $('#cApprove', view);
      if (ap2) ap2.onclick = async () => {
        if (dirty) { toast('Save changes before approving', 'warn'); return; }
        if (await confirm(`Approve <b>${esc(v0.label)}</b>? Approved costing versions are locked permanently.`)) run(ap2, async () => { await svc.approveCosting(v0.id); toast('Approved', 'ok'); App.refresh(); });
      };
      const qb = $('#cQuote', view);
      if (qb) qb.onclick = () => { if (quotes.length) return App.go('quotes', { view: quotes[0].id }); if (dirty) return toast('Save changes before generating a quote', 'warn'); Pages.newQuote(v0.id); };
      $('#cPrint', view).onclick = () => UI.printDoc(`Costing ${style.styleRef} — ${v0.label}`, costingPrintHtml(byId(Store.db, 'costings', v0.id)));
    };
    const lineDetail = (l) => {
      const isF = l.category === 'FABRIC';
      modal({
        title: `${H.catLabel(l.category)} details`, size: 'lg',
        body: form([
          { name: 'name', label: isF ? 'Fabric name' : 'Name', required: true, span: 's6' },
          { name: 'description', label: 'Description', span: 's6' },
          ...(isF ? [{ name: 'composition', label: 'Composition', span: 's4' }, { name: 'gsm', label: 'GSM', span: 's4' }, { name: 'colour', label: 'Colour', span: 's4' }] : []),
          { name: 'qty', label: QTY_LABEL[l.category] || 'Qty / basis', type: 'decimal', span: 's3', help: isF ? 'Weight per piece in the unit below' : 'Default 1' },
          { name: 'unit', label: 'Unit', type: 'select', options: units, span: 's3' },
          { name: 'rate', label: isF ? 'Base rate' : 'Rate', type: 'decimal', required: true, span: 's3' },
          { name: 'rateUnit', label: 'Rate unit', type: 'select', options: units, span: 's3', help: 'Must match the consumption unit' },
          { name: 'allowancePct', label: isF ? 'Loss %' : 'Allowance %', type: 'decimal', span: 's3' },
          { name: 'calc', label: 'Calculated cost / pc', type: 'static', span: 's9', html: '<b id="dAmt">—</b> <span class="small muted">= qty × rate × (1 + %/100)</span>' },
          { name: 'remarks', label: 'Remarks', type: 'textarea', span: 's12' },
        ], l),
        onMount: (m) => {
          const upd = () => { const v = read(m.el); try { if (!Calc.unitsCompatible(v)) throw new Error('Incompatible units'); $('#dAmt', m.el).textContent = Fmt.inr(Calc.lineAmount(v).toString()); } catch (e) { $('#dAmt', m.el).textContent = e.message; } };
          m.el.addEventListener('input', upd); m.el.addEventListener('change', upd); upd();
          if (!editable) $$('input,select,textarea', m.el).forEach((x) => (x.disabled = true));
        },
        actions: editable ? [{ label: 'Cancel' }, { label: 'Apply', cls: 'primary', onClick: (m) => { const v = read(m.el); if (!v.name.trim()) throw new AppError('Name is required', 'name'); delete v.calc; Object.assign(l, v); setDirty(true); draw(); } }] : [{ label: 'Close' }],
      });
    };
    const copyRows = (targetCat) => {
      const versions = Store.db.costings.slice().sort((a, b) => (a.id === v0.id ? -1 : b.id === v0.id ? 1 : 0));
      modal({
        title: `Copy rows into ${H.catLabel(targetCat)}`, size: 'lg',
        body: form([
          { name: 'from', label: 'Copy from costing version', type: 'select', search: true, required: true, span: 's12', options: versions.map((c) => ({ value: c.id, label: `${H.style(c.styleId).styleRef} — ${c.label}${c.id === v0.id ? ' (this version, current edits)' : ''}` })) },
          { name: 'cat', label: 'Source section', type: 'select', options: cats.map((c) => ({ value: c.key, label: c.label })), placeholder: false, span: 's6' },
          { name: 'note', label: '', type: 'html', html: '<div class="help">Rows are copied into this draft so you can edit them. Nothing is saved until you click Save.</div>' },
        ], { from: v0.id, cat: targetCat }),
        actions: [{ label: 'Cancel' }, { label: 'Copy', cls: 'primary', onClick: (m) => {
          const v = read(m.el); if (!v.from) throw new AppError('Select a source', 'from');
          const src = v.from === v0.id ? st.lines : byId(Store.db, 'costings', v.from).lines;
          const rows = src.filter((l) => l.category === v.cat);
          if (!rows.length) throw new AppError('The source section has no rows', 'cat');
          rows.forEach((l) => st.lines.push(Object.assign({}, l, { id: SP.uid(), category: targetCat })));
          setDirty(true); draw(); toast(`${rows.length} row(s) copied — review and save`, 'ok');
        } }],
      });
    };
    draw();
  });
  function costingPrintHtml(v) {
    const r = v.results;
    const style = H.style(v.styleId);
    return `<div class="grid"><div><b>Style:</b> ${esc(style.styleRef)} — ${esc(style.description || '')}</div><div><b>Buyer:</b> ${esc(H.buyer(style.buyerId).name)}</div><div><b>Season:</b> ${esc(style.season)}</div><div><b>Version:</b> ${esc(v.label)} (${esc(v.status)})</div><div><b>Currency:</b> ${esc(v.currency)} @ ₹${Fmt.num(v.exchangeRate, 4)} ${v.rateDate ? '(' + fmtDate(v.rateDate) + ')' : ''}</div><div><b>Formula:</b> ${esc(v.formulaVersion)}</div></div>
      ${H.cats().filter((c) => v.lines.some((l) => l.category === c.key)).map((c) => `<h2>${esc(c.label)}</h2><table><thead><tr><th>Item</th><th>Details</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">%</th><th class="num">Amount</th></tr></thead><tbody>${v.lines.filter((l) => l.category === c.key).map((l) => `<tr><td>${esc(l.name)}</td><td>${esc([l.description, l.composition, l.gsm && l.gsm + ' GSM', l.colour, l.unit].filter(Boolean).join(' · '))}</td><td class="num">${esc(l.qty)}</td><td class="num">${Fmt.num(l.rate)}</td><td class="num">${esc(l.allowancePct)}</td><td class="num">${Fmt.num(r.lineAmounts[l.id])}</td></tr>`).join('')}</tbody><tfoot><tr><td colspan="5">Subtotal</td><td class="num">${Fmt.inr(r.categories[c.key])}</td></tr></tfoot></table>`).join('')}
      <h2>Summary</h2><table><tbody><tr><td>All items total</td><td class="num">${Fmt.inr(r.itemsTotal)}</td></tr>${r.percentages.map((p) => `<tr><td>${esc(p.name)} ${Fmt.pct(p.pct)} (${p.basis === 'ITEMS' ? 'of items' : 'of running total'})</td><td class="num">${Fmt.inr(p.amount)}</td></tr>`).join('')}<tr><td><b>Total INR / pc</b></td><td class="num"><b>${Fmt.inr(r.totalInr)}</b></td></tr><tr><td><b>Price (${esc(v.currency)})</b></td><td class="num"><b>${Fmt.money(r.foreignPrice, v.currency, 4)}</b></td></tr></tbody></table>`;
  }

  /* ======================= QUOTES ======================= */
  App.route('quotes', 'quotes.view', async (view, q) => {
    const f = { from: q.from || '', to: q.to || '' };
    view.innerHTML = pageHead('Quote & Revised Quotes', 'Quotes are generated from saved costing versions. Revisions never change earlier quotes or confirmed order prices.', guard('quotes.edit', btn('New quote', 'id="newQ"', 'primary', 'plus')) + btn('Compare quotes', 'id="cmpQ"')) +
      `<form class="filters" id="qf">${UI.field({ name: 'from', label: 'Quote date from', type: 'date' }, f.from)}${UI.field({ name: 'to', label: 'To', type: 'date' }, f.to)}</form><div class="card"><div class="bd p0" id="qt"></div></div>`;
    $('#qf', view).onchange = () => App.go('quotes', Object.assign({}, q, read($('#qf', view))));
    table($('#qt', view), {
      id: 'quotes', exportName: 'quotes', sort: { key: 'quoteNo', dir: 'desc' },
      rows: () => Store.db.quotes.filter((x) => (!f.from || x.quoteDate >= f.from) && (!f.to || x.quoteDate <= f.to)),
      initialFilters: { buyerId: q.buyer || '', styleId: q.style || '', season: q.season || '' },
      filters: [{ key: 'buyerId', label: 'Buyer', options: H.allBuyerOpts }, { key: 'styleId', label: 'Style', options: () => H.styleOpts(null, true) }, { key: 'season', label: 'Season', options: H.seasonOpts }, { key: 'status', label: 'Status', options: ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'SUPERSEDED'] }],
      columns: [
        { key: 'quoteNo', label: 'Quote ID', render: (r) => `<span class="mono">${esc(r.quoteNo)}</span>` },
        { key: 'label', label: 'Revision', render: (r) => `<b>${esc(r.label)}</b>${testTag(r)}` },
        { key: 'style', label: 'Style', value: (r) => H.style(r.styleId).styleRef },
        { key: 'buyer', label: 'Buyer', value: (r) => H.buyer(r.buyerId).name, hideSm: true }, { key: 'season', label: 'Season', hideSm: true },
        { key: 'costing', label: 'Costing', value: (r) => (byId(Store.db, 'costings', r.costingId) || {}).label, render: (r) => `<a href="#/costing/edit?id=${r.costingId}">${esc((byId(Store.db, 'costings', r.costingId) || {}).label)}</a>`, hideSm: true },
        { key: 'quoteDate', label: 'Date', render: (r) => fmtDate(r.quoteDate) },
        { key: 'rate', label: 'Exchange', num: true, value: (r) => r.exchangeRate, render: (r) => `${esc(r.currency)} @ ${Fmt.num(r.exchangeRate)}`, hideSm: true },
        { key: 'calculatedPrice', label: 'Calculated', num: true, render: (r) => Fmt.money(r.calculatedPrice, r.currency, 4), hideSm: true },
        { key: 'quotedPrice', label: 'Quoted price', num: true, render: (r) => `<b>${Fmt.money(r.quotedPrice, r.currency)}</b>` },
        { key: 'status', label: 'Status', render: (r) => status(r.status) }, { key: 'createdBy', label: 'Created by', hideSm: true },
      ],
      actions: (r) => act('view', '', '', 'eye', false, 'View') + guard('quotes.edit', act('edit', '', '', 'edit', false, 'Edit / status') + act('rev', 'Revise')) + act('print', '', '', 'print', false, 'Print / PDF') + (r.status === 'DRAFT' ? guard('quotes.delete', act('del', '', 'danger', 'trash', false, 'Delete')) : ''),
      on: {
        view: (r) => viewQuote(r), edit: (r) => editQuote(r), print: (r) => printQuote(r),
        rev: async (r) => { if (await confirm(`Create a new costing revision from <b>${esc(r.label)}</b> (${esc(H.style(r.styleId).styleRef)})? Edit the inputs, save, then generate the revised quote. The original quote is preserved.`)) run(null, async () => { const latest = Store.db.costings.filter((c) => c.styleId === r.styleId).sort((a, b) => b.versionNo - a.versionNo)[0]; const nv = await svc.saveAsCosting(latest.id); App.go('costing/edit', { id: nv.id }); }); },
        del: async (r) => { if (await confirm(`Delete draft quote ${esc(r.quoteNo)}?`, { danger: true, ok: 'Delete' })) run(null, async () => { await svc.deleteQuote(r.id); toast('Deleted', 'ok'); }); },
      },
    });
    const nq = $('#newQ', view); if (nq) nq.onclick = () => Pages.newQuote();
    $('#cmpQ', view).onclick = () => compareQuotes(q.style);
    if (q.view) { UI.consume('view'); const x = byId(Store.db, 'quotes', q.view); if (x) viewQuote(x); }
  });
  Pages.newQuote = (costingId) => {
    const all = Store.db.costings.filter((c) => !Store.db.quotes.some((q) => q.costingId === c.id && q.status !== 'REJECTED'));
    const cv = costingId ? byId(Store.db, 'costings', costingId) : null;
    const m = modal({
      title: 'Generate quote', size: 'lg',
      body: form([
        { name: 'costingId', label: 'Costing version', type: 'select', search: true, required: true, span: 's12', options: all.map((c) => ({ value: c.id, label: `${H.style(c.styleId).styleRef} — ${c.label} (${c.status}) — ${Fmt.money(c.results.foreignPrice, c.currency, 4)}` })), help: 'Draft versions are approved (locked) when quoted.' },
        { name: 'info', label: 'Calculated price', type: 'static', span: 's6', html: '<span id="qCalc">—</span>' },
        { name: 'quotedPrice', label: 'Quoted price', type: 'decimal', required: true, span: 's6', help: 'Defaults to the calculated price rounded to 2 dp; may be adjusted' },
        { name: 'quoteDate', label: 'Quote date', type: 'date', required: true, span: 's6' },
        { name: 'remarks', label: 'Remarks', type: 'textarea', span: 's12' },
      ], { costingId: cv && cv.id, quoteDate: SP.today() }),
      actions: [{ label: 'Cancel' }, { label: 'Generate', cls: 'primary', onClick: async (mm) => { const v = read(mm.el); const x = await svc.createQuote(v); toast(`${x.quoteNo} (${x.label}) created`, 'ok'); App.go('quotes', { view: x.id }); } }],
    });
    const upd = () => { const c = byId(Store.db, 'costings', $('[name=costingId]', m.el).value); $('#qCalc', m.el).innerHTML = c ? `${Fmt.money(c.results.foreignPrice, c.currency, 4)} <span class="small muted">(₹${Fmt.num(c.results.totalInr)} ÷ ${Fmt.num(c.exchangeRate, 4)})</span>` : '—'; if (c && c.results.foreignPrice) $('[name=quotedPrice]', m.el).value = D(c.results.foreignPrice).round(2).toString(); };
    $('[name=costingId]', m.el).addEventListener('change', upd); upd();
  };
  function editQuote(r) {
    const locked = r.status !== 'DRAFT';
    modal({
      title: `Edit ${r.quoteNo} — ${r.label}`,
      body: (locked ? '<div class="notice info">Price and date are locked once a quote leaves draft. Create a revised quote to change them.</div>' : '') + form([
        { name: 'quotedPrice', label: `Quoted price (${r.currency})`, type: 'decimal', span: 's6', readonly: locked },
        { name: 'quoteDate', label: 'Quote date', type: 'date', span: 's6', readonly: locked },
        { name: 'status', label: 'Status', type: 'select', options: ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'SUPERSEDED'], placeholder: false, span: 's6' },
        { name: 'remarks', label: 'Remarks', type: 'textarea', span: 's12' },
      ], r),
      actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: async (m) => { const v = read(m.el); if (locked) { delete v.quotedPrice; delete v.quoteDate; } await svc.updateQuote(r.id, v); toast('Quote updated', 'ok'); } }],
    });
  }
  function quoteBreakdown(r) {
    const c = byId(Store.db, 'costings', r.costingId); const res = c.results;
    return `<table class="t"><tbody>${H.cats().filter((k) => !D(res.categories[k.key] || 0).isZero()).map((k) => `<tr><td>${esc(k.label)}</td><td class="num">${Fmt.inr(res.categories[k.key])}</td></tr>`).join('')}
      <tr><td><b>All items total</b></td><td class="num"><b>${Fmt.inr(res.itemsTotal)}</b></td></tr>${res.percentages.map((p) => `<tr><td>${esc(p.name)} (${Fmt.pct(p.pct)})</td><td class="num">${Fmt.inr(p.amount)}</td></tr>`).join('')}
      <tr><td><b>Total INR</b></td><td class="num"><b>${Fmt.inr(res.totalInr)}</b></td></tr><tr><td>Exchange</td><td class="num">${esc(r.currency)} @ ₹${Fmt.num(r.exchangeRate, 4)}</td></tr>
      <tr><td>Calculated price</td><td class="num">${Fmt.money(r.calculatedPrice, r.currency, 4)}</td></tr><tr><td><b>Quoted price</b></td><td class="num"><b>${Fmt.money(r.quotedPrice, r.currency)}</b></td></tr></tbody></table>`;
  }
  function viewQuote(r) {
    const st = H.style(r.styleId);
    const conf = Store.db.lines.filter((l) => l.quoteId === r.id);
    modal({
      title: `${r.quoteNo} — ${r.label}`, size: 'lg',
      body: `<dl class="dl"><dt>Style</dt><dd>${esc(st.styleRef)} — ${esc(st.description || '')}</dd><dt>Buyer / season</dt><dd>${esc(H.buyer(r.buyerId).name)} / ${esc(r.season)}</dd><dt>Costing version</dt><dd><a href="#/costing/edit?id=${r.costingId}">${esc((byId(Store.db, 'costings', r.costingId) || {}).label)}</a></dd><dt>Quote date</dt><dd>${fmtDate(r.quoteDate)}</dd><dt>Status</dt><dd>${status(r.status)}${testTag(r)}</dd><dt>Created by</dt><dd>${esc(r.createdBy)} · ${fmtDT(r.createdAt)}</dd><dt>Remarks</dt><dd>${esc(r.remarks || '—')}</dd><dt>Confirmed orders</dt><dd>${conf.length ? conf.map((l) => `${esc(l.confNo)} @ ${Fmt.money(l.confirmedPrice, l.currency)}`).join(', ') : 'None'}</dd></dl><h3 style="margin:14px 0 6px">Costing breakdown</h3>${quoteBreakdown(r)}`,
      actions: [{ label: 'Close' }, { label: 'Print / PDF', onClick: () => { printQuote(r); return false; } }, { label: 'Compare revisions', onClick: (m) => { m.close(); compareQuotes(r.styleId); return false; } }],
    });
  }
  function printQuote(r) {
    const st = H.style(r.styleId), b = H.buyer(r.buyerId);
    UI.printDoc(`Quotation ${r.quoteNo} — ${r.label}`, `${r.isTest ? '<div class="test">TEST DATA</div>' : ''}<div class="grid"><div><b>Buyer:</b> ${esc(b.name)}</div><div><b>Quote date:</b> ${fmtDate(r.quoteDate)}</div><div><b>Style:</b> ${esc(st.styleRef)}</div><div><b>Season:</b> ${esc(r.season)}</div><div><b>Description:</b> ${esc(st.description || '')}</div><div><b>Size range:</b> ${esc(st.sizeRange || '')}</div><div><b>Status:</b> ${esc(r.status)}</div><div><b>Prepared by:</b> ${esc(r.createdBy)}</div></div>
      ${st.image && st.image.startsWith('data:') ? `<p><img src="${st.image}" style="max-width:160px;max-height:160px;border:1px solid #ccc"></p>` : ''}
      <h2>Price</h2><table><tbody><tr><td>Quoted price per piece</td><td class="num"><b>${Fmt.money(r.quotedPrice, r.currency)}</b></td></tr><tr><td>Currency</td><td class="num">${esc(r.currency)}</td></tr></tbody></table>
      <h2>Internal costing breakdown</h2>${quoteBreakdown(r).replace('class="t"', '')}<p class="muted">Remarks: ${esc(r.remarks || '—')}</p>`);
  }
  function compareQuotes(styleId) {
    const opts = Store.db.quotes.map((x) => ({ value: x.id, label: `${x.quoteNo} ${H.style(x.styleId).styleRef} — ${x.label} (${Fmt.money(x.quotedPrice, x.currency)})` }));
    const sq = Store.db.quotes.filter((x) => !styleId || x.styleId === styleId).sort((a, b) => a.revisionNo - b.revisionNo);
    const m = modal({
      title: 'Compare quotes', size: 'xl',
      body: `<div class="form-grid">${UI.field({ name: 'a', label: 'Original / base quote', type: 'select', search: true, options: opts, span: 's6' }, sq[0] && sq[0].id)}${UI.field({ name: 'b', label: 'Revised quote', type: 'select', search: true, options: opts, span: 's6' }, sq.length > 1 ? sq[sq.length - 1].id : '')}</div><div id="cmpOut" style="margin-top:14px"></div>`,
      actions: [{ label: 'Close' }],
    });
    const draw = () => {
      const a = byId(Store.db, 'quotes', $('[name=a]', m.el).value), b = byId(Store.db, 'quotes', $('[name=b]', m.el).value);
      if (!a || !b) { $('#cmpOut', m.el).innerHTML = '<div class="empty small">Select two quotes</div>'; return; }
      const ca = byId(Store.db, 'costings', a.costingId).results, cb = byId(Store.db, 'costings', b.costingId).results;
      const row = (label, x, y, fmt) => { const d = D(y || 0).sub(x || 0); return `<tr><td>${esc(label)}</td><td class="num">${fmt(x)}</td><td class="num">${fmt(y)}</td><td class="num">${signed(d.toString(), fmt)}</td></tr>`; };
      const inr = (x) => Fmt.inr(x);
      $('#cmpOut', m.el).innerHTML = `<div class="table-wrap"><table class="t"><thead><tr><th>Component</th><th class="num">${esc(a.label)} (${esc(a.quoteNo)})</th><th class="num">${esc(b.label)} (${esc(b.quoteNo)})</th><th class="num">Change</th></tr></thead><tbody>
        ${H.cats().filter((c) => !D(ca.categories[c.key] || 0).isZero() || !D(cb.categories[c.key] || 0).isZero()).map((c) => row(c.label, ca.categories[c.key] || '0', cb.categories[c.key] || '0', inr)).join('')}
        ${row('All items total', ca.itemsTotal, cb.itemsTotal, inr)}${row('Overall % (margin etc.)', ca.pctTotal, cb.pctTotal, inr)}${row('Total INR', ca.totalInr, cb.totalInr, inr)}
        <tr><td>Exchange rate</td><td class="num">${Fmt.num(a.exchangeRate, 4)}</td><td class="num">${Fmt.num(b.exchangeRate, 4)}</td><td class="num">${signed(D(b.exchangeRate).sub(a.exchangeRate).toString(), (x) => Fmt.num(x, 4))}</td></tr>
        ${row('Calculated price', a.calculatedPrice, b.calculatedPrice, (x) => Fmt.money(x, b.currency, 4))}${row('Quoted price', a.quotedPrice, b.quotedPrice, (x) => Fmt.money(x, b.currency))}
        <tr><td>Quote date</td><td class="num">${fmtDate(a.quoteDate)}</td><td class="num">${fmtDate(b.quoteDate)}</td><td></td></tr></tbody></table></div>`;
    };
    m.el.addEventListener('change', draw); draw();
  }
})(window);
