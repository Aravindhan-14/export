/* ==========================================================================
   store.js — persistence, authentication, permissions, audit and ALL business
   services. The UI never mutates data directly: every change goes through a
   service that checks permissions, validates, recalculates (with core.js) and
   commits atomically (optimistic revision check against IndexedDB, so two
   browser tabs can never double-allocate the same PO quantity).
   ========================================================================== */
(function (G) {
  'use strict';
  const { D, sum, Calc, BASE_CATEGORIES, Fmt } = G.SP;

  /* ---------------- Errors ---------------- */
  class AppError extends Error {
    constructor(message, field, code) { super(message); this.name = 'AppError'; this.field = field; this.code = code; }
  }
  const fail = (msg, field) => { throw new AppError(msg, field); };

  /* ---------------- Utilities ---------------- */
  const now = () => new Date().toISOString();
  const today = () => new Date().toISOString().slice(0, 10);
  const uid = () => (G.crypto && G.crypto.randomUUID ? G.crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2));
  const clone = (o) => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));
  const str = (v) => (v === null || v === undefined ? '' : String(v).trim());
  const lc = (v) => str(v).toLowerCase();
  const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(str(v)) && !isNaN(Date.parse(v));

  function reqStr(v, field, label, max = 200) {
    const s = str(v);
    if (!s) fail(`${label} is required`, field);
    if (s.length > max) fail(`${label} must be at most ${max} characters`, field);
    return s;
  }
  function optStr(v, max = 2000) { const s = str(v); if (s.length > max) fail(`Text is too long (max ${max})`); return s; }
  function dec(v, field, label, { min = 0, max = null, gt = false, required = true, dp = 6 } = {}) {
    if (str(v) === '') { if (required) fail(`${label} is required`, field); return null; }
    if (!G.SP.Dec.valid(v)) fail(`${label} must be a valid number`, field);
    const d = D(v);
    if (gt && !d.gt(min)) fail(`${label} must be greater than ${min}`, field);
    if (!gt && min !== null && d.lt(min)) fail(`${label} must not be less than ${min}`, field);
    if (max !== null && d.gt(max)) fail(`${label} must not be more than ${max}`, field);
    return d.round(dp).toString();
  }
  function int(v, field, label, { min = 0, required = true } = {}) {
    if (str(v) === '') { if (required) fail(`${label} is required`, field); return null; }
    const n = Number(String(v).replace(/,/g, ''));
    if (!Number.isInteger(n)) fail(`${label} must be a whole number`, field);
    if (n < min) fail(`${label} must be at least ${min}`, field);
    return n;
  }
  function date(v, field, label, required = true) {
    if (!str(v)) { if (required) fail(`${label} is required`, field); return null; }
    if (!isDate(v)) fail(`${label} must be a valid date`, field);
    return str(v);
  }

  /* ---------------- Permissions ---------------- */
  const PERMS = {
    'buyers.view': 'View buyers', 'buyers.edit': 'Add / edit buyers', 'buyers.delete': 'Delete buyers',
    'styles.view': 'View styles', 'styles.edit': 'Add / edit styles', 'styles.delete': 'Delete / archive styles',
    'costing.view': 'View costing', 'costing.edit': 'Edit costing (draft)', 'costing.approve': 'Approve costing',
    'quotes.view': 'View quotes', 'quotes.edit': 'Create / revise quotes', 'quotes.delete': 'Delete draft quotes',
    'orders.view': 'View orders & POs', 'orders.edit': 'Add / edit orders & POs', 'orders.delete': 'Delete / cancel orders', 'orders.manualQty': 'Manual order qty entry',
    'pools.view': 'View pools', 'pools.edit': 'Create / edit pools', 'pools.allocate': 'Allocate PO qty to pools', 'pools.release': 'Release allocations',
    'expenses.view': 'View expenses', 'expenses.edit': 'Add / edit expenses & payments', 'expenses.delete': 'Delete expenses',
    'exceptions.view': 'View missing / additional items', 'exceptions.edit': 'Add / edit exceptions', 'exceptions.decide': 'Accept / resolve exceptions',
    'shipments.view': 'View shipments', 'shipments.edit': 'Add / edit shipments', 'shipments.delete': 'Delete shipments', 'shipments.acceptExcess': 'Commercially accept excess shipment',
    'adjustments.edit': 'Add / delete additions & deductions',
    'rates.view': 'View exchange rates', 'rates.edit': 'Add / edit exchange rates & currencies',
    'reports.view': 'View reports & dashboard', 'reports.export': 'Export reports',
    'closure.close': 'Close pools', 'closure.reopen': 'Reopen closed pools (correction)',
    'import.run': 'CSV import', 'users.manage': 'Manage users & permissions', 'audit.view': 'View audit log', 'settings.manage': 'Manage settings & data',
  };
  const ALL = Object.keys(PERMS);
  const VIEW = ALL.filter((p) => p.endsWith('.view'));
  const ROLES = {
    ADMIN: 'Administrator', COSTING: 'Costing User', ORDERS: 'Order Management User',
    EXPENSE: 'Expense User', SHIPMENT: 'Shipment User', MANAGEMENT: 'Management / Reports User',
  };
  const DEFAULT_ROLE_PERMS = {
    ADMIN: ALL.slice(),
    COSTING: ['buyers.view', 'buyers.edit', 'styles.view', 'styles.edit', 'styles.delete', 'costing.view', 'costing.edit', 'costing.approve', 'quotes.view', 'quotes.edit', 'quotes.delete', 'orders.view', 'rates.view', 'reports.view', 'reports.export', 'import.run'],
    ORDERS: ['buyers.view', 'buyers.edit', 'styles.view', 'costing.view', 'quotes.view', 'orders.view', 'orders.edit', 'orders.delete', 'orders.manualQty', 'pools.view', 'pools.edit', 'pools.allocate', 'pools.release', 'shipments.view', 'rates.view', 'reports.view', 'import.run'],
    EXPENSE: ['buyers.view', 'styles.view', 'costing.view', 'orders.view', 'pools.view', 'expenses.view', 'expenses.edit', 'expenses.delete', 'exceptions.view', 'exceptions.edit', 'rates.view', 'reports.view'],
    SHIPMENT: ['buyers.view', 'styles.view', 'orders.view', 'pools.view', 'shipments.view', 'shipments.edit', 'shipments.delete', 'adjustments.edit', 'rates.view', 'rates.edit', 'reports.view'],
    MANAGEMENT: VIEW.concat(['reports.export']),
  };

  /* ---------------- Default settings (no business figures) ---------------- */
  function defaultSettings() {
    return {
      company: 'Sports Pro',
      numberFormat: 'western',
      poolPrefix: 'BGPL',
      fabricLossPct: '5',
      defaultPercentages: [{ name: 'REJ + OH + COMM + MARGIN', pct: '40', basis: 'ITEMS' }],
      units: ['kg', 'm', 'yd', 'pc', 'pair', 'set', 'dozen', 'gross', 'cone', 'roll'],
      productTypes: ['T-Shirt', 'Polo', 'Hoody', 'Sweatshirt', 'Pant', 'Shorts', 'Jacket', 'Romper', 'Other'],
      sizeSets: [
        { name: 'Baby (0-6M … 2-3Y)', sizes: ['0-6M', '6-12M', '12-18M', '2-3Y'] },
        { name: 'Adult XS-4XL', sizes: ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL'] },
        { name: 'Adult S-5XL', sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'] },
        { name: 'Junior (116-164)', sizes: ['116', '128', '140', '152', '164'] },
      ],
      extraCategories: [],
      variance: {
        method: 'SIMPLE_AVG', scope: 'POOL',
        categories: BASE_CATEGORIES.map((c) => c.key),
        approved: false,
      },
      shipment: { maxExcessPct: '5', requireFinalForClosure: true },
      pool: { allowPartialAllocation: true },
      attachments: { enabled: true, maxKb: 1024 },
      imageStorage: 'embedded',
      sessionMinutes: 480,
      rolePerms: clone(DEFAULT_ROLE_PERMS),
    };
  }

  const COLLS = ['users', 'buyers', 'currencies', 'rates', 'styles', 'costings', 'quotes', 'pos', 'lines', 'priceHistory', 'pools', 'allocations', 'expenses', 'exceptions', 'shipments', 'adjustments', 'closures', 'audit'];
  function emptyDb() {
    const db = { meta: { schema: 1, rev: 0, seq: {}, createdAt: now() }, settings: defaultSettings() };
    COLLS.forEach((c) => (db[c] = []));
    db.currencies = [
      { id: uid(), code: 'GBP', name: 'Pound Sterling', active: true },
      { id: uid(), code: 'USD', name: 'US Dollar', active: true },
      { id: uid(), code: 'EUR', name: 'Euro', active: true },
    ];
    return db;
  }
  function migrate(db) {
    COLLS.forEach((c) => { if (!Array.isArray(db[c])) db[c] = []; });
    const def = defaultSettings();
    db.settings = Object.assign(def, db.settings || {});
    ['variance', 'shipment', 'pool', 'attachments'].forEach((k) => (db.settings[k] = Object.assign(def[k], db.settings[k] || {})));
    Object.keys(DEFAULT_ROLE_PERMS).forEach((r) => { if (!db.settings.rolePerms[r]) db.settings.rolePerms[r] = DEFAULT_ROLE_PERMS[r].slice(); });
    db.meta.seq = db.meta.seq || {};
    return db;
  }

  /* ---------------- Persistence adapters ---------------- */
  const IDBAdapter = {
    name: 'sportspro-costing', store: 'kv',
    open() {
      return new Promise((res, rej) => {
        const r = indexedDB.open(this.name, 1);
        r.onupgradeneeded = () => r.result.createObjectStore(this.store);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    },
    async load() {
      const idb = await this.open();
      return new Promise((res, rej) => {
        const t = idb.transaction(this.store, 'readonly');
        const g = t.objectStore(this.store).get('db');
        g.onsuccess = () => res(g.result || null);
        g.onerror = () => rej(g.error);
      });
    },
    async save(db, expectedRev) {
      const idb = await this.open();
      return new Promise((res, rej) => {
        const t = idb.transaction(this.store, 'readwrite');
        const s = t.objectStore(this.store);
        let conflict = false;
        const g = s.get('db');
        g.onsuccess = () => {
          const cur = g.result;
          if (cur && expectedRev !== null && cur.meta.rev !== expectedRev) { conflict = true; t.abort(); return; }
          s.put(db, 'db');
        };
        t.oncomplete = () => res();
        t.onabort = () => { const e = new Error(conflict ? 'conflict' : 'Save aborted'); e.code = conflict ? 'CONFLICT' : 'ABORT'; rej(e); };
        t.onerror = () => {};
      });
    },
  };
  function MemoryAdapter() {
    let data = null;
    return {
      async load() { return data ? clone(data) : null; },
      async save(db, expectedRev) {
        if (data && expectedRev !== null && data.meta.rev !== expectedRev) { const e = new Error('conflict'); e.code = 'CONFLICT'; throw e; }
        data = clone(db);
      },
      _peek() { return data; },
    };
  }

  /* ---------------- Store ---------------- */
  const Store = {
    db: null, user: null, adapter: null, listeners: new Set(), _chain: Promise.resolve(), channel: null,
    async init(adapter) {
      this.adapter = adapter;
      const loaded = await adapter.load();
      this.db = migrate(loaded || emptyDb());
      if (!loaded) await adapter.save(this.db, null);
      Fmt.indian = this.db.settings.numberFormat === 'indian';
      if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
        this.channel = new BroadcastChannel('sportspro-costing');
        this.channel.onmessage = async () => { await this.reload(); };
      }
      return this;
    },
    async reload() {
      const d = await this.adapter.load();
      if (d) { this.db = migrate(d); Fmt.indian = this.db.settings.numberFormat === 'indian'; this.emit(); }
    },
    on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
    emit() { this.listeners.forEach((f) => { try { f(); } catch (e) { console.error(e); } }); },
    /** Atomic mutation: fn runs on a draft copy; nothing is saved if it throws. */
    commit(fn) {
      const run = this._chain.then(async () => {
        const draft = clone(this.db);
        const result = await fn(draft);
        const prevRev = this.db.meta.rev;
        draft.meta.rev = prevRev + 1;
        draft.meta.updatedAt = now();
        try { await this.adapter.save(draft, prevRev); }
        catch (e) {
          if (e.code === 'CONFLICT') {
            await this.reload();
            throw new AppError('Data was changed in another window. The latest data has been reloaded — please repeat the action.', null, 'CONFLICT');
          }
          throw e;
        }
        this.db = draft;
        Fmt.indian = draft.settings.numberFormat === 'indian';
        if (this.channel) this.channel.postMessage('changed');
        this.emit();
        return result;
      });
      this._chain = run.catch(() => {});
      return run;
    },
  };

  /* ---------------- Auth ---------------- */
  const enc = (s) => new TextEncoder().encode(s);
  const hex = (buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  async function hashPassword(password, saltHex) {
    const salt = saltHex || hex(G.crypto.getRandomValues(new Uint8Array(16)));
    const key = await G.crypto.subtle.importKey('raw', enc(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await G.crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc(salt), iterations: 120000 }, key, 256);
    return { salt, hash: hex(bits) };
  }
  function validatePassword(p) {
    if (!p || p.length < 8) fail('Password must be at least 8 characters', 'password');
    if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) fail('Password must contain letters and numbers', 'password');
  }
  const Session = {
    key: 'sp-session',
    get() { try { return JSON.parse((G.sessionStorage && G.sessionStorage.getItem(this.key)) || 'null'); } catch (e) { return null; } },
    set(v) { try { G.sessionStorage && G.sessionStorage.setItem(this.key, JSON.stringify(v)); } catch (e) { /* ignore */ } },
    clear() { try { G.sessionStorage && G.sessionStorage.removeItem(this.key); } catch (e) { /* ignore */ } },
  };

  function can(perm, user) {
    const u = user || Store.user;
    if (!u || !u.active) return false;
    if (u.role === 'ADMIN') return true;
    const perms = (Store.db.settings.rolePerms[u.role] || []);
    return perms.includes(perm);
  }
  function requirePerm(perm) {
    if (!Store.user) throw new AppError('Please sign in', null, 'AUTH');
    if (perm && !can(perm)) throw new AppError(`You do not have permission: ${PERMS[perm] || perm}`, null, 'FORBIDDEN');
  }

  /* ---------------- Sequences, audit ---------------- */
  function nextNo(db, key, prefix, pad = 4) {
    const n = (db.meta.seq[key] || 0) + 1;
    db.meta.seq[key] = n;
    return `${prefix}-${String(n).padStart(pad, '0')}`;
  }
  function strip(o) {
    if (!o) return o;
    const c = clone(o);
    ['image', 'passwordHash', 'salt', 'attachment', 'snapshot'].forEach((k) => { if (c[k]) c[k] = k === 'image' || k === 'attachment' ? '[file]' : '[hidden]'; });
    return c;
  }
  function audit(db, action, entity, rec, before, reason) {
    db.audit.push({
      id: uid(), at: now(), userId: Store.user ? Store.user.id : null, userName: Store.user ? Store.user.name : 'system',
      action, entity, entityId: rec ? rec.id : null,
      ref: rec ? rec.code || rec.styleRef || rec.quoteNo || rec.poNumber || rec.confNo || rec.poolNo || rec.expNo || rec.excNo || rec.shipNo || rec.adjNo || rec.email || rec.label || '' : '',
      before: strip(before) || null, after: strip(rec) || null, reason: reason || null,
    });
  }
  function mut(perm, fn) {
    try { requirePerm(perm); } catch (e) { return Promise.reject(e); }
    return Store.commit(fn);
  }
  const byId = (db, coll, id) => db[coll].find((r) => r.id === id);
  function must(db, coll, id, label) { const r = byId(db, coll, id); if (!r) fail(`${label || 'Record'} not found`); return r; }

  /* ---------------- Categories ---------------- */
  function categories(db) {
    const d = db || Store.db;
    return BASE_CATEGORIES.concat((d.settings.extraCategories || []).map((l) => ({ key: 'X_' + l.toUpperCase().replace(/[^A-Z0-9]+/g, '_'), label: l })));
  }
  const catLabel = (key, db) => (categories(db).find((c) => c.key === key) || { label: key }).label;

  /* ---------------- Derived metrics (always computed from source records) ---------------- */
  function lineMetrics(db, line) {
    const allocs = db.allocations.filter((a) => a.lineId === line.id);
    const active = allocs.filter((a) => a.status === 'ACTIVE');
    const allocated = active.reduce((a, x) => a + x.qty, 0);
    const ships = db.shipments.filter((s) => s.lineId === line.id && !s.deletedAt);
    const shipped = ships.reduce((a, x) => a + x.shippedQty, 0);
    return {
      allocated, remainingPool: line.orderQty - allocated,
      shipped, remainingShip: Math.max(0, line.orderQty - shipped), shipDiff: shipped - line.orderQty,
      finalShipped: ships.some((s) => s.isFinal), activeAllocs: active, allAllocs: allocs, shipments: ships,
    };
  }
  function rateOn(db, currency, onDate) {
    const list = db.rates.filter((r) => r.currency === currency && (!onDate || r.effectiveDate <= onDate));
    list.sort((a, b) => (a.effectiveDate < b.effectiveDate ? 1 : a.effectiveDate > b.effectiveDate ? -1 : a.createdAt < b.createdAt ? 1 : -1));
    return list[0] || null;
  }
  function poolOf(db, id) { return byId(db, 'pools', id); }
  function assertPoolEditable(db, poolId, what) {
    if (!poolId) return;
    const p = poolOf(db, poolId);
    if (!p) fail('Pool not found');
    if (p.status === 'CLOSED') fail(`Pool ${p.poolNo} is closed — ${what || 'financial records'} cannot be changed. Use Pool Closure → Reopen (authorised correction).`);
    if (p.status === 'CANCELLED') fail(`Pool ${p.poolNo} is cancelled`);
  }

  /* ======================= SERVICES ======================= */
  const svc = {};

  /* ---------- Auth & users ---------- */
  svc.hasUsers = () => Store.db.users.length > 0;
  svc.setupAdmin = async ({ name, email, password }) => {
    if (Store.db.users.length) fail('Setup already completed');
    validatePassword(password);
    const h = await hashPassword(password);
    const u = { id: uid(), name: reqStr(name, 'name', 'Name'), email: reqStr(email, 'email', 'Email').toLowerCase(), role: 'ADMIN', active: true, passwordHash: h.hash, salt: h.salt, createdAt: now(), failed: 0 };
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(u.email)) fail('Enter a valid email', 'email');
    await Store.commit((db) => { db.users.push(u); });
    Store.user = byId(Store.db, 'users', u.id);
    await Store.commit((db) => audit(db, 'CREATE', 'User', u));
    Session.set({ userId: u.id, exp: Date.now() + Store.db.settings.sessionMinutes * 60000 });
    return Store.user;
  };
  svc.login = async (email, password) => {
    const u = Store.db.users.find((x) => x.email === lc(email));
    if (!u || !u.active) { await new Promise((r) => setTimeout(r, 300)); fail('Invalid email or password'); }
    if (u.lockedUntil && Date.parse(u.lockedUntil) > Date.now()) fail('Account temporarily locked after failed attempts. Try again in a few minutes.');
    const h = await hashPassword(password || '', u.salt);
    if (h.hash !== u.passwordHash) {
      await Store.commit((db) => {
        const x = byId(db, 'users', u.id); x.failed = (x.failed || 0) + 1;
        if (x.failed >= 5) { x.lockedUntil = new Date(Date.now() + 5 * 60000).toISOString(); x.failed = 0; }
      });
      fail('Invalid email or password');
    }
    await Store.commit((db) => { const x = byId(db, 'users', u.id); x.failed = 0; x.lockedUntil = null; x.lastLogin = now(); });
    Store.user = byId(Store.db, 'users', u.id);
    Session.set({ userId: u.id, exp: Date.now() + Store.db.settings.sessionMinutes * 60000 });
    await Store.commit((db) => audit(db, 'LOGIN', 'User', { id: u.id, email: u.email }));
    return Store.user;
  };
  svc.restoreSession = () => {
    const s = Session.get();
    if (!s || s.exp < Date.now()) { Session.clear(); return null; }
    const u = byId(Store.db, 'users', s.userId);
    if (!u || !u.active) { Session.clear(); return null; }
    Store.user = u; return u;
  };
  svc.logout = () => { Store.user = null; Session.clear(); };
  svc.saveUser = (data) => mut('users.manage', async (db) => {
    const email = reqStr(data.email, 'email', 'Email').toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('Enter a valid email', 'email');
    if (db.users.some((u) => u.email === email && u.id !== data.id)) fail('Email already in use', 'email');
    if (!ROLES[data.role]) fail('Select a role', 'role');
    if (data.id) {
      const u = must(db, 'users', data.id, 'User'); const before = clone(u);
      if (u.id === Store.user.id && data.role !== 'ADMIN') fail('You cannot remove your own administrator role', 'role');
      Object.assign(u, { name: reqStr(data.name, 'name', 'Name'), email, role: data.role, active: data.active !== false, updatedAt: now() });
      if (u.id === Store.user.id && !u.active) fail('You cannot deactivate your own account');
      audit(db, 'UPDATE', 'User', u, before); return u;
    }
    validatePassword(data.password);
    const h = await hashPassword(data.password);
    const u = { id: uid(), name: reqStr(data.name, 'name', 'Name'), email, role: data.role, active: data.active !== false, passwordHash: h.hash, salt: h.salt, createdAt: now(), failed: 0 };
    db.users.push(u); audit(db, 'CREATE', 'User', u); return u;
  });
  svc.resetPassword = (id, password) => mut(id === (Store.user && Store.user.id) ? null : 'users.manage', async (db) => {
    validatePassword(password);
    const u = must(db, 'users', id, 'User'); const h = await hashPassword(password);
    u.passwordHash = h.hash; u.salt = h.salt; u.failed = 0; u.lockedUntil = null;
    audit(db, 'PASSWORD_RESET', 'User', u);
  });
  svc.changeOwnPassword = async (oldPw, newPw) => {
    requirePerm(null);
    const u = Store.user; const h = await hashPassword(oldPw || '', u.salt);
    if (h.hash !== u.passwordHash) fail('Current password is incorrect', 'oldPassword');
    await svc.resetPassword(u.id, newPw);
    Store.user = byId(Store.db, 'users', u.id);
  };
  svc.deleteUser = (id) => mut('users.manage', (db) => {
    if (id === Store.user.id) fail('You cannot delete your own account');
    const u = must(db, 'users', id, 'User');
    const used = db.audit.some((a) => a.userId === id && a.action !== 'LOGIN');
    if (used) fail('This user has recorded activity in the audit log. Deactivate the account instead of deleting it.');
    db.users = db.users.filter((x) => x.id !== id); audit(db, 'DELETE', 'User', u);
  });
  svc.saveRolePerms = (rolePerms) => mut('users.manage', (db) => {
    const before = clone(db.settings.rolePerms);
    Object.keys(ROLES).forEach((r) => {
      if (r === 'ADMIN') { db.settings.rolePerms.ADMIN = ALL.slice(); return; }
      db.settings.rolePerms[r] = (rolePerms[r] || []).filter((p) => PERMS[p]);
    });
    audit(db, 'UPDATE', 'Permissions', { id: 'rolePerms', label: 'Role permissions' }, { rolePerms: before });
  });

  /* ---------- Settings ---------- */
  svc.saveSettings = (patch) => mut('settings.manage', (db) => {
    const s = db.settings; const before = clone(s);
    if ('company' in patch) s.company = reqStr(patch.company, 'company', 'Company name');
    if ('numberFormat' in patch) s.numberFormat = patch.numberFormat === 'indian' ? 'indian' : 'western';
    if ('poolPrefix' in patch) { const p = reqStr(patch.poolPrefix, 'poolPrefix', 'Pool prefix', 10).toUpperCase(); if (!/^[A-Z0-9]+$/.test(p)) fail('Prefix may contain only letters and digits', 'poolPrefix'); s.poolPrefix = p; }
    if ('fabricLossPct' in patch) s.fabricLossPct = dec(patch.fabricLossPct, 'fabricLossPct', 'Fabric loss %', { max: 100 });
    if ('defaultPercentages' in patch) s.defaultPercentages = patch.defaultPercentages.map((p, i) => ({ name: reqStr(p.name, 'pct' + i, 'Percentage name'), pct: dec(p.pct, 'pct' + i, 'Percentage'), basis: p.basis === 'CUMULATIVE' ? 'CUMULATIVE' : 'ITEMS' }));
    ['units', 'productTypes', 'extraCategories'].forEach((k) => {
      if (k in patch) {
        const list = patch[k].map(str).filter(Boolean);
        if (new Set(list.map(lc)).size !== list.length) fail(`Duplicate values in ${k}`, k);
        s[k] = list;
      }
    });
    if ('sizeSets' in patch) s.sizeSets = patch.sizeSets.map((x) => ({ name: reqStr(x.name, 'sizeSets', 'Size set name'), sizes: x.sizes.map(str).filter(Boolean) })).filter((x) => x.sizes.length);
    if ('variance' in patch) {
      const v = patch.variance;
      if (!['SIMPLE_AVG', 'QTY_WEIGHTED', 'VALUE_WEIGHTED'].includes(v.method)) fail('Invalid variance method');
      if (!['POOL', 'STYLE'].includes(v.scope)) fail('Invalid variance scope');
      s.variance = { method: v.method, scope: v.scope, categories: (v.categories || []).slice(), approved: !!v.approved };
    }
    if ('shipment' in patch) s.shipment = { maxExcessPct: dec(patch.shipment.maxExcessPct, 'maxExcessPct', 'Max excess %'), requireFinalForClosure: !!patch.shipment.requireFinalForClosure };
    if ('pool' in patch) s.pool = { allowPartialAllocation: !!patch.pool.allowPartialAllocation };
    if ('attachments' in patch) s.attachments = { enabled: !!patch.attachments.enabled, maxKb: int(patch.attachments.maxKb, 'maxKb', 'Max attachment size', { min: 50 }) };
    if ('imageStorage' in patch) s.imageStorage = patch.imageStorage === 'url' ? 'url' : 'embedded';
    if ('sessionMinutes' in patch) s.sessionMinutes = int(patch.sessionMinutes, 'sessionMinutes', 'Session length', { min: 5 });
    audit(db, 'UPDATE', 'Settings', { id: 'settings', label: 'Settings' }, before);
  });

  /* ---------- Currencies & exchange rates ---------- */
  svc.saveCurrency = (data) => mut('rates.edit', (db) => {
    const code = reqStr(data.code, 'code', 'Currency code', 3).toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) fail('Currency code must be 3 letters (ISO 4217)', 'code');
    if (code === 'INR') fail('INR is the base currency', 'code');
    if (db.currencies.some((c) => c.code === code && c.id !== data.id)) fail('Currency already exists', 'code');
    if (data.id) {
      const c = must(db, 'currencies', data.id); const before = clone(c);
      if (c.code !== code && (db.rates.some((r) => r.currency === c.code) || db.buyers.some((b) => b.currency === c.code))) fail('Currency code is in use and cannot be changed', 'code');
      Object.assign(c, { code, name: reqStr(data.name, 'name', 'Currency name'), active: data.active !== false });
      audit(db, 'UPDATE', 'Currency', c, before); return c;
    }
    const c = { id: uid(), code, name: reqStr(data.name, 'name', 'Currency name'), active: true };
    db.currencies.push(c); audit(db, 'CREATE', 'Currency', c); return c;
  });
  svc.deleteCurrency = (id) => mut('rates.edit', (db) => {
    const c = must(db, 'currencies', id);
    const used = db.rates.some((r) => r.currency === c.code) || db.buyers.some((b) => b.currency === c.code) || db.lines.some((l) => l.currency === c.code) || db.costings.some((x) => x.currency === c.code);
    if (used) fail(`${c.code} is used by rates, buyers, costings or orders — deactivate it instead.`);
    db.currencies = db.currencies.filter((x) => x.id !== id); audit(db, 'DELETE', 'Currency', c);
  });
  svc.saveRate = (data) => mut('rates.edit', (db) => {
    const currency = reqStr(data.currency, 'currency', 'Currency');
    if (!db.currencies.some((c) => c.code === currency)) fail('Unknown currency', 'currency');
    const r = {
      currency, inrPerUnit: dec(data.inrPerUnit, 'inrPerUnit', 'INR per unit', { gt: true, dp: 4 }),
      effectiveDate: date(data.effectiveDate, 'effectiveDate', 'Effective date'), source: optStr(data.source, 300),
    };
    if (db.rates.some((x) => x.currency === currency && x.effectiveDate === r.effectiveDate && x.id !== data.id)) fail(`A ${currency} rate already exists for ${r.effectiveDate}. Edit that rate or choose another date.`, 'effectiveDate');
    if (data.id) {
      const x = must(db, 'rates', data.id, 'Rate'); const before = clone(x);
      Object.assign(x, r, { updatedAt: now(), updatedBy: Store.user.name });
      audit(db, 'UPDATE', 'ExchangeRate', Object.assign({ code: `${currency} ${r.effectiveDate}` }, x), before, 'Existing costings/shipments keep the rate copied at the time they were saved');
      return x;
    }
    const x = Object.assign({ id: uid(), createdAt: now(), createdBy: Store.user.name, isTest: !!data.isTest }, r);
    db.rates.push(x); audit(db, 'CREATE', 'ExchangeRate', Object.assign({ code: `${currency} ${r.effectiveDate}` }, x)); return x;
  });
  svc.deleteRate = (id) => mut('rates.edit', (db) => {
    const r = must(db, 'rates', id, 'Rate');
    const used = db.shipments.some((s) => s.rateId === id && !s.deletedAt) || db.costings.some((c) => c.rateId === id) || db.quotes.some((q) => q.rateId === id);
    if (used) fail('This rate has been used by costings or shipments and is kept for history. Add a new rate instead.');
    db.rates = db.rates.filter((x) => x.id !== id); audit(db, 'DELETE', 'ExchangeRate', r);
  });

  /* ---------- Buyers ---------- */
  svc.saveBuyer = (data) => mut('buyers.edit', (db) => {
    const name = reqStr(data.name, 'name', 'Buyer name');
    let code = str(data.code).toUpperCase();
    const email = str(data.email);
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('Enter a valid email', 'email');
    if (data.phone && !/^[0-9+()\-\s.]{5,25}$/.test(data.phone)) fail('Enter a valid phone number', 'phone');
    const currency = reqStr(data.currency, 'currency', 'Default currency');
    if (currency !== 'INR' && !db.currencies.some((c) => c.code === currency)) fail('Unknown currency', 'currency');
    if (db.buyers.some((b) => lc(b.name) === lc(name) && b.id !== data.id)) fail('A buyer with this name already exists', 'name');
    const fields = { name, contact: optStr(data.contact, 200), email, phone: str(data.phone), address: optStr(data.address, 1000), country: optStr(data.country, 100), currency, notes: optStr(data.notes), active: data.active !== false && data.active !== 'false' };
    if (data.id) {
      const b = must(db, 'buyers', data.id, 'Buyer'); const before = clone(b);
      if (code && code !== b.code) {
        if (db.buyers.some((x) => x.code === code)) fail('Buyer ID already exists', 'code');
        b.code = code;
      }
      Object.assign(b, fields, { updatedAt: now() }); audit(db, 'UPDATE', 'Buyer', b, before); return b;
    }
    if (code) { if (db.buyers.some((x) => x.code === code)) fail('Buyer ID already exists', 'code'); }
    else { do { code = nextNo(db, 'buyer', 'BUY'); } while (db.buyers.some((x) => x.code === code)); }
    const b = Object.assign({ id: uid(), code, createdAt: now(), updatedAt: now(), isTest: !!data.isTest }, fields);
    db.buyers.push(b); audit(db, 'CREATE', 'Buyer', b); return b;
  });
  svc.setBuyerActive = (id, active) => mut('buyers.edit', (db) => {
    const b = must(db, 'buyers', id, 'Buyer'); const before = clone(b);
    b.active = !!active; b.updatedAt = now(); audit(db, active ? 'ACTIVATE' : 'DEACTIVATE', 'Buyer', b, before);
  });
  svc.deleteBuyer = (id) => mut('buyers.delete', (db) => {
    const b = must(db, 'buyers', id, 'Buyer');
    const styles = db.styles.filter((s) => s.buyerId === id).length;
    const pos = db.pos.filter((p) => p.buyerId === id).length;
    const pools = db.pools.filter((p) => p.buyerId === id).length;
    if (styles || pos || pools) fail(`Cannot delete ${b.name}: linked to ${styles} style(s), ${pos} PO(s), ${pools} pool(s). Deactivate the buyer instead to keep history.`);
    db.buyers = db.buyers.filter((x) => x.id !== id); audit(db, 'DELETE', 'Buyer', b);
  });

  /* ---------- Styles ---------- */
  svc.saveStyle = (data) => mut('styles.edit', (db) => {
    const buyer = must(db, 'buyers', data.buyerId, 'Buyer');
    if (!buyer.active && !data.id) fail('Buyer is inactive', 'buyerId');
    const season = reqStr(data.season, 'season', 'Season', 40);
    const styleRef = reqStr(data.styleRef, 'styleRef', 'Style reference', 80);
    // Uniqueness rule: style reference is unique per buyer + season (case-insensitive).
    if (db.styles.some((s) => s.id !== data.id && s.buyerId === buyer.id && lc(s.season) === lc(season) && lc(s.styleRef) === lc(styleRef))) fail(`Style ${styleRef} already exists for ${buyer.name} / ${season}`, 'styleRef');
    const perCombo = int(data.qtyPerCombo, 'qtyPerCombo', 'Expected qty per combo', { required: false }) || 0;
    const combos = int(data.combos, 'combos', 'Expected number of combos', { required: false }) || 0;
    const sizes = (Array.isArray(data.sizes) ? data.sizes : str(data.sizes).split(',')).map(str).filter(Boolean);
    if (new Set(sizes.map(lc)).size !== sizes.length) fail('Duplicate sizes in size set', 'sizes');
    const fields = {
      buyerId: buyer.id, season, styleRef, description: optStr(data.description, 300), productType: optStr(data.productType, 80),
      sizeRange: optStr(data.sizeRange, 80), sizes, qtyPerCombo: perCombo, combos, expectedQty: Calc.expectedQty(perCombo, combos),
      quoteDate: date(data.quoteDate, 'quoteDate', 'Quote date', false), status: ['ACTIVE', 'DRAFT', 'ARCHIVED'].includes(data.status) ? data.status : 'ACTIVE',
      remarks: optStr(data.remarks),
    };
    if ('image' in data) fields.image = data.image || null;
    if (data.id) {
      const s = must(db, 'styles', data.id, 'Style'); const before = clone(s);
      const used = db.lines.some((l) => l.styleId === s.id) || db.quotes.some((q) => q.styleId === s.id);
      if (used && s.buyerId !== buyer.id) fail('Style already has quotes / orders — the buyer cannot be changed', 'buyerId');
      Object.assign(s, fields, { updatedAt: now() }); audit(db, 'UPDATE', 'Style', s, before); return s;
    }
    const s = Object.assign({ id: uid(), code: nextNo(db, 'style', 'STY'), createdAt: now(), updatedAt: now(), isTest: !!data.isTest, image: data.image || null }, fields);
    db.styles.push(s); audit(db, 'CREATE', 'Style', s); return s;
  });
  svc.setStyleStatus = (id, status) => mut('styles.delete', (db) => {
    const s = must(db, 'styles', id, 'Style'); const before = clone(s);
    s.status = status; s.updatedAt = now(); audit(db, status === 'ARCHIVED' ? 'ARCHIVE' : 'RESTORE', 'Style', s, before);
  });
  svc.deleteStyle = (id) => mut('styles.delete', (db) => {
    const s = must(db, 'styles', id, 'Style');
    const c = db.costings.filter((x) => x.styleId === id).length, q = db.quotes.filter((x) => x.styleId === id).length, l = db.lines.filter((x) => x.styleId === id).length;
    if (c || q || l) fail(`Style ${s.styleRef} has ${c} costing version(s), ${q} quote(s), ${l} order line(s). Archive it instead to preserve history.`);
    db.styles = db.styles.filter((x) => x.id !== id); audit(db, 'DELETE', 'Style', s);
  });

  /* ---------- Costing ---------- */
  function cleanLines(db, lines) {
    const cats = categories(db).map((c) => c.key);
    return (lines || []).map((l, i) => {
      if (!cats.includes(l.category)) fail(`Row ${i + 1}: unknown category`);
      const label = `${catLabel(l.category, db)} row ${i + 1}`;
      const out = {
        id: l.id || uid(), category: l.category, name: reqStr(l.name, 'line' + i, `${label}: name`),
        description: optStr(l.description, 300), composition: optStr(l.composition, 200), gsm: optStr(l.gsm, 20), colour: optStr(l.colour, 80),
        unit: optStr(l.unit, 20), rateUnit: optStr(l.rateUnit, 20),
        qty: dec(l.qty === '' || l.qty == null ? '1' : l.qty, 'line' + i, `${label}: consumption/qty`, { min: 0 }),
        rate: dec(l.rate, 'line' + i, `${label}: rate`, { min: 0 }),
        allowancePct: dec(l.allowancePct || '0', 'line' + i, `${label}: allowance %`, { min: 0 }),
        remarks: optStr(l.remarks, 500),
      };
      if (out.unit && !db.settings.units.includes(out.unit)) fail(`${label}: unit "${out.unit}" is not a configured unit`);
      if (out.rateUnit && !db.settings.units.includes(out.rateUnit)) fail(`${label}: rate unit "${out.rateUnit}" is not a configured unit`);
      if (!Calc.unitsCompatible(out)) fail(`${label}: consumption unit (${out.unit}) and rate unit (${out.rateUnit}) are incompatible — enter both in the same unit`);
      return out;
    });
  }
  function cleanPercentages(list) {
    return (list || []).map((p, i) => ({ id: p.id || uid(), name: reqStr(p.name, 'pct' + i, 'Percentage name'), pct: dec(p.pct, 'pct' + i, `${p.name || 'Percentage'} %`), basis: p.basis === 'CUMULATIVE' ? 'CUMULATIVE' : 'ITEMS' }));
  }
  function recompute(db, v) {
    const r = Calc.costing(v, categories(db));
    v.results = { categories: r.categories, itemsTotal: r.itemsTotal, percentages: r.percentages.map((p) => ({ name: p.name, pct: p.pct, basis: p.basis, base: p.base, amount: p.amount })), pctTotal: r.pctTotal, totalInr: r.totalInr, foreignPrice: r.foreignPrice, lineAmounts: Object.fromEntries(r.lines.map((l) => [l.id, l.amount])) };
    v.formulaVersion = r.formulaVersion;
    return r;
  }
  svc.newCosting = (styleId) => mut('costing.edit', (db) => {
    const st = must(db, 'styles', styleId, 'Style');
    if (st.status === 'ARCHIVED') fail('Style is archived');
    const buyer = byId(db, 'buyers', st.buyerId);
    const currency = buyer && buyer.currency !== 'INR' ? buyer.currency : (db.currencies[0] || {}).code;
    const rate = rateOn(db, currency, today());
    const n = db.costings.filter((c) => c.styleId === styleId).length;
    const v = {
      id: uid(), styleId, versionNo: n + 1, label: n === 0 ? 'Original' : `Revised ${n}`, parentId: null, status: 'DRAFT',
      currency, exchangeRate: rate ? rate.inrPerUnit : '', rateDate: rate ? rate.effectiveDate : '', rateId: rate ? rate.id : null,
      lines: [], percentages: cleanPercentages(db.settings.defaultPercentages), notes: '',
      createdBy: Store.user.name, createdAt: now(), updatedAt: now(),
    };
    recompute(db, v); db.costings.push(v); audit(db, 'CREATE', 'Costing', Object.assign({ code: `${st.styleRef} ${v.label}` }, v)); return v;
  });
  svc.saveCosting = (id, data) => mut('costing.edit', (db) => {
    const v = must(db, 'costings', id, 'Costing version');
    if (v.status !== 'DRAFT') fail(`${v.label} is ${v.status.toLowerCase()} and cannot be changed. Use "Save As" to create a new revision.`);
    const before = clone(v);
    const currency = reqStr(data.currency, 'currency', 'Currency');
    if (!db.currencies.some((c) => c.code === currency)) fail('Unknown currency', 'currency');
    v.currency = currency;
    v.exchangeRate = dec(data.exchangeRate, 'exchangeRate', 'Exchange rate (INR per unit)', { gt: true, dp: 4 });
    v.rateDate = date(data.rateDate, 'rateDate', 'Exchange rate date', false) || '';
    v.rateId = data.rateId && byId(db, 'rates', data.rateId) && byId(db, 'rates', data.rateId).inrPerUnit === v.exchangeRate ? data.rateId : null;
    v.lines = cleanLines(db, data.lines);
    v.percentages = cleanPercentages(data.percentages);
    v.notes = optStr(data.notes);
    v.updatedAt = now(); v.updatedBy = Store.user.name;
    const r = recompute(db, v);
    if (r.errors.length) fail(r.errors[0]);
    const st = byId(db, 'styles', v.styleId);
    audit(db, 'UPDATE', 'Costing', Object.assign({ code: `${st.styleRef} ${v.label}` }, v), before);
    return v;
  });
  svc.saveAsCosting = (id) => mut('costing.edit', (db) => {
    const src = must(db, 'costings', id, 'Costing version');
    const n = db.costings.filter((c) => c.styleId === src.styleId).length;
    const v = clone(src);
    Object.assign(v, { id: uid(), versionNo: n + 1, label: n === 0 ? 'Original' : `Revised ${n}`, parentId: src.id, status: 'DRAFT', createdBy: Store.user.name, createdAt: now(), updatedAt: now(), approvedAt: null, approvedBy: null });
    v.lines = v.lines.map((l) => Object.assign({}, l, { id: uid() }));
    v.percentages = v.percentages.map((p) => Object.assign({}, p, { id: uid() }));
    recompute(db, v); db.costings.push(v);
    const st = byId(db, 'styles', v.styleId);
    audit(db, 'SAVE_AS', 'Costing', Object.assign({ code: `${st.styleRef} ${v.label}` }, v), null, `Copied from ${src.label}`);
    return v;
  });
  function approveInDb(db, v) {
    if (v.status === 'APPROVED') return;
    const r = recompute(db, v);
    if (r.errors.length) fail(r.errors[0]);
    if (!v.lines.length) fail('Costing has no item rows');
    v.status = 'APPROVED'; v.approvedBy = Store.user.name; v.approvedAt = now();
  }
  svc.approveCosting = (id) => mut('costing.approve', (db) => {
    const v = must(db, 'costings', id, 'Costing version'); const before = clone(v);
    approveInDb(db, v);
    const st = byId(db, 'styles', v.styleId);
    audit(db, 'APPROVE', 'Costing', Object.assign({ code: `${st.styleRef} ${v.label}` }, v), before);
  });
  svc.deleteCosting = (id) => mut('costing.edit', (db) => {
    const v = must(db, 'costings', id, 'Costing version');
    if (v.status !== 'DRAFT') fail('Only draft costing versions can be deleted');
    if (db.quotes.some((q) => q.costingId === id) || db.lines.some((l) => l.costingId === id)) fail('Costing version is referenced by quotes or orders');
    db.costings = db.costings.filter((x) => x.id !== id);
    audit(db, 'DELETE', 'Costing', v);
  });
  /** Copy rows of one category from a costing version into a draft version (same or other style). */
  svc.copyCostingRows = (fromId, category, toId, toCategory) => mut('costing.edit', (db) => {
    const from = must(db, 'costings', fromId, 'Source costing'); const to = must(db, 'costings', toId, 'Target costing');
    if (to.status !== 'DRAFT') fail('Target costing version must be a draft');
    const rows = from.lines.filter((l) => l.category === category);
    if (!rows.length) fail('Source has no rows in that section');
    rows.forEach((l) => to.lines.push(Object.assign({}, l, { id: uid(), category: toCategory || category })));
    recompute(db, to); to.updatedAt = now();
    audit(db, 'COPY_ROWS', 'Costing', Object.assign({ code: to.label }, to), null, `${rows.length} ${catLabel(category, db)} row(s) copied from ${from.label}`);
    return rows.length;
  });

  /* ---------- Quotes ---------- */
  svc.createQuote = (data) => mut('quotes.edit', (db) => {
    const v = must(db, 'costings', data.costingId, 'Costing version');
    const st = must(db, 'styles', v.styleId, 'Style');
    if (v.status === 'DRAFT') { if (!can('costing.approve')) fail('The costing version must be approved before quoting'); approveInDb(db, v); }
    const r = v.results;
    if (!r.foreignPrice) fail('Costing has no foreign-currency price (check exchange rate)');
    const quotedPrice = str(data.quotedPrice) ? dec(data.quotedPrice, 'quotedPrice', 'Quoted price', { gt: true, dp: 4 }) : D(r.foreignPrice).round(2).toString();
    const existing = db.quotes.filter((q) => q.styleId === st.id);
    if (existing.some((q) => q.costingId === v.id && q.status !== 'REJECTED')) fail(`A quote already exists for ${v.label}. Use "Revise" to create a new costing revision.`);
    const revisionNo = existing.length;
    existing.forEach((q) => { if (['DRAFT', 'SENT'].includes(q.status)) { q.status = 'SUPERSEDED'; q.updatedAt = now(); } });
    const q = {
      id: uid(), quoteNo: nextNo(db, 'quote', 'QT'), styleId: st.id, buyerId: st.buyerId, season: st.season, costingId: v.id,
      revisionNo, label: revisionNo === 0 ? 'Quote' : `Revised Quote ${revisionNo}`,
      quoteDate: date(data.quoteDate || today(), 'quoteDate', 'Quote date'), currency: v.currency, exchangeRate: v.exchangeRate, rateId: v.rateId,
      totalInr: r.totalInr, calculatedPrice: r.foreignPrice, quotedPrice, remarks: optStr(data.remarks), status: 'DRAFT',
      createdBy: Store.user.name, createdAt: now(), updatedAt: now(), isTest: !!data.isTest,
    };
    db.quotes.push(q); audit(db, 'CREATE', 'Quote', q); return q;
  });
  svc.updateQuote = (id, data) => mut('quotes.edit', (db) => {
    const q = must(db, 'quotes', id, 'Quote'); const before = clone(q);
    const status = data.status || q.status;
    if (!['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'SUPERSEDED'].includes(status)) fail('Invalid status');
    if (q.status === 'DRAFT') {
      if ('quotedPrice' in data) q.quotedPrice = dec(data.quotedPrice, 'quotedPrice', 'Quoted price', { gt: true, dp: 4 });
      if ('quoteDate' in data) q.quoteDate = date(data.quoteDate, 'quoteDate', 'Quote date');
    } else if (('quotedPrice' in data && data.quotedPrice !== q.quotedPrice) || ('quoteDate' in data && data.quoteDate !== q.quoteDate)) {
      fail('Price and date are locked once a quote has been sent. Create a revised quote instead.');
    }
    q.status = status; q.remarks = optStr(data.remarks !== undefined ? data.remarks : q.remarks); q.updatedAt = now();
    audit(db, 'UPDATE', 'Quote', q, before); return q;
  });
  svc.deleteQuote = (id) => mut('quotes.delete', (db) => {
    const q = must(db, 'quotes', id, 'Quote');
    if (q.status !== 'DRAFT') fail('Only draft quotes can be deleted');
    if (db.lines.some((l) => l.quoteId === id)) fail('Quote is linked to order confirmations');
    db.quotes = db.quotes.filter((x) => x.id !== id); audit(db, 'DELETE', 'Quote', q);
  });

  /* ---------- Purchase orders ---------- */
  svc.savePO = (data) => mut('orders.edit', (db) => {
    const buyer = must(db, 'buyers', data.buyerId, 'Buyer');
    const poNumber = reqStr(data.poNumber, 'poNumber', 'PO number', 60);
    if (db.pos.some((p) => p.id !== data.id && p.buyerId === buyer.id && lc(p.poNumber) === lc(poNumber))) fail(`PO ${poNumber} already exists for ${buyer.name}`, 'poNumber');
    const fields = { buyerId: buyer.id, poNumber, season: optStr(data.season, 40), poDate: date(data.poDate, 'poDate', 'PO date', false), remarks: optStr(data.remarks), status: ['OPEN', 'CLOSED', 'CANCELLED'].includes(data.status) ? data.status : 'OPEN' };
    if (data.id) {
      const p = must(db, 'pos', data.id, 'PO'); const before = clone(p);
      const lines = db.lines.filter((l) => l.poId === p.id);
      if (lines.length && p.buyerId !== buyer.id) fail('PO has order lines — buyer cannot be changed', 'buyerId');
      if (fields.status === 'CANCELLED' && lines.some((l) => lineMetrics(db, l).allocated > 0)) fail('PO has pool allocations — release them before cancelling');
      Object.assign(p, fields, { updatedAt: now() }); audit(db, 'UPDATE', 'PO', p, before); return p;
    }
    const p = Object.assign({ id: uid(), createdAt: now(), updatedAt: now(), isTest: !!data.isTest }, fields);
    db.pos.push(p); audit(db, 'CREATE', 'PO', p); return p;
  });
  svc.deletePO = (id) => mut('orders.delete', (db) => {
    const p = must(db, 'pos', id, 'PO');
    const n = db.lines.filter((l) => l.poId === id).length;
    if (n) fail(`PO ${p.poNumber} has ${n} order line(s). Delete or cancel them first, or set the PO status to Cancelled.`);
    db.pos = db.pos.filter((x) => x.id !== id); audit(db, 'DELETE', 'PO', p);
  });

  /* ---------- Order confirmations (PO lines) ---------- */
  svc.saveLine = (data) => mut('orders.edit', (db) => {
    const po = must(db, 'pos', data.poId, 'PO');
    if (po.status === 'CANCELLED') fail('PO is cancelled', 'poId');
    const st = must(db, 'styles', data.styleId, 'Style');
    if (st.buyerId !== po.buyerId) fail('Style belongs to a different buyer than the PO', 'styleId');
    const combo = reqStr(data.combo, 'combo', 'Combo / colour', 80);
    if (db.lines.some((l) => l.id !== data.id && l.poId === po.id && l.styleId === st.id && lc(l.combo) === lc(combo) && l.status !== 'CANCELLED')) fail(`${st.styleRef} / ${combo} already exists on PO ${po.poNumber}`, 'combo');
    const mode = data.qtyMode === 'MANUAL' ? 'MANUAL' : 'SIZE';
    const sizes = {};
    Object.entries(data.sizes || {}).forEach(([k, v]) => { if (str(v) !== '') sizes[k] = int(v, 'size_' + k, `Size ${k} qty`); });
    let orderQty;
    if (mode === 'SIZE') {
      orderQty = Calc.sizeTotal(sizes);
      if (orderQty <= 0) fail('Enter size-wise quantities (total must be greater than 0)', 'sizes');
    } else {
      if (!can('orders.manualQty')) fail('You are not permitted to enter order quantity manually');
      orderQty = int(data.manualQty, 'manualQty', 'Order quantity', { min: 1 });
      const st2 = Calc.sizeTotal(sizes);
      if (Object.keys(sizes).length && st2 !== orderQty) fail(`Size quantities total ${st2} but order quantity is ${orderQty}. They must match (or clear the sizes).`, 'manualQty');
    }
    let quote = null;
    if (data.quoteId) { quote = must(db, 'quotes', data.quoteId, 'Quote'); if (quote.styleId !== st.id) fail('Quote belongs to a different style', 'quoteId'); }
    const status = ['DRAFT', 'CONFIRMED', 'CANCELLED'].includes(data.status) ? data.status : 'CONFIRMED';
    const currency = reqStr(data.currency, 'currency', 'Currency');
    if (!db.currencies.some((c) => c.code === currency)) fail('Unknown currency', 'currency');
    const confirmedPrice = dec(data.confirmedPrice, 'confirmedPrice', 'Confirmed price', { gt: status === 'CONFIRMED', required: status === 'CONFIRMED', dp: 4 });
    if (status === 'CONFIRMED' && !quote) fail('Link the quotation (and its costing version) before confirming', 'quoteId');
    const fields = {
      poId: po.id, buyerId: po.buyerId, styleId: st.id, combo, qtyMode: mode, sizes, orderQty,
      quoteId: quote ? quote.id : null, costingId: quote ? quote.costingId : null, quotedPrice: quote ? quote.quotedPrice : null,
      confirmedPrice, currency, confirmationDate: date(data.confirmationDate, 'confirmationDate', 'Confirmation date', status === 'CONFIRMED'),
      remarks: optStr(data.remarks), status,
    };
    if (data.id) {
      const l = must(db, 'lines', data.id, 'Order line'); const before = clone(l);
      const m = lineMetrics(db, l);
      const closedAlloc = m.activeAllocs.some((a) => { const p = poolOf(db, a.poolId); return p && p.status === 'CLOSED'; });
      const finChange = fields.orderQty !== l.orderQty || fields.confirmedPrice !== l.confirmedPrice || fields.currency !== l.currency || fields.styleId !== l.styleId || fields.poId !== l.poId;
      if (closedAlloc && finChange) fail('This order is allocated to a closed pool — quantity, price, currency, style and PO are locked. Reopen the pool through the correction workflow first.');
      if (fields.orderQty < m.allocated) fail(`Order quantity cannot be less than the ${m.allocated} pcs already allocated to pools`, mode === 'SIZE' ? 'sizes' : 'manualQty');
      if ((fields.styleId !== l.styleId || fields.poId !== l.poId) && (m.allAllocs.length || m.shipments.length)) fail('Style / PO cannot be changed after allocation or shipment');
      if (fields.status === 'CANCELLED' && m.allocated > 0) fail('Release pool allocations before cancelling this order');
      if (fields.currency !== l.currency && m.activeAllocs.length) fail('Currency cannot be changed while the order is allocated to a pool');
      if (l.confirmedPrice !== fields.confirmedPrice || l.currency !== fields.currency) {
        db.priceHistory.push({ id: uid(), lineId: l.id, oldPrice: l.confirmedPrice, newPrice: fields.confirmedPrice, oldCurrency: l.currency, newCurrency: fields.currency, at: now(), by: Store.user.name, reason: optStr(data.changeReason) || null });
      }
      Object.assign(l, fields, { updatedAt: now() });
      // Active allocations in open pools carry the confirmed rate used for calculations.
      m.activeAllocs.forEach((a) => { a.price = l.confirmedPrice; a.currency = l.currency; });
      audit(db, 'UPDATE', 'OrderLine', l, before, optStr(data.changeReason) || null); return l;
    }
    const l = Object.assign({ id: uid(), confNo: nextNo(db, 'conf', 'OC'), createdAt: now(), updatedAt: now(), createdBy: Store.user.name, isTest: !!data.isTest }, fields);
    db.lines.push(l);
    if (l.confirmedPrice) db.priceHistory.push({ id: uid(), lineId: l.id, oldPrice: null, newPrice: l.confirmedPrice, oldCurrency: null, newCurrency: l.currency, at: now(), by: Store.user.name, reason: 'Initial confirmation' });
    audit(db, 'CREATE', 'OrderLine', l); return l;
  });
  svc.deleteLine = (id) => mut('orders.delete', (db) => {
    const l = must(db, 'lines', id, 'Order line'); const m = lineMetrics(db, l);
    if (m.allAllocs.length || m.shipments.length) fail(`Order ${l.confNo} has allocation history or shipments and cannot be deleted. Set its status to Cancelled instead (after releasing active allocations).`);
    db.lines = db.lines.filter((x) => x.id !== id); audit(db, 'DELETE', 'OrderLine', l);
  });

  /* ---------- Pools & allocations ---------- */
  svc.createPool = (data) => mut('pools.edit', (db) => {
    const buyer = must(db, 'buyers', data.buyerId, 'Buyer');
    const prefix = db.settings.poolPrefix || 'POOL';
    let poolNo; do { poolNo = nextNo(db, 'pool_' + prefix, prefix, 3); } while (db.pools.some((p) => p.poolNo === poolNo));
    const p = { id: uid(), poolNo, buyerId: buyer.id, season: optStr(data.season, 40), remarks: optStr(data.remarks), status: 'DRAFT', styleRef: {}, varianceOverride: null, createdBy: Store.user.name, createdAt: now(), updatedAt: now(), isTest: !!data.isTest };
    db.pools.push(p); audit(db, 'CREATE', 'Pool', p); return p;
  });
  svc.updatePool = (id, data) => mut('pools.edit', (db) => {
    const p = must(db, 'pools', id, 'Pool'); assertPoolEditable(db, id, 'pool details'); const before = clone(p);
    if ('season' in data) p.season = optStr(data.season, 40);
    if ('remarks' in data) p.remarks = optStr(data.remarks);
    p.updatedAt = now(); audit(db, 'UPDATE', 'Pool', p, before); return p;
  });
  /** Reference qty per style ("Total qty of all selected orders of this style — can be fed manually").
      REFERENCE ONLY: used as the default Paid Qty in expense entry. Expense limits always use allocated qty. */
  svc.setStyleRefQty = (poolId, styleId, qty, note) => mut('pools.edit', (db) => {
    const p = must(db, 'pools', poolId, 'Pool'); assertPoolEditable(db, poolId);
    const before = clone(p);
    if (str(qty) === '') delete p.styleRef[styleId];
    else p.styleRef[styleId] = { qty: int(qty, 'refQty', 'Reference quantity', { min: 0 }), note: optStr(note, 300), by: Store.user.name, at: now() };
    audit(db, 'UPDATE', 'Pool', p, before, 'Reference style quantity'); return p;
  });
  svc.setVarianceOverride = (poolId, pct, reason) => mut('pools.edit', (db) => {
    const p = must(db, 'pools', poolId, 'Pool'); assertPoolEditable(db, poolId, 'the variance'); const before = clone(p);
    if (str(pct) === '') p.varianceOverride = null;
    else p.varianceOverride = { pct: dec(pct, 'pct', 'Variance %', { min: -100, max: 1000, dp: 4 }), reason: reqStr(reason, 'reason', 'Reason for override', 500), by: Store.user.name, at: now() };
    audit(db, 'UPDATE', 'Pool', p, before, 'Costing variance override'); return p;
  });
  svc.allocate = (poolId, items) => mut('pools.allocate', (db) => {
    const p = must(db, 'pools', poolId, 'Pool'); assertPoolEditable(db, poolId, 'allocations');
    const list = (items || []).filter((i) => str(i.qty) !== '' && Number(i.qty) !== 0);
    if (!list.length) fail('Enter a quantity for at least one order line');
    const out = [];
    list.forEach((it) => {
      const l = must(db, 'lines', it.lineId, 'Order line');
      const po = byId(db, 'pos', l.poId); const st = byId(db, 'styles', l.styleId);
      const tag = `${po.poNumber} / ${st.styleRef} / ${l.combo}`;
      if (l.status !== 'CONFIRMED') fail(`${tag}: only confirmed orders can be pooled`);
      if (l.buyerId !== p.buyerId) fail(`${tag}: belongs to a different buyer`);
      const qty = int(it.qty, 'qty_' + l.id, `${tag} qty`, { min: 1 });
      if (db.allocations.some((a) => a.poolId === p.id && a.lineId === l.id && a.status === 'ACTIVE')) fail(`${tag} is already allocated to ${p.poolNo}. Edit the existing allocation instead.`);
      const m = lineMetrics(db, l); // computed inside the atomic commit → no double allocation
      if (qty > m.remainingPool) fail(`${tag}: only ${m.remainingPool} pcs available (order ${l.orderQty}, already allocated ${m.allocated})`);
      if (!db.settings.pool.allowPartialAllocation && qty !== m.remainingPool) fail(`${tag}: partial allocation is disabled — allocate the full remaining ${m.remainingPool} pcs`);
      const a = { id: uid(), poolId: p.id, lineId: l.id, qty, price: l.confirmedPrice, currency: l.currency, status: 'ACTIVE', createdBy: Store.user.name, createdAt: now(), history: [{ at: now(), by: Store.user.name, action: 'ALLOCATE', qty }] };
      db.allocations.push(a); out.push(a);
      audit(db, 'ALLOCATE', 'Allocation', Object.assign({ code: `${p.poolNo} ← ${tag}` }, a));
    });
    p.updatedAt = now();
    return out;
  });
  svc.editAllocation = (id, qty, reason) => mut('pools.allocate', (db) => {
    const a = must(db, 'allocations', id, 'Allocation'); if (a.status !== 'ACTIVE') fail('Allocation is released');
    assertPoolEditable(db, a.poolId, 'allocations');
    const l = byId(db, 'lines', a.lineId); const m = lineMetrics(db, l);
    const n = int(qty, 'qty', 'Quantity', { min: 1 });
    const max = m.remainingPool + a.qty;
    if (n > max) fail(`Only ${max} pcs available for this order line`, 'qty');
    const shippedInPool = db.shipments.filter((s) => s.lineId === l.id && s.poolId === a.poolId && !s.deletedAt).reduce((x, s) => x + s.shippedQty, 0);
    if (shippedInPool > 0 && n < Math.min(shippedInPool, l.orderQty)) fail(`${shippedInPool} pcs have already been shipped against this allocation`, 'qty');
    const before = clone(a);
    a.history.push({ at: now(), by: Store.user.name, action: 'EDIT', from: a.qty, qty: n, reason: optStr(reason) });
    a.qty = n; audit(db, 'UPDATE', 'Allocation', a, before, reason); return a;
  });
  /** Released allocations no longer count against the PO line (rule: Remaining = Order − Σ ACTIVE allocations,
      in DRAFT/ACTIVE/CLOSED pools). History is kept. */
  svc.releaseAllocation = (id, reason) => mut('pools.release', (db) => {
    const a = must(db, 'allocations', id, 'Allocation'); if (a.status !== 'ACTIVE') fail('Already released');
    assertPoolEditable(db, a.poolId, 'allocations');
    const why = reqStr(reason, 'reason', 'Release reason', 500);
    if (db.shipments.some((s) => s.lineId === a.lineId && s.poolId === a.poolId && !s.deletedAt)) fail('Shipments exist for this order in the pool — delete or move them before releasing');
    const before = clone(a);
    a.status = 'RELEASED'; a.releasedAt = now(); a.releasedBy = Store.user.name; a.releaseReason = why;
    a.history.push({ at: now(), by: Store.user.name, action: 'RELEASE', qty: a.qty, reason: why });
    audit(db, 'RELEASE', 'Allocation', a, before, why); return a;
  });
  svc.activatePool = (id) => mut('pools.edit', (db) => {
    const p = must(db, 'pools', id, 'Pool');
    if (p.status !== 'DRAFT') fail('Only draft pools can be activated');
    const allocs = db.allocations.filter((a) => a.poolId === id && a.status === 'ACTIVE');
    if (!allocs.length) fail('Allocate at least one order line before activating the pool');
    allocs.forEach((a) => {
      const l = byId(db, 'lines', a.lineId);
      if (l.status !== 'CONFIRMED') fail(`Order ${l.confNo} is no longer confirmed`);
      if (!l.costingId) fail(`Order ${l.confNo} has no linked costing version`);
      if (lineMetrics(db, l).remainingPool < 0) fail(`Order ${l.confNo} is over-allocated`);
    });
    const before = clone(p); p.status = 'ACTIVE'; p.activatedAt = now(); p.updatedAt = now();
    audit(db, 'ACTIVATE', 'Pool', p, before); return p;
  });
  svc.cancelPool = (id, reason) => mut('pools.edit', (db) => {
    const p = must(db, 'pools', id, 'Pool');
    if (p.status === 'CLOSED') fail('Closed pools cannot be cancelled');
    const why = reqStr(reason, 'reason', 'Reason', 500);
    const has = db.shipments.some((s) => s.poolId === id && !s.deletedAt) || db.expenses.some((e) => e.poolId === id && !e.deletedAt) || db.adjustments.some((x) => x.poolId === id && !x.deletedAt);
    if (has) fail('Pool has shipments, expenses or adjustments — it cannot be cancelled');
    const before = clone(p);
    db.allocations.filter((a) => a.poolId === id && a.status === 'ACTIVE').forEach((a) => {
      a.status = 'RELEASED'; a.releasedAt = now(); a.releasedBy = Store.user.name; a.releaseReason = 'Pool cancelled: ' + why;
      a.history.push({ at: now(), by: Store.user.name, action: 'RELEASE', qty: a.qty, reason: 'Pool cancelled' });
    });
    p.status = 'CANCELLED'; p.updatedAt = now(); audit(db, 'CANCEL', 'Pool', p, before, why);
  });

  /* ---------- Expenses ---------- */
  function paymentStatus(e) {
    const paid = sum(e.payments || [], (p) => D(p.amount));
    if (paid.isZero()) return 'UNPAID';
    return paid.gte(e.amount) ? 'PAID' : 'PARTIAL';
  }
  svc.saveExpense = (data) => mut('expenses.edit', (db) => {
    const p = must(db, 'pools', data.poolId, 'Pool'); assertPoolEditable(db, p.id, 'expenses');
    if (p.status === 'DRAFT') fail('Activate the pool before entering expenses');
    const cats = categories(db).map((c) => c.key);
    if (!cats.includes(data.category)) fail('Select a category', 'category');
    const poolStyles = new Set(db.allocations.filter((a) => a.poolId === p.id && a.status === 'ACTIVE').map((a) => byId(db, 'lines', a.lineId).styleId));
    const styleId = data.styleId || null;
    if (styleId && !poolStyles.has(styleId)) fail('Style is not part of this pool', 'styleId');
    const qty = dec(data.qty, 'qty', data.category === 'FABRIC' ? 'Used weight / quantity' : 'Paid quantity', { min: 0, dp: 4 });
    const rate = dec(data.rate, 'rate', 'Rate', { min: 0, dp: 4 });
    const unit = optStr(data.unit, 20);
    if (unit && !db.settings.units.includes(unit)) fail(`Unit "${unit}" is not configured`, 'unit');
    if (data.category === 'FABRIC' && !unit) fail('Unit is required for fabric', 'unit');
    const calcAmount = D(qty).mul(rate).round(2).toString();
    const billAmount = str(data.billAmount) === '' ? null : dec(data.billAmount, 'billAmount', 'Bill amount', { min: 0, dp: 2 });
    const amount = billAmount !== null ? billAmount : calcAmount;
    if (!D(amount).gt(0) && data.status !== 'DRAFT') fail('Amount must be greater than zero (enter qty × rate or a bill amount)', 'billAmount');
    const fields = {
      poolId: p.id, styleId, category: data.category, source: data.source === 'COSTING' ? 'COSTING' : 'MANUAL', costingRef: optStr(data.costingRef, 200),
      itemName: reqStr(data.itemName, 'itemName', 'Item / description', 200), colour: optStr(data.colour, 80), spec: optStr(data.spec, 300),
      qty, unit, rate, calcAmount, billAmount, amount, vendor: optStr(data.vendor, 200), billRef: optStr(data.billRef, 80),
      billDate: date(data.billDate, 'billDate', 'Bill date', false), factory: optStr(data.factory, 200),
      sourcing: ['INHOUSE', 'OUTSOURCED'].includes(data.sourcing) ? data.sourcing : null,
      remarks: optStr(data.remarks), status: data.status === 'DRAFT' ? 'DRAFT' : 'SAVED',
    };
    if (data.category === 'CMT' && !fields.sourcing) fail('Select in-house or outsourced', 'sourcing');
    if (fields.billRef && db.expenses.some((e) => !e.deletedAt && e.id !== data.id && e.poolId === p.id && lc(e.billRef) === lc(fields.billRef) && lc(e.vendor) === lc(fields.vendor) && e.category === fields.category && e.styleId === fields.styleId && e.itemName === fields.itemName)) fail('An identical bill (vendor + bill ref + item) is already recorded — possible duplicate', 'billRef');
    if ('attachment' in data) {
      if (data.attachment && !db.settings.attachments.enabled) fail('Bill attachments are disabled in Settings');
      fields.attachment = data.attachment || null;
    }
    if (data.id) {
      const e = must(db, 'expenses', data.id, 'Expense'); if (e.deletedAt) fail('Expense was deleted');
      assertPoolEditable(db, e.poolId, 'expenses');
      const before = clone(e); Object.assign(e, fields, { updatedAt: now(), updatedBy: Store.user.name });
      e.paymentStatus = paymentStatus(e);
      if (sum(e.payments, (x) => D(x.amount)).gt(e.amount)) fail('Payments recorded exceed the new amount');
      audit(db, 'UPDATE', 'Expense', e, before); return e;
    }
    const e = Object.assign({ id: uid(), expNo: nextNo(db, 'exp', 'EXP'), payments: [], attachment: null, createdBy: Store.user.name, createdAt: now(), updatedAt: now(), isTest: !!data.isTest }, fields);
    e.paymentStatus = paymentStatus(e);
    db.expenses.push(e); audit(db, 'CREATE', 'Expense', e); return e;
  });
  svc.duplicateExpense = (id, targetStyleId) => mut('expenses.edit', (db) => {
    const src = must(db, 'expenses', id, 'Expense'); assertPoolEditable(db, src.poolId, 'expenses');
    const e = Object.assign(clone(src), { id: uid(), expNo: nextNo(db, 'exp', 'EXP'), payments: [], paymentStatus: 'UNPAID', attachment: null, billRef: '', status: 'DRAFT', createdBy: Store.user.name, createdAt: now(), updatedAt: now() });
    if (targetStyleId !== undefined) e.styleId = targetStyleId || null;
    db.expenses.push(e); audit(db, 'DUPLICATE', 'Expense', e, null, `Copied from ${src.expNo}`); return e;
  });
  /** Copy a style's fabric table to another style (or the shared section) as DRAFT rows for editing. */
  svc.copyExpenseTable = (poolId, category, fromStyleId, toStyleId) => mut('expenses.edit', (db) => {
    assertPoolEditable(db, poolId, 'expenses');
    const rows = db.expenses.filter((e) => e.poolId === poolId && !e.deletedAt && e.category === category && (e.styleId || null) === (fromStyleId || null));
    if (!rows.length) fail('Nothing to copy');
    if ((fromStyleId || null) === (toStyleId || null)) fail('Choose a different target style');
    rows.forEach((src) => {
      const e = Object.assign(clone(src), { id: uid(), expNo: nextNo(db, 'exp', 'EXP'), styleId: toStyleId || null, payments: [], paymentStatus: 'UNPAID', attachment: null, billRef: '', status: 'DRAFT', createdBy: Store.user.name, createdAt: now(), updatedAt: now() });
      db.expenses.push(e); audit(db, 'COPY', 'Expense', e, null, `Copied from ${src.expNo}`);
    });
    return rows.length;
  });
  svc.deleteExpense = (id, reason) => mut('expenses.delete', (db) => {
    const e = must(db, 'expenses', id, 'Expense'); assertPoolEditable(db, e.poolId, 'expenses');
    const before = clone(e);
    if (e.status === 'DRAFT' && !(e.payments || []).length) { db.expenses = db.expenses.filter((x) => x.id !== id); audit(db, 'DELETE', 'Expense', before); return; }
    e.deletedAt = now(); e.deletedBy = Store.user.name; e.deleteReason = reqStr(reason, 'reason', 'Reason for deleting a saved expense', 500);
    audit(db, 'DELETE', 'Expense', e, before, e.deleteReason);
  });
  svc.addPayment = (expenseId, data) => mut('expenses.edit', (db) => {
    const e = must(db, 'expenses', expenseId, 'Expense'); assertPoolEditable(db, e.poolId, 'payments');
    const before = clone(e);
    const pmt = { id: uid(), date: date(data.date, 'date', 'Payment date'), amount: dec(data.amount, 'amount', 'Payment amount', { gt: true, dp: 2 }), ref: optStr(data.ref, 100), by: Store.user.name, at: now() };
    const paid = sum(e.payments, (x) => D(x.amount)).add(pmt.amount);
    if (paid.gt(e.amount)) fail(`Total payments (${Fmt.inr(paid.toString())}) would exceed the bill amount (${Fmt.inr(e.amount)})`, 'amount');
    e.payments.push(pmt); e.paymentStatus = paymentStatus(e); e.updatedAt = now();
    audit(db, 'PAYMENT', 'Expense', e, before); return pmt;
  });
  svc.removePayment = (expenseId, paymentId) => mut('expenses.edit', (db) => {
    const e = must(db, 'expenses', expenseId, 'Expense'); assertPoolEditable(db, e.poolId, 'payments');
    const before = clone(e); e.payments = e.payments.filter((x) => x.id !== paymentId); e.paymentStatus = paymentStatus(e);
    audit(db, 'PAYMENT_REMOVE', 'Expense', e, before);
  });

  /* ---------- Missing / additional items ---------- */
  svc.saveException = (data) => mut('exceptions.edit', (db) => {
    const p = must(db, 'pools', data.poolId, 'Pool'); assertPoolEditable(db, p.id, 'item exceptions');
    const type = data.type === 'ADDITIONAL' ? 'ADDITIONAL' : 'MISSING';
    if (!categories(db).some((c) => c.key === data.category)) fail('Select a category', 'category');
    const styleId = reqStr(data.styleId, 'styleId', 'Style');
    const poolStyles = new Set(db.allocations.filter((a) => a.poolId === p.id && a.status === 'ACTIVE').map((a) => byId(db, 'lines', a.lineId).styleId));
    if (!poolStyles.has(styleId)) fail('Style is not part of this pool', 'styleId');
    let replacesId = data.replacesId || null;
    if (replacesId) {
      const r = must(db, 'exceptions', replacesId, 'Linked item');
      if (r.poolId !== p.id || r.type !== 'MISSING' || type !== 'ADDITIONAL') fail('Only an additional item can be linked as the replacement of a missing item in the same pool', 'replacesId');
    }
    const fields = { poolId: p.id, styleId, type, category: data.category, itemName: reqStr(data.itemName, 'itemName', type === 'MISSING' ? 'Missing item' : 'Additional item'), reason: reqStr(data.reason, 'reason', 'Reason', 500), date: date(data.date || today(), 'date', 'Date'), replacesId, remarks: optStr(data.remarks) };
    if (data.id) {
      const x = must(db, 'exceptions', data.id, 'Item'); if (x.status !== 'PENDING') fail('Decided items cannot be edited. Reopen the decision first.');
      const before = clone(x); Object.assign(x, fields, { updatedAt: now() }); audit(db, 'UPDATE', 'ItemException', x, before); return x;
    }
    const x = Object.assign({ id: uid(), excNo: nextNo(db, 'exc', 'EXC'), status: 'PENDING', createdBy: Store.user.name, createdAt: now(), updatedAt: now(), isTest: !!data.isTest }, fields);
    db.exceptions.push(x); audit(db, 'CREATE', 'ItemException', x); return x;
  });
  svc.decideException = (id, status, remarks) => mut('exceptions.decide', (db) => {
    const x = must(db, 'exceptions', id, 'Item'); assertPoolEditable(db, x.poolId, 'item decisions');
    if (!['ACCEPTED', 'REJECTED', 'RESOLVED', 'PENDING'].includes(status)) fail('Invalid decision');
    if (status === 'REJECTED' && !str(remarks)) fail('Give a reason for rejecting', 'remarks');
    const before = clone(x);
    x.status = status; x.decisionRemarks = optStr(remarks);
    x.decidedAt = status === 'PENDING' ? null : now(); x.decidedBy = status === 'PENDING' ? null : Store.user.name;
    audit(db, status === 'PENDING' ? 'REOPEN_DECISION' : 'DECIDE_' + status, 'ItemException', x, before, remarks); return x;
  });
  svc.deleteException = (id) => mut('exceptions.edit', (db) => {
    const x = must(db, 'exceptions', id, 'Item'); assertPoolEditable(db, x.poolId, 'item exceptions');
    if (x.status !== 'PENDING' || x.decidedAt) fail('Only undecided (draft) items can be deleted — decided items are kept for audit');
    if (db.exceptions.some((y) => y.replacesId === id)) fail('Another item is linked as the replacement of this item');
    db.exceptions = db.exceptions.filter((y) => y.id !== id); audit(db, 'DELETE', 'ItemException', x);
  });

  /* ---------- Shipments ---------- */
  svc.saveShipment = (data) => mut('shipments.edit', (db) => {
    const l = must(db, 'lines', data.lineId, 'Order line');
    if (l.status !== 'CONFIRMED') fail('Shipments can only be recorded against confirmed orders', 'lineId');
    const poolId = data.poolId || null;
    if (poolId) {
      assertPoolEditable(db, poolId, 'shipments');
      if (!db.allocations.some((a) => a.poolId === poolId && a.lineId === l.id && a.status === 'ACTIVE')) fail('This order line is not allocated to the selected pool', 'poolId');
      const p = poolOf(db, poolId); if (p.status === 'DRAFT') fail('Activate the pool before recording shipments', 'poolId');
    }
    const qty = int(data.shippedQty, 'shippedQty', 'Shipped quantity', { min: 1 });
    const shipmentDate = date(data.shipmentDate, 'shipmentDate', 'Shipment date');
    const exchangeRate = dec(data.exchangeRate, 'exchangeRate', 'Exchange rate (INR per unit)', { gt: true, dp: 4 });
    const rateDate = date(data.rateDate, 'rateDate', 'Exchange-rate date');
    let rateId = data.rateId || null;
    if (rateId) { const r = byId(db, 'rates', rateId); if (!r || r.currency !== l.currency || r.inrPerUnit !== exchangeRate || r.effectiveDate !== rateDate) rateId = null; }
    const unitPrice = l.confirmedPrice; // confirmed selling price, frozen on the shipment
    const v = Calc.shipmentValues(qty, unitPrice, exchangeRate);
    const others = db.shipments.filter((s) => s.lineId === l.id && !s.deletedAt && s.id !== data.id);
    const cumulative = others.reduce((a, s) => a + s.shippedQty, 0) + qty;
    const maxExcess = D(l.orderQty).mul(D(1).add(D(db.settings.shipment.maxExcessPct).div(100))).toNumber();
    let excessAccepted = !!data.excessAccepted;
    if (cumulative > maxExcess) {
      if (!excessAccepted) fail(`Total shipped (${cumulative}) exceeds the order (${l.orderQty}) by more than the allowed ${db.settings.shipment.maxExcessPct}%. Tick "commercially accepted" with a reference to proceed.`, 'shippedQty');
      if (!can('shipments.acceptExcess')) fail('You are not permitted to accept excess shipments');
      if (!str(data.excessRef)) fail('Enter the buyer acceptance reference for the excess', 'excessRef');
    } else excessAccepted = false;
    const isFinal = !!data.isFinal || cumulative >= l.orderQty;
    const diff = isFinal ? Calc.qtyDifference(cumulative, l.orderQty) : null;
    const reason = optStr(data.differenceReason, 500);
    if (isFinal && diff !== 0 && !reason) fail(`Order ${l.orderQty} vs shipped ${cumulative}: ${diff < 0 ? 'shortage' : 'excess'} of ${Math.abs(diff)} pcs — a reason is required`, 'differenceReason');
    const invoiceRef = optStr(data.invoiceRef, 80);
    const dup = others.find((s) => (invoiceRef && lc(s.invoiceRef) === lc(invoiceRef)) || (!invoiceRef && !s.invoiceRef && s.shipmentDate === shipmentDate && s.shippedQty === qty));
    if (dup) fail(`Possible duplicate of shipment ${dup.shipNo} (same ${invoiceRef ? 'invoice reference' : 'date and quantity'}) for this order line`, invoiceRef ? 'invoiceRef' : 'shipmentDate');
    const fields = {
      poolId, lineId: l.id, poId: l.poId, styleId: l.styleId, buyerId: l.buyerId, shippedQty: qty, shipmentDate,
      unitPrice, currency: l.currency, exchangeRate, rateDate, rateId, rateSource: rateId ? 'TABLE' : 'MANUAL',
      foreignValue: v.foreign, inrValue: v.inr, isFinal, cumulativeShipped: cumulative, diffQty: diff,
      differenceReason: reason, excessAccepted, excessRef: excessAccepted ? optStr(data.excessRef, 100) : '', invoiceRef, remarks: optStr(data.remarks),
      calcMethod: 'Foreign = Qty × Confirmed Price; INR = Foreign × Rate (2 dp)',
    };
    if (data.id) {
      const s = must(db, 'shipments', data.id, 'Shipment'); if (s.deletedAt) fail('Shipment was deleted');
      assertPoolEditable(db, s.poolId, 'shipments');
      const before = clone(s); Object.assign(s, fields, { updatedAt: now(), updatedBy: Store.user.name });
      audit(db, 'UPDATE', 'Shipment', s, before); return s;
    }
    const s = Object.assign({ id: uid(), shipNo: nextNo(db, 'ship', 'SH'), createdBy: Store.user.name, createdAt: now(), updatedAt: now(), isTest: !!data.isTest }, fields);
    db.shipments.push(s); audit(db, 'CREATE', 'Shipment', s); return s;
  });
  svc.deleteShipment = (id, reason) => mut('shipments.delete', (db) => {
    const s = must(db, 'shipments', id, 'Shipment'); assertPoolEditable(db, s.poolId, 'shipments');
    const before = clone(s); s.deletedAt = now(); s.deletedBy = Store.user.name; s.deleteReason = reqStr(reason, 'reason', 'Reason', 500);
    audit(db, 'DELETE', 'Shipment', s, before, s.deleteReason);
  });

  /* ---------- Additions / deductions ---------- */
  svc.saveAdjustment = (data) => mut('adjustments.edit', (db) => {
    const p = must(db, 'pools', data.poolId, 'Pool'); assertPoolEditable(db, p.id, 'adjustments');
    const fields = {
      poolId: p.id, type: data.type === 'DEDUCTION' ? 'DEDUCTION' : 'ADDITION',
      amount: dec(data.amount, 'amount', 'Amount (INR)', { gt: true, dp: 2 }), reason: reqStr(data.reason, 'reason', 'Reason', 500),
      date: date(data.date, 'date', 'Date'), reference: optStr(data.reference, 100),
    };
    if (data.id) {
      const x = must(db, 'adjustments', data.id, 'Adjustment'); const before = clone(x);
      Object.assign(x, fields, { updatedAt: now() }); audit(db, 'UPDATE', 'Adjustment', x, before); return x;
    }
    const x = Object.assign({ id: uid(), adjNo: nextNo(db, 'adj', 'ADJ'), createdBy: Store.user.name, createdAt: now(), isTest: !!data.isTest }, fields);
    db.adjustments.push(x); audit(db, 'CREATE', 'Adjustment', x); return x;
  });
  svc.deleteAdjustment = (id, reason) => mut('adjustments.edit', (db) => {
    const x = must(db, 'adjustments', id, 'Adjustment'); assertPoolEditable(db, x.poolId, 'adjustments');
    const before = clone(x); x.deletedAt = now(); x.deletedBy = Store.user.name; x.deleteReason = reqStr(reason, 'reason', 'Reason', 500);
    audit(db, 'DELETE', 'Adjustment', x, before, x.deleteReason);
  });

  /* ======================= POOL ENGINE ======================= */
  /** Computes everything for a pool from source records. Used by expense limits, shipment summary,
      profitability, dashboard and closure — so all screens reconcile. */
  function computePool(db, poolId) {
    const pool = byId(db, 'pools', poolId);
    if (!pool) return null;
    const errors = [];
    const cats = categories(db);
    const buyer = byId(db, 'buyers', pool.buyerId);
    const allocs = db.allocations.filter((a) => a.poolId === poolId && a.status === 'ACTIVE').map((a) => {
      const line = byId(db, 'lines', a.lineId); const po = byId(db, 'pos', line.poId); const style = byId(db, 'styles', line.styleId);
      const costing = line.costingId ? byId(db, 'costings', line.costingId) : null;
      if (!costing) errors.push(`Order ${line.confNo} (${style.styleRef}) has no linked costing version`);
      return { a, line, po, style, costing };
    });
    // ---- styles ----
    const styleMap = new Map();
    allocs.forEach((x) => {
      if (!styleMap.has(x.style.id)) styleMap.set(x.style.id, { style: x.style, allocQty: 0, value: D(0), rows: [] });
      const s = styleMap.get(x.style.id); s.allocQty += x.a.qty; s.value = s.value.add(D(x.a.qty).mul(x.a.price)); s.rows.push(x);
    });
    // ---- costing variance ----
    const vset = db.settings.variance;
    const styleVar = [];
    styleMap.forEach((s) => {
      const parts = [];
      s.rows.forEach((x) => {
        if (!x.costing || !x.costing.results || !D(x.costing.results.totalInr).gt(0)) return;
        let pct;
        try { pct = Calc.styleVariancePct(x.a.price, x.costing.exchangeRate, x.costing.results.totalInr); } catch (e) { errors.push(e.message); return; }
        parts.push({ pct, qty: x.a.qty, value: D(x.a.qty).mul(x.a.price), costingLabel: x.costing.label, costingPrice: x.costing.results.foreignPrice, costingInr: x.costing.results.totalInr, rate: x.costing.exchangeRate, confirmed: x.a.price });
      });
      const pct = parts.length ? Calc.aggregateVariance(parts.map((p) => ({ pct: p.pct, qty: p.qty, value: p.value })), 'QTY_WEIGHTED') : D(0);
      styleVar.push({ styleId: s.style.id, styleRef: s.style.styleRef, qty: s.allocQty, value: s.value.toString(), pct: pct.toString(), parts: parts.map((p) => Object.assign({}, p, { pct: p.pct.toString(), value: p.value.toString() })) });
    });
    const computedPoolPct = Calc.aggregateVariance(styleVar.map((v) => ({ pct: v.pct, qty: v.qty, value: v.value })), vset.method).toString();
    const override = pool.varianceOverride;
    const pctFor = (styleId) => {
      if (override) return override.pct;
      if (vset.scope === 'STYLE') return (styleVar.find((v) => v.styleId === styleId) || { pct: '0' }).pct;
      return computedPoolPct;
    };
    // ---- expenses (actual = SAVED, not deleted) ----
    const exps = db.expenses.filter((e) => e.poolId === poolId && !e.deletedAt);
    const saved = exps.filter((e) => e.status === 'SAVED');
    const drafts = exps.filter((e) => e.status === 'DRAFT');
    // ---- limits per style × category ----
    const limits = [];
    styleMap.forEach((s) => {
      const vp = pctFor(s.style.id);
      cats.forEach((c) => {
        let base = D(0); let anyCost = false;
        s.rows.forEach((x) => {
          if (!x.costing || !x.costing.results) return;
          const cpp = D(x.costing.results.categories[c.key] || 0);
          if (!cpp.isZero()) anyCost = true;
          base = base.add(D(x.a.qty).mul(cpp));
        });
        const apply = vset.categories.includes(c.key);
        const limit = base.mul(D(1).add(apply ? D(vp).div(100) : D(0))).round(2);
        const actual = sum(saved.filter((e) => e.styleId === s.style.id && e.category === c.key), (e) => D(e.amount));
        if (!anyCost && actual.isZero()) return;
        const d = Calc.expenseDifference(limit, actual);
        limits.push({
          styleId: s.style.id, styleRef: s.style.styleRef, category: c.key, categoryLabel: c.label, qty: s.allocQty,
          costPerPiece: s.allocQty ? base.div(s.allocQty).round(2).toString() : '0', variancePct: apply ? vp : '0', varianceApplied: apply,
          limit: limit.toString(), actual: actual.toString(), diff: d.diff, diffPct: d.pct, status: d.status,
        });
      });
    });
    // shared (pool-level) expenses with no style
    cats.forEach((c) => {
      const actual = sum(saved.filter((e) => !e.styleId && e.category === c.key), (e) => D(e.amount));
      if (actual.isZero()) return;
      const d = Calc.expenseDifference(0, actual);
      limits.push({ styleId: null, styleRef: 'Shared (all pool styles)', category: c.key, categoryLabel: c.label, qty: null, costPerPiece: null, variancePct: null, varianceApplied: false, limit: '0', actual: actual.toString(), diff: d.diff, diffPct: null, status: d.status });
    });
    const byCat = cats.map((c) => {
      const rows = limits.filter((l) => l.category === c.key);
      const limit = sum(rows, (r) => D(r.limit)); const actual = sum(rows, (r) => D(r.actual));
      const d = Calc.expenseDifference(limit, actual);
      return { category: c.key, label: c.label, limit: limit.toString(), actual: actual.toString(), diff: d.diff, diffPct: d.pct, status: d.status, entries: saved.filter((e) => e.category === c.key).length };
    }).filter((r) => !D(r.limit).isZero() || !D(r.actual).isZero());
    const totalLimits = sum(byCat, (r) => D(r.limit));
    const totalActual = sum(byCat, (r) => D(r.actual));
    // ---- shipments ----
    const ships = db.shipments.filter((s) => s.poolId === poolId && !s.deletedAt);
    const summaryRows = allocs.map((x) => {
      const ls = ships.filter((s) => s.lineId === x.line.id);
      const shipped = ls.reduce((a, s) => a + s.shippedQty, 0);
      return {
        lineId: x.line.id, confNo: x.line.confNo, poNumber: x.po.poNumber, styleId: x.style.id, styleRef: x.style.styleRef, description: x.style.description,
        combo: x.line.combo, orderQty: x.line.orderQty, allocQty: x.a.qty, price: x.a.price, currency: x.a.currency, shipped,
        diff: ls.length ? shipped - x.a.qty : null, final: ls.some((s) => s.isFinal),
        foreign: sum(ls, (s) => D(s.foreignValue)).toString(), inr: sum(ls, (s) => D(s.inrValue)).toString(), shipments: ls,
      };
    });
    const totalInrShip = sum(ships, (s) => D(s.inrValue));
    const foreignByCur = {};
    ships.forEach((s) => { foreignByCur[s.currency] = D(foreignByCur[s.currency] || 0).add(s.foreignValue).toString(); });
    const adjs = db.adjustments.filter((x) => x.poolId === poolId && !x.deletedAt);
    const additions = sum(adjs.filter((x) => x.type === 'ADDITION'), (x) => D(x.amount));
    const deductions = sum(adjs.filter((x) => x.type === 'DEDUCTION'), (x) => D(x.amount));
    const inrReceived = Calc.adjustedInr(totalInrShip, additions, deductions);
    const margins = Calc.margins({ inrReceived, totalLimits, totalActual });
    // ---- style-wise profitability (pool-level adjustments & shared expenses are NOT allocated to styles) ----
    const styleProfit = Array.from(styleMap.values()).map((s) => {
      const inr = sum(ships.filter((x) => x.styleId === s.style.id), (x) => D(x.inrValue));
      const lim = sum(limits.filter((l) => l.styleId === s.style.id), (l) => D(l.limit));
      const act = sum(limits.filter((l) => l.styleId === s.style.id), (l) => D(l.actual));
      return { styleId: s.style.id, styleRef: s.style.styleRef, description: s.style.description, allocQty: s.allocQty, shipped: ships.filter((x) => x.styleId === s.style.id).reduce((a, x) => a + x.shippedQty, 0), inr: inr.toString(), limit: lim.toString(), actual: act.toString(), budgetMargin: inr.sub(lim).toString(), actualMargin: inr.sub(act).toString() };
    });
    const exc = db.exceptions.filter((x) => x.poolId === poolId);
    return {
      pool, buyer, errors,
      allocations: allocs.map((x) => ({ id: x.a.id, lineId: x.line.id, confNo: x.line.confNo, poNumber: x.po.poNumber, styleId: x.style.id, styleRef: x.style.styleRef, combo: x.line.combo, orderQty: x.line.orderQty, qty: x.a.qty, price: x.a.price, currency: x.a.currency, costing: x.costing ? x.costing.label : null })),
      styles: Array.from(styleMap.values()).map((s) => ({ styleId: s.style.id, styleRef: s.style.styleRef, description: s.style.description, allocQty: s.allocQty, refQty: pool.styleRef[s.style.id] || null })),
      variance: { method: vset.method, scope: vset.scope, approved: vset.approved, categories: vset.categories, computedPoolPct, override, styles: styleVar, applied: override ? override.pct : vset.scope === 'STYLE' ? 'per style' : computedPoolPct },
      limits, byCat, expenses: { saved: saved.length, drafts: drafts.length, draftList: drafts, unpaid: saved.filter((e) => e.paymentStatus !== 'PAID').length },
      shipments: { rows: summaryRows, list: ships, totalQty: ships.reduce((a, s) => a + s.shippedQty, 0), foreignByCur, totalInr: totalInrShip.toString() },
      adjustments: { list: adjs, additions: additions.toString(), deductions: deductions.toString() },
      totals: {
        orderQty: allocs.reduce((a, x) => a + x.a.qty, 0), shippedQty: ships.reduce((a, s) => a + s.shippedQty, 0),
        shipmentInr: totalInrShip.toString(), additions: additions.toString(), deductions: deductions.toString(),
        inrReceived: inrReceived.toString(), totalLimits: totalLimits.toString(), totalActual: totalActual.toString(),
        expenseDiff: totalLimits.sub(totalActual).toString(), expenseDiffPct: totalLimits.isZero() ? null : totalLimits.sub(totalActual).div(totalLimits).mul(100).round(2).toString(),
      },
      margins, styleProfit,
      exceptions: { total: exc.length, pending: exc.filter((x) => x.status === 'PENDING').length, rejected: exc.filter((x) => x.status === 'REJECTED').length, missing: exc.filter((x) => x.type === 'MISSING').length, additional: exc.filter((x) => x.type === 'ADDITIONAL').length },
    };
  }

  /* ---------- Closure ---------- */
  function closureChecks(db, poolId) {
    const r = computePool(db, poolId);
    const p = r.pool;
    const chk = [];
    const add = (key, label, ok, problems, link) => chk.push({ key, label, ok, problems: problems || [], link });
    // 1 orders entered
    const p1 = [];
    if (!r.allocations.length) p1.push('No orders are allocated to this pool');
    r.allocations.forEach((a) => { const l = byId(db, 'lines', a.lineId); if (l.status !== 'CONFIRMED') p1.push(`${a.confNo} is not confirmed`); if (!D(l.confirmedPrice || 0).gt(0)) p1.push(`${a.confNo} has no confirmed price`); });
    if (p.status === 'DRAFT') p1.push('Pool is still in draft — activate it after all orders are entered');
    add('orders', 'All pool orders are entered and confirmed', !p1.length, p1, `#/pools/view?id=${p.id}`);
    // 2 allocations valid
    const p2 = [];
    db.allocations.filter((a) => a.poolId === poolId && a.status === 'ACTIVE').forEach((a) => {
      const l = byId(db, 'lines', a.lineId); const m = lineMetrics(db, l);
      if (m.remainingPool < 0) p2.push(`${l.confNo} is over-allocated by ${-m.remainingPool} pcs`);
      if (a.qty <= 0) p2.push(`${l.confNo} has a zero allocation`);
    });
    add('allocations', 'Pool allocations are valid (no over-allocation)', !p2.length, p2, `#/pools/view?id=${p.id}`);
    // 3 shipments
    const p3 = [];
    r.shipments.rows.forEach((row) => {
      if (!row.shipments.length) p3.push(`${row.poNumber} / ${row.styleRef} / ${row.combo}: no shipment recorded`);
      else if (db.settings.shipment.requireFinalForClosure && !row.final) p3.push(`${row.poNumber} / ${row.styleRef} / ${row.combo}: no final shipment marked`);
    });
    add('shipments', 'Required shipment entries are present', !p3.length, p3, `#/shipments?pool=${p.id}`);
    // 4/5 exceptions
    const exc = db.exceptions.filter((x) => x.poolId === poolId);
    const undecided = (t) => exc.filter((x) => x.type === t && !['ACCEPTED', 'RESOLVED'].includes(x.status)).map((x) => `${x.excNo} ${x.itemName} (${byId(db, 'styles', x.styleId).styleRef}) — ${x.status.toLowerCase()}`);
    const p4 = undecided('MISSING'), p5 = undecided('ADDITIONAL');
    add('missing', 'All missing-item decisions completed (accepted / resolved)', !p4.length, p4, `#/exceptions?pool=${p.id}`);
    add('additional', 'All additional-item decisions completed (accepted / resolved)', !p5.length, p5, `#/exceptions?pool=${p.id}`);
    // 6 expenses valid
    const p6 = [];
    r.expenses.draftList.forEach((e) => p6.push(`${e.expNo} ${e.itemName} is still a draft`));
    db.expenses.filter((e) => e.poolId === poolId && !e.deletedAt && e.status === 'SAVED').forEach((e) => {
      const expect = e.billAmount !== null && e.billAmount !== undefined ? D(e.billAmount) : D(e.qty).mul(e.rate).round(2);
      if (!expect.eq(e.amount)) p6.push(`${e.expNo}: stored amount does not match its inputs`);
      if (!D(e.amount).gt(0)) p6.push(`${e.expNo}: amount is zero`);
    });
    if (!r.expenses.saved) p6.push('No expenses have been recorded');
    add('expenses', 'Expense entries are saved and valid', !p6.length, p6, `#/expenses?pool=${p.id}`);
    // 7 reconciliation
    const p7 = [];
    const direct = sum(db.expenses.filter((e) => e.poolId === poolId && !e.deletedAt && e.status === 'SAVED'), (e) => D(e.amount));
    if (!direct.eq(r.totals.totalActual)) p7.push(`Category totals (${Fmt.inr(r.totals.totalActual)}) do not equal the sum of entries (${Fmt.inr(direct.toString())})`);
    const catSum = sum(r.byCat, (c) => D(c.actual));
    if (!catSum.eq(direct)) p7.push('Category breakdown does not reconcile');
    add('reconcile', 'Category totals reconcile with underlying entries', !p7.length, p7, `#/limits?pool=${p.id}`);
    // 8 shipments values & rates
    const p8 = [];
    r.shipments.list.forEach((s) => {
      if (!D(s.exchangeRate).gt(0)) p8.push(`${s.shipNo}: invalid exchange rate`);
      const v = Calc.shipmentValues(s.shippedQty, s.unitPrice, s.exchangeRate);
      if (v.foreign !== s.foreignValue || v.inr !== s.inrValue) p8.push(`${s.shipNo}: stored values do not match qty × price × rate`);
      if (!s.rateDate) p8.push(`${s.shipNo}: exchange-rate date missing`);
    });
    add('rates', 'Exchange rates and shipment values are valid', !p8.length, p8, `#/shipments/summary?pool=${p.id}`);
    // 9 adjustments
    const p9 = r.adjustments.list.filter((x) => !str(x.reason)).map((x) => `${x.adjNo} has no reason`);
    add('adjustments', 'Additions and deductions have reasons', !p9.length, p9, `#/shipments/summary?pool=${p.id}`);
    // 10 profitability
    const p10 = r.errors.slice();
    if (!D(r.totals.inrReceived).gt(0)) p10.push('INR received is zero');
    add('profit', 'Profitability calculated successfully', !p10.length, p10, `#/profitability?pool=${p.id}`);
    return { checks: chk, ok: chk.every((c) => c.ok), report: r };
  }
  svc.closureChecks = (poolId) => closureChecks(Store.db, poolId);
  svc.closePool = (poolId, remarks) => mut('closure.close', (db) => {
    const p = must(db, 'pools', poolId, 'Pool');
    if (!['ACTIVE', 'REOPENED'].includes(p.status)) fail(`Pool is ${p.status.toLowerCase()} — only active or reopened pools can be closed`);
    const c = closureChecks(db, poolId);
    if (!c.ok) fail('Closure blocked: ' + c.checks.filter((x) => !x.ok).map((x) => x.label).join('; '));
    const r = c.report;
    const version = db.closures.filter((x) => x.poolId === poolId).length + 1;
    const snapshot = JSON.parse(JSON.stringify({
      poolNo: p.poolNo, buyer: r.buyer && r.buyer.name, totals: r.totals, margins: r.margins, byCat: r.byCat, limits: r.limits, variance: r.variance,
      shipments: r.shipments.rows.map((x) => Object.assign({}, x, { shipments: x.shipments.map((s) => ({ shipNo: s.shipNo, qty: s.shippedQty, date: s.shipmentDate, rate: s.exchangeRate, rateDate: s.rateDate, foreign: s.foreignValue, inr: s.inrValue })) })),
      adjustments: r.adjustments.list, styleProfit: r.styleProfit, exceptions: db.exceptions.filter((x) => x.poolId === poolId),
      formulaVersion: Calc.FORMULA_VERSION, settingsUsed: { variance: db.settings.variance, shipment: db.settings.shipment },
    }));
    const cl = { id: uid(), poolId, version, status: 'ACTIVE', snapshot, closedBy: Store.user.name, closedAt: now(), remarks: optStr(remarks) };
    Object.freeze(cl.snapshot);
    db.closures.push(cl);
    const before = clone(p);
    p.status = 'CLOSED'; p.closedAt = cl.closedAt; p.closedBy = cl.closedBy; p.final = { closureId: cl.id, version, totals: r.totals, margins: r.margins };
    audit(db, 'CLOSE', 'Pool', p, before, remarks);
    return cl;
  });
  svc.reopenPool = (poolId, reason) => mut('closure.reopen', (db) => {
    const p = must(db, 'pools', poolId, 'Pool');
    if (p.status !== 'CLOSED') fail('Pool is not closed');
    const why = reqStr(reason, 'reason', 'Reason for reopening (correction)', 1000);
    const cl = db.closures.filter((x) => x.poolId === poolId && x.status === 'ACTIVE');
    cl.forEach((x) => { x.status = 'SUPERSEDED'; x.reopenedAt = now(); x.reopenedBy = Store.user.name; x.reopenReason = why; });
    const before = clone(p); p.status = 'REOPENED'; p.reopenedAt = now(); p.reopenedBy = Store.user.name;
    audit(db, 'REOPEN', 'Pool', p, before, why);
  });

  /* ---------- CSV import ---------- */
  function parseCsv(text) {
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ''));
    if (!nonEmpty.length) return [];
    const head = nonEmpty[0].map((h) => h.trim().replace(/^﻿/, ''));
    return nonEmpty.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
  }
  const IMPORTS = {
    buyers: { perm: 'buyers.edit', columns: ['code', 'name', 'contact', 'email', 'phone', 'address', 'country', 'currency', 'notes'] },
    styles: { perm: 'styles.edit', columns: ['buyer', 'season', 'styleRef', 'description', 'productType', 'sizeRange', 'sizes', 'qtyPerCombo', 'combos', 'quoteDate', 'remarks'] },
    orders: { perm: 'orders.edit', columns: ['buyer', 'poNumber', 'poDate', 'season', 'styleRef', 'combo', 'quoteNo', 'confirmedPrice', 'currency', 'confirmationDate', 'sizes', 'remarks'] },
  };
  /** Validate all rows against a scratch copy; import only if every row is valid (all-or-nothing). */
  svc.importCsv = async (kind, text) => {
    const cfg = IMPORTS[kind]; if (!cfg) fail('Unknown import type');
    requirePerm('import.run'); requirePerm(cfg.perm);
    const rows = parseCsv(text);
    if (!rows.length) fail('The file has no data rows');
    const missing = cfg.columns.filter((c) => ['name', 'buyer', 'season', 'styleRef', 'poNumber', 'combo', 'currency'].includes(c) && !(c in rows[0]));
    if (missing.length) fail('Missing required column(s): ' + missing.join(', '));
    const errors = [];
    const realAdapter = Store.adapter, realDb = Store.db;
    const scratch = MemoryAdapter(); await scratch.save(clone(realDb), null);
    Store.adapter = scratch; Store.db = clone(realDb);
    const findBuyer = (v) => Store.db.buyers.find((b) => lc(b.code) === lc(v) || lc(b.name) === lc(v));
    let n = 0;
    try {
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        try {
          if (kind === 'buyers') await svc.saveBuyer(Object.assign({}, r, { currency: r.currency || 'GBP' }));
          else if (kind === 'styles') {
            const b = findBuyer(r.buyer); if (!b) fail(`Buyer "${r.buyer}" not found`);
            await svc.saveStyle(Object.assign({}, r, { buyerId: b.id, sizes: (r.sizes || '').split(/[|;]/), status: 'ACTIVE' }));
          } else {
            const b = findBuyer(r.buyer); if (!b) fail(`Buyer "${r.buyer}" not found`);
            const st = Store.db.styles.find((s) => s.buyerId === b.id && lc(s.styleRef) === lc(r.styleRef) && (!r.season || lc(s.season) === lc(r.season)));
            if (!st) fail(`Style "${r.styleRef}" not found for ${b.name}`);
            let po = Store.db.pos.find((p) => p.buyerId === b.id && lc(p.poNumber) === lc(r.poNumber));
            if (!po) po = await svc.savePO({ buyerId: b.id, poNumber: r.poNumber, poDate: r.poDate, season: r.season || st.season, status: 'OPEN' });
            const q = Store.db.quotes.find((x) => lc(x.quoteNo) === lc(r.quoteNo));
            if (!q) fail(`Quote "${r.quoteNo}" not found`);
            const sizes = {};
            (r.sizes || '').split(/[|;]/).filter(Boolean).forEach((p) => { const [k, v] = p.split(/[:=]/); if (!k || v === undefined) fail(`Invalid size entry "${p}" (use SIZE:QTY|SIZE:QTY)`); sizes[k.trim()] = v.trim(); });
            Object.keys(sizes).forEach((k) => { if (st.sizes.length && !st.sizes.includes(k)) fail(`Size "${k}" is not in the style's size set`); });
            await svc.saveLine({ poId: po.id, styleId: st.id, combo: r.combo, qtyMode: 'SIZE', sizes, quoteId: q.id, confirmedPrice: r.confirmedPrice, currency: r.currency, confirmationDate: r.confirmationDate, remarks: r.remarks, status: 'CONFIRMED' });
          }
          n++;
        } catch (e) { errors.push({ row: i + 2, message: e.message }); }
      }
    } finally {
      Store.adapter = realAdapter; Store.db = realDb;
    }
    if (errors.length) return { imported: 0, errors, total: rows.length };
    // all valid → replay for real
    for (const r of rows) {
      if (kind === 'buyers') await svc.saveBuyer(Object.assign({}, r, { currency: r.currency || 'GBP' }));
      else if (kind === 'styles') { const b = findBuyer(r.buyer); await svc.saveStyle(Object.assign({}, r, { buyerId: b.id, sizes: (r.sizes || '').split(/[|;]/), status: 'ACTIVE' })); }
      else {
        const b = findBuyer(r.buyer);
        const st = Store.db.styles.find((s) => s.buyerId === b.id && lc(s.styleRef) === lc(r.styleRef) && (!r.season || lc(s.season) === lc(r.season)));
        let po = Store.db.pos.find((p) => p.buyerId === b.id && lc(p.poNumber) === lc(r.poNumber));
        if (!po) po = await svc.savePO({ buyerId: b.id, poNumber: r.poNumber, poDate: r.poDate, season: r.season || st.season, status: 'OPEN' });
        const q = Store.db.quotes.find((x) => lc(x.quoteNo) === lc(r.quoteNo));
        const sizes = {}; (r.sizes || '').split(/[|;]/).filter(Boolean).forEach((p) => { const [k, v] = p.split(/[:=]/); sizes[k.trim()] = v.trim(); });
        await svc.saveLine({ poId: po.id, styleId: st.id, combo: r.combo, qtyMode: 'SIZE', sizes, quoteId: q.id, confirmedPrice: r.confirmedPrice, currency: r.currency, confirmationDate: r.confirmationDate, remarks: r.remarks, status: 'CONFIRMED' });
      }
    }
    return { imported: n, errors: [], total: rows.length };
  };

  /* ---------- Backup ---------- */
  svc.exportBackup = () => { requirePerm('settings.manage'); return JSON.stringify(Store.db); };
  svc.restoreBackup = async (json) => {
    requirePerm('settings.manage');
    let d; try { d = JSON.parse(json); } catch (e) { fail('Invalid backup file'); }
    if (!d || !d.meta || !Array.isArray(d.users) || !d.users.length) fail('Invalid backup file (no users)');
    const me = Store.user;
    await Store.commit((db) => { Object.keys(db).forEach((k) => delete db[k]); Object.assign(db, migrate(d)); db.meta.rev = Store.db.meta.rev; audit(db, 'RESTORE', 'Backup', { id: 'backup', label: 'Backup restored' }); });
    const u = byId(Store.db, 'users', me.id);
    if (!u) { svc.logout(); } else Store.user = u;
  };
  svc.removeTestData = () => mut('settings.manage', (db) => {
    const testPools = new Set(db.pools.filter((p) => p.isTest).map((p) => p.id));
    const testBuyers = new Set(db.buyers.filter((b) => b.isTest).map((b) => b.id));
    const testStyles = new Set(db.styles.filter((s) => s.isTest || testBuyers.has(s.buyerId)).map((s) => s.id));
    const testLines = new Set(db.lines.filter((l) => l.isTest || testStyles.has(l.styleId)).map((l) => l.id));
    db.closures = db.closures.filter((x) => !testPools.has(x.poolId));
    db.adjustments = db.adjustments.filter((x) => !testPools.has(x.poolId));
    db.shipments = db.shipments.filter((x) => !testPools.has(x.poolId) && !testLines.has(x.lineId));
    db.exceptions = db.exceptions.filter((x) => !testPools.has(x.poolId));
    db.expenses = db.expenses.filter((x) => !testPools.has(x.poolId));
    db.allocations = db.allocations.filter((x) => !testPools.has(x.poolId) && !testLines.has(x.lineId));
    db.pools = db.pools.filter((x) => !testPools.has(x.id));
    db.priceHistory = db.priceHistory.filter((x) => !testLines.has(x.lineId));
    db.lines = db.lines.filter((x) => !testLines.has(x.id));
    db.pos = db.pos.filter((x) => !x.isTest && !testBuyers.has(x.buyerId));
    db.quotes = db.quotes.filter((x) => !testStyles.has(x.styleId));
    db.costings = db.costings.filter((x) => !testStyles.has(x.styleId));
    db.styles = db.styles.filter((x) => !testStyles.has(x.id));
    db.buyers = db.buyers.filter((x) => !testBuyers.has(x.id));
    db.rates = db.rates.filter((x) => !x.isTest);
    audit(db, 'DELETE', 'TestData', { id: 'test', label: 'Removed BGPL-001 test data' });
  });

  G.SP = G.SP || {};
  Object.assign(G.SP, {
    AppError, Store, svc, IDBAdapter, MemoryAdapter, PERMS, ROLES, DEFAULT_ROLE_PERMS, can, requirePerm, categories, catLabel,
    lineMetrics, rateOn, computePool, closureChecks, byId, uid, today, now, clone, parseCsv, emptyDb, IMPORTS,
  });
})(typeof window !== 'undefined' ? window : globalThis);
