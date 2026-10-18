/* ==========================================================================
   seed.js — BGPL-001 regression / demo dataset, transcribed from the Sports Pro
   source PDFs. Every record is flagged isTest and named "(TEST DATA)". It is
   created through the normal services (so all validation applies) and can be
   removed from Settings → Data. It is never loaded automatically.
   ========================================================================== */
(function (G) {
  'use strict';
  const { svc, Store } = G.SP;

  const L = (category, name, qty, rate, extra) => Object.assign({ category, name, qty: String(qty), rate: String(rate), allowancePct: '0' }, extra || {});
  const F = (name, qty, rate, extra) => L('FABRIC', name, qty, rate, Object.assign({ unit: 'kg', rateUnit: 'kg', allowancePct: '5', composition: '100% Cotton', gsm: '160' }, extra || {}));

  async function seedBGPL001() {
    const db = () => Store.db;
    if (db().buyers.some((b) => b.isTest)) throw new G.SP.AppError('Test data is already loaded. Remove it first (Settings → Data).');
    if (!db().currencies.some((c) => c.code === 'GBP')) await svc.saveCurrency({ code: 'GBP', name: 'Pound Sterling' });

    // Exchange rates used in the source (costing @115, shipments @116 on 14–17 Oct 2026)
    const rate = async (d, v) => (db().rates.find((r) => r.currency === 'GBP' && r.effectiveDate === d) || (await svc.saveRate({ currency: 'GBP', inrPerUnit: v, effectiveDate: d, source: 'TEST DATA — BGPL-001 source sheet', isTest: true })));
    const r115 = await rate('2026-05-25', '115');
    const ship = {};
    for (const d of ['2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17']) ship[d] = await rate(d, '116');

    const buyer = await svc.saveBuyer({ name: 'SPORTS PRO (TEST DATA)', contact: 'Test contact', country: 'United Kingdom', currency: 'GBP', notes: 'Regression dataset from BGPL-001 source PDFs. Not real business data.', isTest: true });

    const s1 = await svc.saveStyle({ buyerId: buyer.id, season: 'S-27', styleRef: 'HRT-BABY-001', description: 'HEARTS BABY T-SHIRT (Babies T Shirt)', productType: 'T-Shirt', sizeRange: '0M - 24M', sizes: ['0-6M', '6-12M', '12-18M', '2-3Y'], qtyPerCombo: 250, combos: 4, quoteDate: '2026-05-25', status: 'ACTIVE', remarks: 'TEST DATA', isTest: true });
    const s2 = await svc.saveStyle({ buyerId: buyer.id, season: 'S-27', styleRef: 'HRT-BABY-002', description: 'HEARTS BABY POLO (Babies Polo)', productType: 'Polo', sizeRange: '3M - 24M', sizes: ['0-6M', '6-12M', '12-18M', '2-3Y'], qtyPerCombo: 250, combos: 1, quoteDate: '2026-05-25', status: 'ACTIVE', remarks: 'TEST DATA', isTest: true });

    const pcts = [{ name: 'REJ + OH + COMM + MARGIN', pct: '40', basis: 'ITEMS' }];
    const base = { currency: 'GBP', exchangeRate: '115', rateDate: '2026-05-25', rateId: r115.id, percentages: pcts };

    // HRT-BABY-001 costing (workbook: items 148.90, +40% = 208.46, /115 = £1.81)
    const c1 = await svc.newCosting(s1.id);
    await svc.saveCosting(c1.id, Object.assign({}, base, { lines: [
      F('100% Cotton Jersey 160GSM', '0.080', '500', { description: 'Body' }),
      F('Lycra Rib', '0.010', '500', { composition: 'Cotton Lycra', gsm: '' }),
      F('100% Cotton Jersey 160GSM', '0.006', '500', { description: 'Trim panel' }),
      L('APPLICATION', 'Print', 1, 10), L('APPLICATION', 'Embroidery', 1, 15),
      L('OTHERS', 'Bit wash', 1, 8),
      L('TRIMS', 'Snap', 1, 8, { unit: 'pc', rateUnit: 'pc' }), L('TRIMS', 'Plastic 4 hole button', 6, '0.75', { unit: 'pc', rateUnit: 'pc' }), L('TRIMS', 'Rope', 1, 5, { unit: 'pc', rateUnit: 'pc' }),
      L('CMT', 'Cut to pack', 1, 30),
      L('LABELLING', 'Label, Tag', 1, 10), L('PACKING_ACC', 'Pack Acc', 1, 5), L('FORWARDING', 'Forwarding', 1, 3),
    ], notes: 'TEST DATA — transcribed from source costing sheet' }));
    // HRT-BABY-002 costing (workbook: items 169.58, +40% = 237.41, /115 = £2.06)
    const c2 = await svc.newCosting(s2.id);
    await svc.saveCosting(c2.id, Object.assign({}, base, { lines: [
      F('100% Cotton Jersey 160GSM', '0.090', '500'),
      F('Collar yarn', '0.030', '450', { composition: 'Cotton yarn', gsm: '' }),
      F('100% Cotton Jersey 160GSM', '0.006', '500', { description: 'Trim panel' }),
      L('APPLICATION', 'Print + Badge + Sticker', 1, 32),
      L('TRIMS', 'Button', 1, 5, { unit: 'pc', rateUnit: 'pc' }),
      L('CMT', 'Cut to pack', 1, 50),
      L('LABELLING', 'Label, Tag', 1, 10), L('PACKING_ACC', 'Pack Acc', 1, 5), L('FORWARDING', 'Forwarding', 1, 3),
    ], notes: 'TEST DATA — transcribed from source costing sheet' }));

    const q1 = await svc.createQuote({ costingId: c1.id, quoteDate: '2026-05-25', quotedPrice: '1.80', remarks: 'TEST DATA', isTest: true });
    const q2 = await svc.createQuote({ costingId: c2.id, quoteDate: '2026-05-25', quotedPrice: '2.06', remarks: 'TEST DATA', isTest: true });
    await svc.updateQuote(q1.id, { status: 'ACCEPTED' });
    await svc.updateQuote(q2.id, { status: 'ACCEPTED' });

    // Revised 1 for HRT-BABY-001 (source shows £1.67; its sub-totals do not reconcile, so it is illustrative only)
    const r1 = await svc.saveAsCosting(c1.id);
    const rv = Store.db.costings.find((c) => c.id === r1.id);
    await svc.saveCosting(r1.id, Object.assign({}, base, { exchangeRate: '116', rateDate: '2026-10-14', rateId: null, lines: rv.lines.map((l) => {
      const x = Object.assign({}, l);
      if (x.category === 'FABRIC') x.rate = '450';
      if (x.name === 'Print') x.rate = '7';
      if (x.name === 'Plastic 4 hole button') { x.name = 'Wooden button'; x.qty = '1'; x.rate = '6.30'; }
      if (x.category === 'CMT') x.rate = '28';
      return x;
    }), notes: 'TEST DATA — Revised 1 (illustrative)' }));
    await svc.createQuote({ costingId: r1.id, quoteDate: '2026-06-10', quotedPrice: '1.67', remarks: 'TEST DATA — revised quote', isTest: true });

    // POs and confirmations (PO 3532 / PO 4246, size-wise from the source)
    const po1 = await svc.savePO({ buyerId: buyer.id, poNumber: 'PO 3532', season: 'S-27', poDate: '2026-06-15', status: 'OPEN', remarks: 'TEST DATA', isTest: true });
    const po2 = await svc.savePO({ buyerId: buyer.id, poNumber: 'PO 4246', season: 'S-27', poDate: '2026-06-20', status: 'OPEN', remarks: 'TEST DATA', isTest: true });
    const sz = (a, b, c, d) => ({ '0-6M': a, '6-12M': b, '12-18M': c, '2-3Y': d });
    const line = (po, st, q, combo, sizes, price) => svc.saveLine({ poId: po.id, styleId: st.id, quoteId: q.id, combo, qtyMode: 'SIZE', sizes, confirmedPrice: price, currency: 'GBP', confirmationDate: '2026-06-25', status: 'CONFIRMED', remarks: 'TEST DATA', isTest: true });
    const l1 = await line(po1, s1, q1, 'Yellow', sz(50, 65, 65, 70), '1.65');
    const l2 = await line(po1, s1, q1, 'Brown', sz(60, 60, 40, 30), '1.65');
    const l3 = await line(po1, s2, q2, 'Green', sz(55, 65, 85, 85), '2.00');
    await line(po2, s1, q1, 'Blue', sz(150, 65, 65, 70), '1.65'); // not pooled in BGPL-001
    const l5 = await line(po2, s2, q2, 'Brown', sz(50, 105, 85, 70), '2.00');

    const pool = await svc.createPool({ buyerId: buyer.id, season: 'S-27', remarks: 'TEST DATA — BGPL-001 regression pool', isTest: true });
    await svc.allocate(pool.id, [{ lineId: l1.id, qty: 250 }, { lineId: l2.id, qty: 190 }, { lineId: l3.id, qty: 290 }, { lineId: l5.id, qty: 310 }]);
    await svc.activatePool(pool.id);
    await svc.setVarianceOverride(pool.id, '-3.99', 'Source workbook value for BGPL-001 (TEST DATA). Aggregation method pending client confirmation.');

    // Expenses — category totals equal the source "Fetch from Expenses (BGPL-001)" summary (₹174,710)
    const E = (o) => svc.saveExpense(Object.assign({ poolId: pool.id, status: 'SAVED', remarks: 'TEST DATA', isTest: true }, o));
    await E({ styleId: s2.id, category: 'FABRIC', source: 'COSTING', itemName: '100% Cotton Jersey 160GSM', colour: 'Green', spec: '100% Cotton Jersey 160GSM', qty: '110', unit: 'kg', rate: '550', vendor: 'Test fabric mill', billRef: 'T-FAB-01', billDate: '2026-07-10' });
    await E({ styleId: s1.id, category: 'APPLICATION', source: 'COSTING', itemName: 'Print', qty: '300', rate: '15', vendor: 'Anwita prints', billRef: 'T-APP-01', billDate: '2026-07-20' });
    await E({ styleId: s2.id, category: 'APPLICATION', source: 'COSTING', itemName: 'Badge', qty: '450', rate: '30', billAmount: '13000', vendor: 'ABC', billRef: 'T-APP-02', billDate: '2026-07-21' });
    await E({ styleId: s1.id, category: 'CMT', source: 'COSTING', itemName: 'Cut to pack', qty: '440', rate: '30', billAmount: '21000', factory: 'In-house unit', sourcing: 'INHOUSE', billRef: 'T-CMT-01', billDate: '2026-08-05' });
    await E({ styleId: s2.id, category: 'CMT', source: 'COSTING', itemName: 'Cut to pack', qty: '600', rate: '50', billAmount: '44000', factory: 'Outsource unit', sourcing: 'OUTSOURCED', billRef: 'T-CMT-02', billDate: '2026-08-06' });
    await E({ styleId: null, category: 'TRIMS', source: 'MANUAL', itemName: 'Trims (all styles)', qty: '1', rate: '0', billAmount: '15000', vendor: 'Test trims supplier', billRef: 'T-TRM-01' });
    await E({ styleId: null, category: 'LABELLING', source: 'MANUAL', itemName: 'Labelling (all styles)', qty: '1', rate: '0', billAmount: '4200', vendor: 'Test label supplier', billRef: 'T-LBL-01' });
    await E({ styleId: null, category: 'PACKING_ACC', source: 'MANUAL', itemName: 'Packaging (all styles)', qty: '1', rate: '0', billAmount: '3360', vendor: 'Test packaging supplier', billRef: 'T-PKG-01' });
    await E({ styleId: null, category: 'FORWARDING', source: 'MANUAL', itemName: 'Forwarding', qty: '1', rate: '0', billAmount: '5500', vendor: 'Test forwarder', billRef: 'T-FRW-01' });
    await E({ styleId: null, category: 'OTHERS', source: 'MANUAL', itemName: 'Others (bit wash etc.)', qty: '1', rate: '0', billAmount: '3650', vendor: 'Test vendor', billRef: 'T-OTH-01' });

    // Shipments (source: 248 / 196 / 290 / 312 @ ₹116)
    const S = (l, qty, rd, reason, inv) => svc.saveShipment({ poolId: pool.id, lineId: l.id, shippedQty: qty, shipmentDate: '2026-10-13', exchangeRate: '116', rateDate: rd, rateId: ship[rd].id, isFinal: true, differenceReason: reason, invoiceRef: inv, remarks: 'TEST DATA', isTest: true });
    await S(l1, 248, '2026-10-14', 'Shortage 2 pcs (source note says "Shortage 4 pc")', 'TEST-INV-01');
    await S(l2, 196, '2026-10-15', 'Excess 6 pcs', 'TEST-INV-02');
    await S(l3, 290, '2026-10-16', '', 'TEST-INV-03');
    await S(l5, 312, '2026-10-17', 'Excess 2 pcs (reason not stated in source)', 'TEST-INV-04');

    await svc.saveAdjustment({ poolId: pool.id, type: 'ADDITION', amount: '2300', reason: 'TEST DATA — addition from source (reason not stated)', date: '2026-10-17', isTest: true });
    await svc.saveAdjustment({ poolId: pool.id, type: 'DEDUCTION', amount: '4500', reason: 'TEST DATA — deduction from source (reason not stated)', date: '2026-10-17', isTest: true });

    // Missing / additional items (left PENDING so the closure checklist shows them)
    const X = (o) => svc.saveException(Object.assign({ poolId: pool.id, date: '2026-10-10', remarks: 'TEST DATA', isTest: true }, o));
    const mLycra = await X({ type: 'MISSING', styleId: s1.id, category: 'FABRIC', itemName: 'Lycra Rib', reason: 'Fabric changed' });
    await X({ type: 'MISSING', styleId: s1.id, category: 'APPLICATION', itemName: 'Embroidery', reason: 'Changed to Print' });
    const mRope = await X({ type: 'MISSING', styleId: s1.id, category: 'TRIMS', itemName: 'Rope', reason: 'Elastic added' });
    await X({ type: 'MISSING', styleId: s2.id, category: 'APPLICATION', itemName: 'Sticker print', reason: 'Cancelled' });
    const mLabel = await X({ type: 'MISSING', styleId: s2.id, category: 'LABELLING', itemName: 'Woven Label', reason: 'Changed to neck print' });
    await X({ type: 'ADDITIONAL', styleId: s1.id, category: 'FABRIC', itemName: 'Woven poplin', reason: 'Lycra rib changed to woven poplin', replacesId: mLycra.id });
    await X({ type: 'ADDITIONAL', styleId: s1.id, category: 'TRIMS', itemName: 'Elastic', reason: 'Added before confirmation', replacesId: mRope.id });
    await X({ type: 'ADDITIONAL', styleId: s2.id, category: 'TRIMS', itemName: 'Buttons', reason: 'Buttons added in the style' });
    await X({ type: 'ADDITIONAL', styleId: s2.id, category: 'APPLICATION', itemName: 'Neck print', reason: 'Woven label changed to neck print', replacesId: mLabel.id });

    return pool;
  }

  G.SP.seedBGPL001 = seedBGPL001;
})(typeof window !== 'undefined' ? window : globalThis);
