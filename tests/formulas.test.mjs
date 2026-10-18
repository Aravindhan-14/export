// Unit tests for the pure formulas (core.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './helpers.mjs';

const { D, Calc } = load();

test('decimal arithmetic is exact (no floating point drift)', () => {
  assert.equal(D('0.1').add('0.2').toString(), '0.3');
  assert.equal(D('1.65').mul(248).toString(), '409.2');
  assert.equal(D('14.175').round(2).toString(), '14.18');
  assert.equal(D('-14.175').round(2).toString(), '-14.18');
  assert.equal(D('2').div(3).round(4).toString(), '0.6667');
  assert.throws(() => D('abc'));
  assert.throws(() => D(1).div(0));
});

test('expected quantity = qty per combo × number of combos', () => {
  assert.equal(Calc.expectedQty(250, 4), 1000);
  assert.equal(Calc.expectedQty(0, 4), 0);
  assert.throws(() => Calc.expectedQty(2.5, 4));
  assert.throws(() => Calc.expectedQty(-1, 4));
});

test('fabric cost = consumption × rate × (1 + loss%) — workbook rows', () => {
  const f = (qty, rate) => Calc.lineAmount({ qty, rate, allowancePct: '5' }).toString();
  assert.equal(f('0.080', '500'), '42');
  assert.equal(f('0.010', '500'), '5.25');
  assert.equal(f('0.006', '500'), '3.15');
  assert.equal(f('0.090', '500'), '47.25');
  assert.equal(f('0.030', '450'), '14.18'); // 14.175 rounded half-up
  assert.equal(f('0.150', '500'), '78.75');
  assert.throws(() => Calc.lineAmount({ qty: '-1', rate: '5' }));
});

test('incompatible units are rejected', () => {
  const r = Calc.costing({ exchangeRate: '115', lines: [{ category: 'FABRIC', qty: '1', rate: '100', unit: 'kg', rateUnit: 'm' }], percentages: [] });
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /incompatible/);
});

const style001 = {
  currency: 'GBP', exchangeRate: '115',
  lines: [
    { category: 'FABRIC', qty: '0.080', rate: '500', allowancePct: '5' }, { category: 'FABRIC', qty: '0.010', rate: '500', allowancePct: '5' }, { category: 'FABRIC', qty: '0.006', rate: '500', allowancePct: '5' },
    { category: 'APPLICATION', qty: '1', rate: '10' }, { category: 'APPLICATION', qty: '1', rate: '15' }, { category: 'OTHERS', qty: '1', rate: '8' },
    { category: 'TRIMS', qty: '1', rate: '8' }, { category: 'TRIMS', qty: '6', rate: '0.75' }, { category: 'TRIMS', qty: '1', rate: '5' },
    { category: 'CMT', qty: '1', rate: '30' }, { category: 'LABELLING', qty: '1', rate: '10' }, { category: 'PACKING_ACC', qty: '1', rate: '5' }, { category: 'FORWARDING', qty: '1', rate: '3' },
  ],
  percentages: [{ name: 'REJ+OH+COMM+MARGIN', pct: '40', basis: 'ITEMS' }],
};

test('category totals and item total (HRT-BABY-001 = 148.90)', () => {
  const r = Calc.costing(style001);
  assert.deepEqual(r.errors, []);
  assert.equal(r.categories.FABRIC, '50.4');
  assert.equal(r.categories.APPLICATION, '25');
  assert.equal(r.categories.TRIMS, '17.5');
  assert.equal(r.itemsTotal, '148.9');
});

test('overall percentage and currency conversion (208.46 → £1.8127)', () => {
  const r = Calc.costing(style001);
  assert.equal(r.pctTotal, '59.56');
  assert.equal(r.totalInr, '208.46');
  assert.equal(r.foreignPrice, '1.8127');
  assert.equal(Calc.toForeign('237.41', '115').round(2).toString(), '2.06');
});

test('percentage components can use different bases', () => {
  const v = { exchangeRate: '100', lines: [{ category: 'CMT', qty: '1', rate: '100' }], percentages: [{ name: 'Rejection', pct: '10', basis: 'ITEMS' }, { name: 'Margin', pct: '10', basis: 'CUMULATIVE' }] };
  const r = Calc.costing(v);
  assert.equal(r.percentages[0].amount, '10');
  assert.equal(r.percentages[1].amount, '11'); // 10% of 110
  assert.equal(r.totalInr, '121');
});

test('shipment value and INR conversion (source rows)', () => {
  assert.deepEqual(Calc.shipmentValues(248, '1.65', '116'), { foreign: '409.2', inr: '47467.2' });
  assert.deepEqual(Calc.shipmentValues(196, '1.65', '116'), { foreign: '323.4', inr: '37514.4' });
  assert.deepEqual(Calc.shipmentValues(290, '2.00', '116'), { foreign: '580', inr: '67280' });
  assert.deepEqual(Calc.shipmentValues(312, '2.00', '116'), { foreign: '624', inr: '72384' });
  assert.throws(() => Calc.shipmentValues(1, '1', '0'));
});

test('shipment quantity difference = shipped − ordered', () => {
  assert.equal(Calc.qtyDifference(248, 250), -2);
  assert.equal(Calc.qtyDifference(196, 190), 6);
  assert.equal(Calc.qtyDifference(290, 290), 0);
});

test('additions and deductions (224,645.60 + 2,300 − 4,500 = 222,445.60)', () => {
  assert.equal(Calc.adjustedInr('224645.6', '2300', '4500').toString(), '222445.6');
});

test('expense limit with variance — source fabric / application / CMT rows', () => {
  assert.equal(Calc.expenseLimit(440, '50.40', '-3.99').toString(), '21291.18');
  assert.equal(Calc.expenseLimit(600, '64.58', '-3.99').toString(), '37201.95');
  assert.equal(Calc.expenseLimit(440, '25', '-3.99').toString(), '10561.1');
  assert.equal(Calc.expenseLimit(600, '32', '-3.99').toString(), '18433.92');
  assert.equal(Calc.expenseLimit(440, '30', '-3.99').toString(), '12673.32');
  assert.equal(Calc.expenseLimit(600, '50', '-3.99').toString(), '28803');
  assert.equal(Calc.expenseLimit(600, '50', '-3.99', false).toString(), '30000');
});

test('expense difference sign convention: Limit − Actual (positive = under limit)', () => {
  assert.deepEqual(Calc.expenseDifference('58493.13', '60500'), { diff: '-2006.87', pct: '-3.43', status: 'OVER' });
  assert.equal(Calc.expenseDifference('28995.02', '17500').status, 'UNDER');
  assert.equal(Calc.expenseDifference('100', '100').status, 'EQUAL');
});

test('style variance and aggregation methods', () => {
  const a = Calc.styleVariancePct('1.65', '115', '208.46');
  const b = Calc.styleVariancePct('2.00', '115', '237.41');
  assert.equal(a.toString(), '-8.9753');
  assert.equal(b.toString(), '-3.1212');
  const rows = [{ pct: a, qty: 440, value: '726' }, { pct: b, qty: 600, value: '1200' }];
  assert.equal(Calc.aggregateVariance(rows, 'SIMPLE_AVG').toString(), '-6.0483');
  assert.equal(Calc.aggregateVariance(rows, 'QTY_WEIGHTED').toString(), '-5.5979');
  assert.equal(Calc.aggregateVariance(rows, 'VALUE_WEIGHTED').toString(), '-5.3279');
});

test('margins using the source summary figures (limits ₹160,014.47, actual ₹174,710)', () => {
  const m = Calc.margins({ inrReceived: '222445.6', totalLimits: '160014.47', totalActual: '174710' });
  assert.equal(m.actualMargin, '47735.6');   // source "Margin (including OH) 47,736"
  assert.equal(m.budgetMargin, '62431.13');
  assert.equal(m.actualMarginPct, '21.46');
});
