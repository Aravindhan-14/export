// Integration tests: services + persistence + pool engine, using the BGPL-001 dataset (TEST DATA).
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshAdmin, asRole } from './helpers.mjs';

async function seeded() {
  const SP = await freshAdmin();
  const pool = await SP.seedBGPL001();
  return { SP, pool };
}

test('BGPL-001 regression: quantities, shipment values, adjustments', async () => {
  const { SP, pool } = await seeded();
  const r = SP.computePool(SP.Store.db, pool.id);
  assert.equal(r.pool.poolNo, 'BGPL-001');
  assert.equal(r.totals.orderQty, 1040);
  assert.equal(r.totals.shippedQty, 1046);
  assert.deepEqual(r.shipments.foreignByCur, { GBP: '1936.6' });
  assert.equal(r.totals.shipmentInr, '224645.6');
  assert.equal(r.totals.additions, '2300');
  assert.equal(r.totals.deductions, '4500');
  assert.equal(r.totals.inrReceived, '222445.6');
});

test('BGPL-001 regression: expense limits for fabric / application / CMT match the workbook', async () => {
  const { SP, pool } = await seeded();
  const r = SP.computePool(SP.Store.db, pool.id);
  const lim = (style, cat) => r.limits.find((l) => l.styleRef === style && l.category === cat).limit;
  assert.equal(lim('HRT-BABY-001', 'FABRIC'), '21291.18');
  assert.equal(lim('HRT-BABY-002', 'FABRIC'), '37201.95');
  assert.equal(lim('HRT-BABY-001', 'APPLICATION'), '10561.1');
  assert.equal(lim('HRT-BABY-002', 'APPLICATION'), '18433.92');
  assert.equal(lim('HRT-BABY-001', 'CMT'), '12673.32');
  assert.equal(lim('HRT-BABY-002', 'CMT'), '28803');
  const cat = (k) => r.byCat.find((c) => c.category === k);
  assert.equal(cat('FABRIC').limit, '58493.13');
  assert.equal(cat('APPLICATION').limit, '28995.02');
  assert.equal(cat('CMT').limit, '41476.32');
  // Actual expenses = source summary total
  assert.equal(r.totals.totalActual, '174710');
  // Actual-based margin = source "Margin (including OH)"
  assert.equal(r.margins.actualMargin, '47735.6');
});

test('variance is calculated, not hardcoded (override only when explicitly set)', async () => {
  const { SP, pool } = await seeded();
  await SP.svc.setVarianceOverride(pool.id, '', '');
  const r = SP.computePool(SP.Store.db, pool.id);
  assert.equal(r.variance.override, null);
  assert.equal(r.variance.computedPoolPct, '-6.0483'); // simple average of per-style variances
  const fab = r.limits.find((l) => l.styleRef === 'HRT-BABY-001' && l.category === 'FABRIC');
  assert.equal(fab.variancePct, '-6.0483');
  assert.equal(fab.limit, '20834.73'); // 22176 × (1 − 6.0483%)
});

test('quote revisions are preserved (Save As never overwrites)', async () => {
  const { SP } = await seeded();
  const db = SP.Store.db;
  const st = db.styles.find((s) => s.styleRef === 'HRT-BABY-001');
  const versions = db.costings.filter((c) => c.styleId === st.id);
  assert.equal(versions.length, 2);
  const orig = versions.find((v) => v.label === 'Original');
  assert.equal(orig.status, 'APPROVED');
  assert.equal(orig.results.totalInr, '208.46');
  await assert.rejects(SP.svc.saveCosting(orig.id, Object.assign({}, orig, { lines: [] })), /cannot be changed/);
  const quotes = db.quotes.filter((q) => q.styleId === st.id).sort((a, b) => a.revisionNo - b.revisionNo);
  assert.deepEqual(quotes.map((q) => [q.label, q.quotedPrice]), [['Quote', '1.8'], ['Revised Quote 1', '1.67']]);
  // revised quote does not change confirmed order prices
  const lines = db.lines.filter((l) => l.styleId === st.id);
  assert.ok(lines.every((l) => l.confirmedPrice === '1.65'));
});

test('confirmed price history is kept and quoted price is separate', async () => {
  const { SP } = await seeded();
  const l = SP.Store.db.lines.find((x) => x.combo === 'Blue');
  assert.equal(l.quotedPrice, '1.8');
  assert.equal(l.orderQty, 350);
  await SP.svc.saveLine(Object.assign({}, l, { confirmedPrice: '1.70', changeReason: 'Buyer re-negotiated' }));
  const hist = SP.Store.db.priceHistory.filter((h) => h.lineId === l.id);
  assert.deepEqual(hist.map((h) => h.newPrice), ['1.65', '1.7']);
});

test('size-wise totals and manual quantity consistency', async () => {
  const { SP } = await seeded();
  const db = SP.Store.db;
  const l = db.lines.find((x) => x.combo === 'Yellow');
  assert.equal(l.orderQty, 250);
  const blue = db.lines.find((x) => x.combo === 'Blue');
  await assert.rejects(SP.svc.saveLine(Object.assign({}, blue, { qtyMode: 'MANUAL', manualQty: 400 })), /must match/);
});

test('allocation limits: no over-allocation, no duplicate allocation', async () => {
  const { SP, pool } = await seeded();
  const db = SP.Store.db;
  const blue = db.lines.find((x) => x.combo === 'Blue'); // 350 pcs, unallocated
  const yellow = db.lines.find((x) => x.combo === 'Yellow'); // fully allocated to BGPL-001
  const p2 = await SP.svc.createPool({ buyerId: blue.buyerId, season: 'S-27' });
  await assert.rejects(SP.svc.allocate(p2.id, [{ lineId: yellow.id, qty: 1 }]), /only 0 pcs available/);
  await assert.rejects(SP.svc.allocate(p2.id, [{ lineId: blue.id, qty: 351 }]), /only 350 pcs available/);
  await SP.svc.allocate(p2.id, [{ lineId: blue.id, qty: 200 }]);
  await assert.rejects(SP.svc.allocate(p2.id, [{ lineId: blue.id, qty: 10 }]), /already allocated/);
  assert.equal(SP.lineMetrics(SP.Store.db, blue).remainingPool, 150);
  // the same line in the original pool is also limited
  await assert.rejects(SP.svc.allocate(pool.id, [{ lineId: blue.id, qty: 151 }]), /only 150 pcs available/);
  // release returns the qty
  const a = SP.Store.db.allocations.find((x) => x.poolId === p2.id);
  await SP.svc.releaseAllocation(a.id, 'Test release');
  assert.equal(SP.lineMetrics(SP.Store.db, blue).remainingPool, 350);
  assert.equal(SP.Store.db.allocations.find((x) => x.id === a.id).history.length, 2);
});

test('concurrent allocation attempts cannot exceed the available quantity', async () => {
  const { SP } = await seeded();
  const blue = SP.Store.db.lines.find((x) => x.combo === 'Blue');
  const pA = await SP.svc.createPool({ buyerId: blue.buyerId });
  const pB = await SP.svc.createPool({ buyerId: blue.buyerId });
  const results = await Promise.allSettled([
    SP.svc.allocate(pA.id, [{ lineId: blue.id, qty: 300 }]),
    SP.svc.allocate(pB.id, [{ lineId: blue.id, qty: 300 }]),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter((r) => r.status === 'rejected').length, 1);
  assert.equal(SP.lineMetrics(SP.Store.db, blue).allocated, 300);
});

test('stale writer (other tab) is rejected by the revision check', async () => {
  const SP = await freshAdmin();
  const adapter = SP.Store.adapter;
  const stale = SP.clone(adapter._peek());
  const staleRev = stale.meta.rev;
  await SP.svc.saveBuyer({ name: 'Buyer A', currency: 'GBP' });
  stale.meta.rev = staleRev + 1;
  await assert.rejects(adapter.save(stale, staleRev), (e) => e.code === 'CONFLICT');
  // and the store recovers: a conflicting commit reloads and reports a friendly error
  await adapter.save(Object.assign(SP.clone(adapter._peek()), { meta: Object.assign(SP.clone(adapter._peek().meta), { rev: 999 }) }), null);
  await assert.rejects(SP.svc.saveBuyer({ name: 'Buyer B', currency: 'GBP' }), /changed in another window/);
  assert.equal(SP.Store.db.meta.rev, 999);
});

test('shipment rules: reason required for differences, excess policy, duplicates', async () => {
  const { SP } = await seeded();
  const blue = SP.Store.db.lines.find((x) => x.combo === 'Blue');
  const base = { lineId: blue.id, shipmentDate: '2026-10-20', exchangeRate: '116', rateDate: '2026-10-17', isFinal: true, invoiceRef: 'X-1' };
  await assert.rejects(SP.svc.saveShipment(Object.assign({}, base, { shippedQty: 340 })), /reason is required/);
  await assert.rejects(SP.svc.saveShipment(Object.assign({}, base, { shippedQty: 380, differenceReason: 'x' })), /more than the allowed 5%/);
  await SP.svc.saveShipment(Object.assign({}, base, { shippedQty: 100, isFinal: false }));
  await assert.rejects(SP.svc.saveShipment(Object.assign({}, base, { shippedQty: 100, isFinal: false })), /duplicate/);
  const s = SP.Store.db.shipments.find((x) => x.invoiceRef === 'X-1');
  assert.equal(s.foreignValue, '165');
  assert.equal(s.inrValue, '19140');
  assert.equal(s.rateSource, 'MANUAL');
});

test('a new exchange rate never changes old shipments', async () => {
  const { SP, pool } = await seeded();
  await SP.svc.saveRate({ currency: 'GBP', inrPerUnit: '120', effectiveDate: '2026-10-18' });
  const r = SP.computePool(SP.Store.db, pool.id);
  assert.equal(r.totals.shipmentInr, '224645.6');
  const rate = SP.Store.db.rates.find((x) => x.effectiveDate === '2026-10-14');
  await assert.rejects(SP.svc.deleteRate(rate.id), /kept for history/);
});

test('closure is blocked until missing / additional items are decided, then snapshot + lock', async () => {
  const { SP, pool } = await seeded();
  let c = SP.svc.closureChecks(pool.id);
  assert.equal(c.ok, false);
  assert.equal(c.checks.find((x) => x.key === 'missing').ok, false);
  assert.equal(c.checks.find((x) => x.key === 'additional').ok, false);
  await assert.rejects(SP.svc.closePool(pool.id), /Closure blocked/);
  // typing an additional item does not resolve it; a rejected item still blocks
  const items = SP.Store.db.exceptions.filter((x) => x.poolId === pool.id);
  await SP.svc.decideException(items[0].id, 'REJECTED', 'not agreed');
  for (const x of items.slice(1)) await SP.svc.decideException(x.id, 'ACCEPTED', 'ok');
  c = SP.svc.closureChecks(pool.id);
  assert.equal(c.checks.find((x) => x.key === 'missing').ok, false);
  await SP.svc.decideException(items[0].id, 'RESOLVED', 'resolved with buyer');
  c = SP.svc.closureChecks(pool.id);
  assert.deepEqual(c.checks.filter((x) => !x.ok).map((x) => x.key), []);
  const cl = await SP.svc.closePool(pool.id, 'Final');
  assert.equal(cl.snapshot.totals.inrReceived, '222445.6');
  assert.equal(SP.Store.db.pools.find((p) => p.id === pool.id).status, 'CLOSED');
  // closed-pool edit restrictions
  const e = SP.Store.db.expenses.find((x) => x.poolId === pool.id);
  await assert.rejects(SP.svc.saveExpense(Object.assign({}, e, { billAmount: '1' })), /is closed/);
  await assert.rejects(SP.svc.saveAdjustment({ poolId: pool.id, type: 'ADDITION', amount: '1', reason: 'x', date: '2026-10-20' }), /is closed/);
  const yellow = SP.Store.db.lines.find((x) => x.combo === 'Yellow');
  await assert.rejects(SP.svc.saveLine(Object.assign({}, yellow, { confirmedPrice: '9' })), /closed pool/);
  // reopen keeps the previous snapshot
  await SP.svc.reopenPool(pool.id, 'Correction of deduction');
  await SP.svc.saveAdjustment({ poolId: pool.id, type: 'DEDUCTION', amount: '100', reason: 'Correction', date: '2026-10-20' });
  const cl2 = await SP.svc.closePool(pool.id, 'Corrected');
  assert.equal(cl2.version, 2);
  const all = SP.Store.db.closures.filter((x) => x.poolId === pool.id);
  assert.deepEqual(all.map((x) => x.status), ['SUPERSEDED', 'ACTIVE']);
  assert.equal(all[0].snapshot.totals.inrReceived, '222445.6');
  assert.equal(all[1].snapshot.totals.inrReceived, '222345.6');
  assert.ok(SP.Store.db.audit.some((a) => a.action === 'REOPEN'));
});

test('CRUD permissions are enforced in the service layer', async () => {
  const { SP, pool } = await seeded();
  const back = await asRole(SP, 'MANAGEMENT', 'mgmt@test.local');
  await assert.rejects(SP.svc.saveBuyer({ name: 'X', currency: 'GBP' }), /permission/);
  await assert.rejects(SP.svc.saveExpense({ poolId: pool.id }), /permission/);
  await assert.rejects(SP.svc.closePool(pool.id), /permission/);
  back();
  const back2 = await asRole(SP, 'EXPENSE', 'exp@test.local');
  await assert.rejects(SP.svc.saveShipment({}), /permission/);
  await assert.rejects(SP.svc.decideException(SP.Store.db.exceptions[0].id, 'ACCEPTED'), /permission/);
  back2();
});

test('referenced records cannot be hard-deleted', async () => {
  const { SP } = await seeded();
  const db = SP.Store.db;
  const buyer = db.buyers.find((b) => b.isTest);
  await assert.rejects(SP.svc.deleteBuyer(buyer.id), /Deactivate/);
  const st = db.styles[0];
  await assert.rejects(SP.svc.deleteStyle(st.id), /Archive/);
  const yellow = db.lines.find((x) => x.combo === 'Yellow');
  await assert.rejects(SP.svc.deleteLine(yellow.id), /cannot be deleted/);
});

test('CSV import validates everything and is all-or-nothing', async () => {
  const { SP } = await seeded();
  const before = SP.Store.db.buyers.length;
  const bad = 'name,currency,email\nGood Buyer,GBP,a@b.co\nBad Buyer,XXX,a@b.co\n';
  const r = await SP.svc.importCsv('buyers', bad);
  assert.equal(r.imported, 0);
  assert.equal(r.errors[0].row, 3);
  assert.equal(SP.Store.db.buyers.length, before);
  const ok = await SP.svc.importCsv('buyers', 'name,currency\nNew Buyer 1,GBP\n"New, Buyer 2",USD\n');
  assert.equal(ok.imported, 2);
  assert.ok(SP.Store.db.buyers.some((b) => b.name === 'New, Buyer 2'));
});

test('test data can be removed cleanly', async () => {
  const { SP } = await seeded();
  await SP.svc.removeTestData();
  const db = SP.Store.db;
  for (const k of ['buyers', 'styles', 'costings', 'quotes', 'pos', 'lines', 'pools', 'allocations', 'expenses', 'shipments', 'exceptions', 'adjustments']) assert.equal(db[k].length, 0, k);
});
