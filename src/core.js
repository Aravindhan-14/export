/* ==========================================================================
   core.js — exact decimal arithmetic + all business formulas (pure, no DOM).
   Runs in the browser and in Node (tests). Every financial calculation in the
   app goes through these functions so that UI, reports and closure agree.
   ========================================================================== */
(function (G) {
  'use strict';

  /* ---------- Exact decimal (BigInt fixed-point, 10 fractional digits) ---------- */
  const SCD = 10;
  const SC = 10n ** 10n;

  // Integer division rounded half away from zero.
  function divr(n, d) {
    if (d === 0n) throw new Error('Division by zero');
    const neg = (n < 0n) !== (d < 0n);
    const a = n < 0n ? -n : n;
    const b = d < 0n ? -d : d;
    let q = a / b;
    if ((a % b) * 2n >= b) q += 1n;
    return neg ? -q : q;
  }

  class Dec {
    constructor(v) { this.v = v; }
    static of(x) {
      if (x instanceof Dec) return x;
      if (x === null || x === undefined || x === '') return new Dec(0n);
      if (typeof x === 'bigint') return new Dec(x * SC);
      let s;
      if (typeof x === 'number') {
        if (!Number.isFinite(x)) throw new Error('Invalid number');
        s = x.toFixed(SCD + 1);
      } else s = String(x).trim().replace(/,/g, '');
      if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) throw new Error('Invalid number: ' + x);
      const neg = s[0] === '-';
      s = s.replace(/^[-+]/, '');
      const parts = s.split('.');
      const f = ((parts[1] || '') + '0'.repeat(SCD + 1)).slice(0, SCD + 1);
      let v = BigInt(parts[0] || '0') * SC + BigInt(f.slice(0, SCD));
      if (+f[SCD] >= 5) v += 1n;
      return new Dec(neg ? -v : v);
    }
    static valid(x) { try { Dec.of(x); return true; } catch (e) { return false; } }
    add(o) { return new Dec(this.v + Dec.of(o).v); }
    sub(o) { return new Dec(this.v - Dec.of(o).v); }
    mul(o) { return new Dec(divr(this.v * Dec.of(o).v, SC)); }
    div(o) { const b = Dec.of(o); if (b.v === 0n) throw new Error('Division by zero'); return new Dec(divr(this.v * SC, b.v)); }
    pct(p) { return this.mul(Dec.of(p)).div(100); }               // this × p / 100
    round(dp = 2) { const f = 10n ** BigInt(SCD - dp); return new Dec(divr(this.v, f) * f); }
    neg() { return new Dec(-this.v); }
    abs() { return new Dec(this.v < 0n ? -this.v : this.v); }
    cmp(o) { const b = Dec.of(o).v; return this.v < b ? -1 : this.v > b ? 1 : 0; }
    eq(o) { return this.cmp(o) === 0; }
    gt(o) { return this.cmp(o) > 0; }
    lt(o) { return this.cmp(o) < 0; }
    gte(o) { return this.cmp(o) >= 0; }
    lte(o) { return this.cmp(o) <= 0; }
    isZero() { return this.v === 0n; }
    isNeg() { return this.v < 0n; }
    sign() { return this.v === 0n ? 0 : this.v < 0n ? -1 : 1; }
    toFixed(dp = 2) {
      const r = this.round(dp).v;
      const neg = r < 0n;
      let s = (neg ? -r : r).toString().padStart(SCD + 1, '0');
      const i = s.slice(0, s.length - SCD);
      const f = s.slice(s.length - SCD, s.length - SCD + dp);
      return (neg && /[1-9]/.test(i + f) ? '-' : '') + i + (dp > 0 ? '.' + f : '');
    }
    // canonical storage string (trailing zeros trimmed)
    toString() {
      let s = this.toFixed(SCD);
      if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
      return s === '-0' ? '0' : s;
    }
    toNumber() { return Number(this.toFixed(SCD)); }
  }
  const D = (x) => Dec.of(x);
  const sum = (arr, f) => arr.reduce((a, x) => a.add(f ? f(x) : x), D(0));

  /* ---------- Rounding rules (documented in README / Settings) ----------
     • Money (INR and foreign line values): 2 dp, half away from zero, rounded per line.
     • Costing row amounts: 2 dp per row (workbook: 0.030×450×1.05 = 14.175 → 14.18).
     • Foreign unit price from costing: 4 dp (displayed 2 dp); quoted price entered/rounded to 2 dp.
     • Percentages (variance): 4 dp.
     • Exchange rates: up to 4 dp.                                          */
  const RULES = { money: 2, price: 4, pct: 4, rate: 4 };

  const BASE_CATEGORIES = [
    { key: 'FABRIC', label: 'Fabric' },
    { key: 'APPLICATION', label: 'Application' },
    { key: 'OTHERS', label: 'Others' },
    { key: 'CMT', label: 'CMT' },
    { key: 'TRIMS', label: 'Trims' },
    { key: 'LABELLING', label: 'Labelling' },
    { key: 'PACKING_ACC', label: 'Packing Accessories' },
    { key: 'PACKAGING', label: 'Packaging' },
    { key: 'FORWARDING', label: 'Forwarding' },
    { key: 'BANK', label: 'Bank Charges' },
  ];

  const Calc = {
    FORMULA_VERSION: 'SP-COST-1.0',

    /** Expected Qty = Expected Qty per Combo × Expected Number of Combos */
    expectedQty(perCombo, combos) {
      const a = Number(perCombo || 0), b = Number(combos || 0);
      if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) throw new Error('Quantities must be whole numbers ≥ 0');
      return a * b;
    },

    /** Costing row: Amount/pc = Qty (consumption) × Rate × (1 + Allowance% / 100), rounded 2 dp.
        Fabric allowance defaults to the workbook loss of 5% (verified on every fabric row). */
    lineAmount(line) {
      const qty = D(line.qty === '' || line.qty == null ? 1 : line.qty);
      const rate = D(line.rate);
      const allow = D(line.allowancePct || 0);
      if (qty.isNeg() || rate.isNeg() || allow.isNeg()) throw new Error('Consumption, rate and allowance must not be negative');
      return qty.mul(rate).mul(D(1).add(allow.div(100))).round(RULES.money);
    },

    /** Validate unit compatibility: consumption unit must equal rate unit. */
    unitsCompatible(line) {
      if (!line.unit || !line.rateUnit) return true;
      return String(line.unit).toLowerCase() === String(line.rateUnit).toLowerCase();
    },

    /** Full costing breakdown.
        Total INR = All Items Total + Overall % amount;  Foreign price = Total INR / INR per unit.
        Percentage component basis: 'ITEMS' → % of items total (workbook: 148.90 × 40% = 59.56 → 208.46);
        'CUMULATIVE' → % of running total (items + previous components). */
    costing(version, categories) {
      const cats = {};
      (categories || BASE_CATEGORIES).forEach((c) => (cats[c.key] = D(0)));
      const errors = [];
      const lines = (version.lines || []).map((l, i) => {
        let amount = D(0);
        try {
          if (!Calc.unitsCompatible(l)) throw new Error(`Row ${i + 1} (${l.name || l.category}): consumption unit "${l.unit}" and rate unit "${l.rateUnit}" are incompatible`);
          amount = Calc.lineAmount(l);
        } catch (e) { errors.push(e.message); }
        if (!(l.category in cats)) cats[l.category] = D(0);
        cats[l.category] = cats[l.category].add(amount);
        return Object.assign({}, l, { amount: amount.toString() });
      });
      const itemsTotal = sum(Object.values(cats));
      let running = itemsTotal;
      const percentages = (version.percentages || []).map((p) => {
        const pct = D(p.pct || 0);
        if (pct.isNeg()) errors.push(`Percentage "${p.name}" must not be negative`);
        const base = p.basis === 'CUMULATIVE' ? running : itemsTotal;
        const amount = base.pct(pct).round(RULES.money);
        running = running.add(amount);
        return Object.assign({}, p, { base: base.toString(), amount: amount.toString() });
      });
      const pctTotal = sum(percentages, (p) => D(p.amount));
      const totalInr = itemsTotal.add(pctTotal);
      let foreign = null;
      const rate = D(version.exchangeRate || 0);
      if (rate.gt(0)) foreign = totalInr.div(rate).round(RULES.price);
      else errors.push('Exchange rate must be greater than zero');
      const catOut = {};
      Object.keys(cats).forEach((k) => (catOut[k] = cats[k].toString()));
      return {
        formulaVersion: Calc.FORMULA_VERSION,
        lines, categories: catOut,
        itemsTotal: itemsTotal.toString(),
        percentages, pctTotal: pctTotal.toString(),
        totalInr: totalInr.toString(),
        exchangeRate: rate.toString(), currency: version.currency,
        foreignPrice: foreign ? foreign.toString() : null,
        errors,
      };
    },

    /** Foreign = INR / (INR per unit) */
    toForeign(inr, rate, dp = RULES.price) {
      if (!D(rate).gt(0)) throw new Error('Exchange rate must be greater than zero');
      return D(inr).div(rate).round(dp);
    },
    /** INR = Foreign × (INR per unit) */
    toInr(foreign, rate) {
      if (!D(rate).gt(0)) throw new Error('Exchange rate must be greater than zero');
      return D(foreign).mul(rate).round(RULES.money);
    },

    /** Order quantity from size breakdown. */
    sizeTotal(sizes) {
      return Object.values(sizes || {}).reduce((a, q) => {
        const n = Number(q || 0);
        if (!Number.isInteger(n) || n < 0) throw new Error('Size quantities must be whole numbers ≥ 0');
        return a + n;
      }, 0);
    },

    /** Shipment: Foreign = Shipped Qty × Confirmed Price; INR = Foreign × Rate. */
    shipmentValues(qty, price, rate) {
      const foreign = D(qty).mul(price).round(RULES.money);
      const inr = Calc.toInr(foreign, rate);
      return { foreign: foreign.toString(), inr: inr.toString() };
    },
    /** Shipment Quantity Difference = Shipped − Ordered (negative = shortage, positive = excess). */
    qtyDifference(shipped, ordered) { return Number(shipped) - Number(ordered); },

    /** Overall Adjusted INR = Total INR Shipment Value + Additions − Deductions */
    adjustedInr(totalInr, additions, deductions) {
      return D(totalInr).add(additions || 0).sub(deductions || 0).round(RULES.money);
    },

    /** Per-style costing variance %:
        (Confirmed price × costing exchange rate − Costing Total INR) / Costing Total INR × 100.
        Uses the costing's own exchange rate so only the price difference is measured.
        NOTE: aggregation method is configurable — the workbook's −3.99% could not be reproduced
        by any standard method (see README "Open formula questions"). */
    styleVariancePct(confirmedPrice, costingRate, costingTotalInr) {
      const total = D(costingTotalInr);
      if (!total.gt(0)) throw new Error('Costing total must be greater than zero');
      return D(confirmedPrice).mul(costingRate).sub(total).div(total).mul(100).round(RULES.pct);
    },

    /** Aggregate style variances: SIMPLE_AVG | QTY_WEIGHTED | VALUE_WEIGHTED. rows: {pct, qty, value} */
    aggregateVariance(rows, method) {
      if (!rows.length) return D(0);
      if (method === 'QTY_WEIGHTED' || method === 'VALUE_WEIGHTED') {
        const w = (r) => D(method === 'QTY_WEIGHTED' ? r.qty : r.value);
        const tw = sum(rows, w);
        if (tw.isZero()) return D(0);
        return sum(rows, (r) => D(r.pct).mul(w(r))).div(tw).round(RULES.pct);
      }
      return sum(rows, (r) => D(r.pct)).div(rows.length).round(RULES.pct);
    },

    /** Category Expense Limit = Applicable Order Qty × Cost per Piece × (1 + Variance% / 100)
        (verified: 440 × 50.40 × (1 − 3.99%) = 21,291.18 in the BGPL-001 workbook). */
    expenseLimit(qty, costPerPiece, variancePct, applyVariance = true) {
      const base = D(qty).mul(costPerPiece);
      const v = applyVariance ? D(variancePct || 0) : D(0);
      return base.mul(D(1).add(v.div(100))).round(RULES.money);
    },

    /** Expense Difference = Expense Limit − Actual (positive = under limit). */
    expenseDifference(limit, actual) {
      const diff = D(limit).sub(actual);
      const pct = D(limit).isZero() ? null : diff.div(limit).mul(100).round(2);
      const status = diff.sign() > 0 ? 'UNDER' : diff.sign() < 0 ? 'OVER' : 'EQUAL';
      return { diff: diff.toString(), pct: pct ? pct.toString() : null, status };
    },

    /** Margins. Additions/deductions are already inside INR received, never applied twice.
        Budget-based  = INR received − Σ expense limits
        Actual-based  = INR received − Σ actual expenses                                    */
    margins({ inrReceived, totalLimits, totalActual }) {
      const inr = D(inrReceived);
      const budget = inr.sub(totalLimits).round(2);
      const actual = inr.sub(totalActual).round(2);
      const pctOf = (m) => (inr.isZero() ? null : m.div(inr).mul(100).round(2).toString());
      return {
        budgetMargin: budget.toString(), budgetMarginPct: pctOf(budget),
        actualMargin: actual.toString(), actualMarginPct: pctOf(actual),
      };
    },
  };

  /* ---------- Formatting helpers (display only) ---------- */
  function groupIN(intStr) {
    if (intStr.length <= 3) return intStr;
    const last3 = intStr.slice(-3);
    let rest = intStr.slice(0, -3);
    const out = [];
    while (rest.length > 2) { out.unshift(rest.slice(-2)); rest = rest.slice(0, -2); }
    if (rest) out.unshift(rest);
    return out.join(',') + ',' + last3;
  }
  function groupW(intStr) { return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  const SYMBOLS = { INR: '₹', GBP: '£', USD: '$', EUR: '€', AUD: 'A$', CAD: 'C$', JPY: '¥' };
  const Fmt = {
    indian: false, // Settings → Number format (source documents use Western grouping)
    num(x, dp = 2, indian = Fmt.indian) {
      if (x === null || x === undefined || x === '') return '—';
      let s; try { s = D(x).toFixed(dp); } catch (e) { return String(x); }
      const neg = s[0] === '-'; if (neg) s = s.slice(1);
      const [i, f] = s.split('.');
      return (neg ? '-' : '') + (indian ? groupIN(i) : groupW(i)) + (f !== undefined ? '.' + f : '');
    },
    inr(x, dp = 2) { return x === null || x === undefined || x === '' ? '—' : '₹' + Fmt.num(x, dp); },
    money(x, cur, dp = 2) {
      if (x === null || x === undefined || x === '') return '—';
      if (!cur || cur === 'INR') return Fmt.inr(x, dp);
      return (SYMBOLS[cur] || cur + ' ') + Fmt.num(x, dp);
    },
    qty(x) { return x === null || x === undefined || x === '' ? '—' : Fmt.num(x, 0); },
    pct(x, dp = 2) { return x === null || x === undefined || x === '' ? '—' : Fmt.num(x, dp, false) + '%'; },
    symbol(cur) { return SYMBOLS[cur] || cur; },
  };

  G.SP = G.SP || {};
  Object.assign(G.SP, { Dec, D, sum, Calc, Fmt, RULES, BASE_CATEGORIES });
})(typeof window !== 'undefined' ? window : globalThis);
