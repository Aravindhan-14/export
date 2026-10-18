/* ==========================================================================
   ui.js — UI kit (modal, confirm, toast, forms, searchable select, data table,
   exports, printing), app shell, navigation and router.
   ========================================================================== */
(function (G) {
  'use strict';
  const SP = G.SP;
  const { Store, Fmt, AppError, can } = SP;

  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  const fmtDate = (d) => { if (!d) return '—'; const s = String(d).slice(0, 10).split('-'); return s.length === 3 ? `${s[2]}/${s[1]}/${s[0]}` : esc(d); };
  const fmtDT = (d) => { if (!d) return '—'; const x = new Date(d); return isNaN(x) ? esc(d) : x.toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
  const qs = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

  /* ---------------- icons (inline SVG, stroke) ---------------- */
  const P = {
    dash: 'M3 13h8V3H3zm0 8h8v-6H3zm10 0h8V11h-8zm0-18v6h8V3z', buyer: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm13 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
    style: 'M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z',
    calc: 'M4 2h16v20H4zM8 6h8M8 10h2m4 0h2M8 14h2m4 0h2M8 18h2m4 0h2', quote: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 13h6M9 17h6',
    check: 'M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01l-3-3', po: 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2',
    pool: 'M12 2 2 7l10 5 10-5zM2 17l10 5 10-5M2 12l10 5 10-5', exp: 'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6', alert: 'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4m0 4h.01',
    ship: 'M1 3h15v13H1zm15 5h4l3 3v5h-7zM5.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zm13 0a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z', limit: 'M3 3v18h18M7 14l4-4 4 4 5-5',
    profit: 'M23 6l-9.5 9.5-5-5L1 18M17 6h6v6', lock: 'M5 11h14v10H5zm2 0V7a5 5 0 0 1 10 0v4', fx: 'M7 16V4m0 0L3 8m4-4 4 4m6 0v12m0 0 4-4m-4 4-4-4',
    users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2m8-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm14 10v-2a4 4 0 0 0-3-3.87', audit: 'M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
    gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2.1-1.6-2-3.5-2.5 1a7.3 7.3 0 0 0-2-1.2L14.5 3h-4l-.4 2.5a7.3 7.3 0 0 0-2 1.2l-2.5-1-2 3.5 2.1 1.6a7.4 7.4 0 0 0 0 2.4l-2.1 1.6 2 3.5 2.5-1a7.3 7.3 0 0 0 2 1.2l.4 2.5h4l.4-2.5a7.3 7.3 0 0 0 2-1.2l2.5 1 2-3.5-2.1-1.6c.1-.4.1-.8.1-1.2z',
    search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm10 2-4.35-4.35', bell: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9m-4.27 13a2 2 0 0 1-3.46 0', menu: 'M3 12h18M3 6h18M3 18h18',
    plus: 'M12 5v14M5 12h14', x: 'M18 6 6 18M6 6l12 12', print: 'M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z',
    dl: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3', up: 'M18 15l-6-6-6 6', down: 'M6 9l6 6 6-6', copy: 'M20 9h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
    edit: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z', trash: 'M3 6h18M8 6V4h8v2m3 0-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6', eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12zm11 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  };
  const ico = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${P[k] || ''}"/></svg>`;

  /* ---------------- toast ---------------- */
  function toast(msg, type) {
    let box = $('.toasts'); if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
    const t = document.createElement('div'); t.className = 'toast ' + (type || ''); t.textContent = msg; box.appendChild(t);
    setTimeout(() => t.remove(), type === 'bad' ? 7000 : 3500);
  }

  /* ---------------- modal ---------------- */
  const modalStack = [];
  function modal({ title, body, size, actions, onMount, onClose, dismissable = true }) {
    const prev = document.activeElement;
    const bg = document.createElement('div'); bg.className = 'modal-bg';
    const id = 'm' + Math.random().toString(36).slice(2);
    bg.innerHTML = `<div class="modal ${size || ''}" role="dialog" aria-modal="true" aria-labelledby="${id}">
      <div class="mh"><h2 id="${id}">${esc(title)}</h2><button class="iconbtn" data-close aria-label="Close">${ico('x')}</button></div>
      <div class="mb"><div class="form-error hidden" role="alert"></div>${body || ''}</div>
      ${actions && actions.length ? `<div class="mf">${actions.map((a, i) => `<button class="btn ${a.cls || ''}" data-mi="${i}" type="button">${esc(a.label)}</button>`).join('')}</div>` : ''}</div>`;
    document.body.appendChild(bg);
    const el = bg.querySelector('.modal');
    let closed = false;
    const close = (v) => {
      if (closed) return; closed = true; bg.remove(); modalStack.splice(modalStack.indexOf(api), 1);
      if (prev && prev.focus) prev.focus();
      if (onClose) onClose(v);
      if (!modalStack.length && App.pendingRefresh) { App.pendingRefresh = false; App.refresh(); }
    };
    const api = { el, close, bg };
    modalStack.push(api);
    bg.addEventListener('mousedown', (e) => { if (e.target === bg && dismissable) close(); });
    el.querySelector('[data-close]').onclick = () => close();
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && dismissable) { e.stopPropagation(); close(); }
      if (e.key === 'Tab') {
        const f = $$('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])', el).filter((x) => !x.disabled && x.offsetParent !== null);
        if (!f.length) return; const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
      if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'file' && !e.target.closest('.combo') && actions) {
        const primary = (actions || []).findIndex((a) => /primary|danger solid/.test(a.cls || ''));
        if (primary >= 0) { e.preventDefault(); el.querySelector(`[data-mi="${primary}"]`).click(); }
      }
    });
    (actions || []).forEach((a, i) => {
      const b = el.querySelector(`[data-mi="${i}"]`);
      b.onclick = async () => {
        if (!a.onClick) return close();
        await run(b, async () => { const r = await a.onClick(api); if (r !== false) close(r); }, el);
      };
    });
    enhance(el);
    if (onMount) onMount(api);
    setTimeout(() => { const f = el.querySelector('.mb input:not([type=hidden]):not([readonly]),.mb select,.mb textarea'); (f || el.querySelector('[data-close]')).focus(); }, 30);
    return api;
  }
  function confirm(message, { title = 'Please confirm', ok = 'Confirm', danger = false } = {}) {
    return new Promise((res) => {
      modal({ title, size: 'sm', body: `<p style="margin:0">${message}</p>`, onClose: (v) => res(!!v), actions: [{ label: 'Cancel', onClick: () => undefined }, { label: ok, cls: danger ? 'danger solid' : 'primary', onClick: () => true }] });
    });
  }
  function ask(title, label, { required = true, placeholder = '', value = '', help = '', ok = 'OK', danger = false, multiline = true } = {}) {
    return new Promise((res) => {
      modal({
        title, size: 'sm', onClose: (v) => res(v === undefined ? null : v),
        body: `<div class="form-grid"><div class="fld s12"><label>${esc(label)}${required ? ' <span class="req">*</span>' : ''}</label>${multiline ? `<textarea name="v" placeholder="${esc(placeholder)}">${esc(value)}</textarea>` : `<input type="text" name="v" value="${esc(value)}" placeholder="${esc(placeholder)}">`}${help ? `<div class="help">${help}</div>` : ''}</div></div>`,
        actions: [{ label: 'Cancel', onClick: () => undefined }, { label: ok, cls: danger ? 'danger solid' : 'primary', onClick: (m) => { const v = m.el.querySelector('[name=v]').value.trim(); if (required && !v) throw new AppError(`${label} is required`, 'v'); return v; } }],
      });
    });
  }

  /* ---------------- async runner with error display ---------------- */
  async function run(btn, fn, formEl) {
    const old = btn ? btn.innerHTML : null;
    if (btn) { btn.disabled = true; btn.innerHTML = `<span class="spin"></span>${old}`; }
    clearErrors(formEl);
    try { return await fn(); }
    catch (e) {
      if (!(e instanceof AppError) && e.name !== 'AppError') console.error(e);
      showError(formEl, e);
    } finally { if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = old; } }
  }
  function clearErrors(el) {
    if (!el) return;
    $$('.fld.invalid', el).forEach((f) => f.classList.remove('invalid'));
    $$('.fld .err', el).forEach((x) => x.remove());
    $$('input.cell.invalid', el).forEach((x) => x.classList.remove('invalid'));
    const fe = el.querySelector('.form-error'); if (fe) { fe.classList.add('hidden'); fe.textContent = ''; }
  }
  function showError(el, e) {
    const msg = e && e.message ? e.message : String(e);
    if (el) {
      const f = e.field && el.querySelector(`[name="${CSS.escape(e.field)}"]`);
      if (f) {
        const fld = f.closest('.fld');
        if (fld) { fld.classList.add('invalid'); const d = document.createElement('div'); d.className = 'err'; d.textContent = msg; fld.appendChild(d); }
        else f.classList.add('invalid');
        f.focus && f.focus();
      }
      const fe = el.querySelector('.form-error');
      if (fe) { fe.textContent = msg; fe.classList.remove('hidden'); if (!f) fe.scrollIntoView({ block: 'nearest' }); return; }
    }
    toast(msg, 'bad');
  }

  /* ---------------- forms ---------------- */
  function field(f, v) {
    const val = v === undefined || v === null ? (f.default !== undefined ? f.default : '') : v;
    const req = f.required ? ' <span class="req">*</span>' : '';
    const ro = f.readonly ? ' readonly' : '';
    const dis = f.disabled ? ' disabled' : '';
    const attrs = f.attrs || '';
    let inp;
    switch (f.type) {
      case 'select':
        inp = `<select name="${f.name}" id="f_${f.name}"${dis}${f.search ? ' data-search' : ''} ${attrs}>${f.placeholder !== false ? `<option value="">${esc(f.placeholder || '— Select —')}</option>` : ''}${(f.options || []).map((o) => { const ov = typeof o === 'object' ? o.value : o, ol = typeof o === 'object' ? o.label : o; return `<option value="${esc(ov)}"${String(ov) === String(val) ? ' selected' : ''}>${esc(ol)}</option>`; }).join('')}</select>`; break;
      case 'textarea': inp = `<textarea name="${f.name}" id="f_${f.name}"${ro}${dis} placeholder="${esc(f.placeholder || '')}" ${attrs}>${esc(val)}</textarea>`; break;
      case 'checkbox': return `<div class="fld ${f.span || 's12'}"><label class="check"><input type="checkbox" name="${f.name}"${val ? ' checked' : ''}${dis} ${attrs}> ${esc(f.label)}</label>${f.help ? `<div class="help">${f.help}</div>` : ''}</div>`;
      case 'static': return `<div class="fld ${f.span || ''}"><label>${esc(f.label)}</label><div class="inp" style="background:var(--surface-2)" id="f_${f.name}">${f.html !== undefined ? f.html : esc(val)}</div>${f.help ? `<div class="help">${f.help}</div>` : ''}</div>`;
      case 'html': return `<div class="fld ${f.span || 's12'}">${f.label ? `<label>${esc(f.label)}</label>` : ''}${f.html}</div>`;
      case 'decimal': inp = `<input type="text" inputmode="decimal" name="${f.name}" id="f_${f.name}" value="${esc(val)}"${ro}${dis} placeholder="${esc(f.placeholder || '')}" ${attrs}>`; break;
      case 'int': inp = `<input type="number" step="1" min="${f.min !== undefined ? f.min : 0}" inputmode="numeric" name="${f.name}" id="f_${f.name}" value="${esc(val)}"${ro}${dis} ${attrs}>`; break;
      default: inp = `<input type="${f.type || 'text'}" name="${f.name}" id="f_${f.name}" value="${esc(val)}"${ro}${dis} placeholder="${esc(f.placeholder || '')}" autocomplete="${f.autocomplete || 'off'}" ${attrs}>`;
    }
    return `<div class="fld ${f.span || ''}"><label for="f_${f.name}">${esc(f.label)}${req}</label>${inp}${f.help ? `<div class="help">${f.help}</div>` : ''}</div>`;
  }
  const form = (fields, values) => `<div class="form-grid">${fields.map((f) => field(f, (values || {})[f.name])).join('')}</div>`;
  function read(el) {
    const o = {};
    $$('[name]', el).forEach((i) => {
      if (i.closest('[data-noread]')) return;
      if (i.type === 'checkbox') o[i.name] = i.checked;
      else if (i.type === 'radio') { if (i.checked) o[i.name] = i.value; }
      else if (i.type !== 'file') o[i.name] = i.value;
    });
    return o;
  }

  /* ---------------- searchable select (combobox) ---------------- */
  function enhance(root) {
    $$('select[data-search]', root).forEach((sel) => {
      if (sel.dataset.enh) return; sel.dataset.enh = '1';
      const wrap = document.createElement('div'); wrap.className = 'combo';
      sel.parentNode.insertBefore(wrap, sel); wrap.appendChild(sel); sel.style.display = 'none';
      const inp = document.createElement('input'); inp.type = 'text'; inp.setAttribute('role', 'combobox'); inp.setAttribute('aria-expanded', 'false'); inp.setAttribute('autocomplete', 'off');
      inp.className = 'inp'; inp.placeholder = 'Type to search…'; if (sel.id) { inp.id = sel.id + '_c'; const lab = root.querySelector(`label[for="${sel.id}"]`); if (lab) lab.setAttribute('for', inp.id); }
      inp.disabled = sel.disabled;
      wrap.insertBefore(inp, sel);
      const ul = document.createElement('ul'); ul.setAttribute('role', 'listbox'); ul.className = 'hidden'; wrap.appendChild(ul);
      let act = -1, items = [];
      const label = () => { const o = sel.options[sel.selectedIndex]; inp.value = o && o.value ? o.text : ''; };
      label();
      const render = (q) => {
        const ql = (q || '').toLowerCase();
        items = Array.from(sel.options).filter((o) => o.value && (!ql || o.text.toLowerCase().includes(ql)));
        act = items.length ? 0 : -1;
        ul.innerHTML = items.length ? items.slice(0, 200).map((o, i) => `<li role="option" data-i="${i}" class="${i === act ? 'act' : ''}">${esc(o.text)}</li>`).join('') : '<li class="none">No matches</li>';
        ul.classList.remove('hidden'); inp.setAttribute('aria-expanded', 'true');
      };
      const pick = (o) => { sel.value = o.value; label(); ul.classList.add('hidden'); inp.setAttribute('aria-expanded', 'false'); sel.dispatchEvent(new Event('change', { bubbles: true })); };
      inp.addEventListener('focus', () => { inp.select(); render(''); });
      inp.addEventListener('input', () => render(inp.value));
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (ul.classList.contains('hidden')) render(''); act = Math.max(0, Math.min(items.length - 1, act + (e.key === 'ArrowDown' ? 1 : -1))); $$('li', ul).forEach((li, i) => li.classList.toggle('act', i === act)); const a = ul.querySelector('.act'); a && a.scrollIntoView({ block: 'nearest' }); }
        else if (e.key === 'Enter') { if (!ul.classList.contains('hidden') && items[act]) { e.preventDefault(); e.stopPropagation(); pick(items[act]); } }
        else if (e.key === 'Escape') { if (!ul.classList.contains('hidden')) { e.stopPropagation(); ul.classList.add('hidden'); label(); } }
      });
      ul.addEventListener('mousedown', (e) => { const li = e.target.closest('li[data-i]'); if (li) { e.preventDefault(); pick(items[+li.dataset.i]); } });
      inp.addEventListener('blur', () => setTimeout(() => { ul.classList.add('hidden'); inp.setAttribute('aria-expanded', 'false'); if (!inp.value) { if (sel.value) { sel.value = ''; sel.dispatchEvent(new Event('change', { bubbles: true })); } } else label(); }, 120));
      sel.addEventListener('change', label);
      sel._refresh = () => { label(); inp.disabled = sel.disabled; };
    });
  }
  function setOptions(sel, options, value, placeholder) {
    sel.innerHTML = `<option value="">${esc(placeholder || '— Select —')}</option>` + options.map((o) => `<option value="${esc(o.value)}"${String(o.value) === String(value) ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
    if (sel._refresh) sel._refresh();
  }

  /* ---------------- data table ---------------- */
  const tableState = {};
  function table(container, opts) {
    const id = opts.id;
    const st = tableState[id] = tableState[id] || { q: '', sort: opts.sort || null, page: 1, f: {} };
    // Filters passed in the URL (e.g. from a dashboard link) are applied when the URL changes;
    // afterwards the user's own filter choices survive data refreshes.
    if (opts.initialFilters && st.hash !== location.hash) { Object.assign(st.f, opts.initialFilters); st.page = 1; }
    st.hash = location.hash;
    const cols = opts.columns.filter((c) => !c.hidden);
    const val = (c, r) => (c.value ? c.value(r) : r[c.key]);
    const draw = () => {
      let rows = (typeof opts.rows === 'function' ? opts.rows() : opts.rows) || [];
      (opts.filters || []).forEach((f) => { const v = st.f[f.key]; if (v !== undefined && v !== '') rows = rows.filter((r) => (f.test ? f.test(r, v) : String(f.get ? f.get(r) : r[f.key]) === String(v))); });
      if (st.q) {
        const q = st.q.toLowerCase();
        rows = rows.filter((r) => (opts.searchText ? opts.searchText(r) : cols.map((c) => val(c, r)).join(' ')).toString().toLowerCase().includes(q));
      }
      if (st.sort) {
        const c = cols.find((x) => x.key === st.sort.key);
        if (c) {
          const dir = st.sort.dir === 'desc' ? -1 : 1;
          rows = rows.slice().sort((a, b) => {
            let x = val(c, a), y = val(c, b);
            if (c.num) { x = x === null || x === undefined || x === '' ? -Infinity : Number(x); y = y === null || y === undefined || y === '' ? -Infinity : Number(y); }
            else { x = String(x === null || x === undefined ? '' : x).toLowerCase(); y = String(y === null || y === undefined ? '' : y).toLowerCase(); }
            return x < y ? -dir : x > y ? dir : 0;
          });
        }
      }
      const size = opts.pageSize || 15;
      const pages = Math.max(1, Math.ceil(rows.length / size));
      if (st.page > pages) st.page = pages;
      const pageRows = opts.noPaging ? rows : rows.slice((st.page - 1) * size, st.page * size);
      container._rows = rows;
      const filt = (opts.filters || []).map((f) => `<select data-filter="${f.key}" aria-label="${esc(f.label)}"><option value="">${esc(f.label)}: All</option>${(typeof f.options === 'function' ? f.options() : f.options).map((o) => { const ov = typeof o === 'object' ? o.value : o, ol = typeof o === 'object' ? o.label : o; return `<option value="${esc(ov)}"${String(st.f[f.key]) === String(ov) ? ' selected' : ''}>${esc(ol)}</option>`; }).join('')}</select>`).join('');
      const exp = opts.exportName ? `<button class="btn sm" data-x="csv" type="button">${ico('dl')} CSV</button><button class="btn sm" data-x="xls" type="button">${ico('dl')} Excel</button>` : '';
      container.innerHTML = `
        ${opts.noToolbar ? '' : `<div class="toolbar"><input type="search" class="search" placeholder="${esc(opts.searchPlaceholder || 'Search…')}" value="${esc(st.q)}" aria-label="Search">${filt}<span class="sp"></span>${opts.toolbarExtra || ''}${exp}</div>`}
        <div class="table-wrap"><table class="t"><thead><tr>${cols.map((c) => `<th class="${c.num ? 'num' : ''} ${c.sortable === false ? '' : 'sortable'} ${c.hideSm ? 'hide-sm' : ''}" data-k="${c.key}" ${st.sort && st.sort.key === c.key ? `aria-sort="${st.sort.dir === 'desc' ? 'descending' : 'ascending'}"` : ''}>${esc(c.label)}${st.sort && st.sort.key === c.key ? `<span class="arr">${st.sort.dir === 'desc' ? '▼' : '▲'}</span>` : ''}</th>`).join('')}${opts.actions ? '<th class="num">Actions</th>' : ''}</tr></thead>
        <tbody>${pageRows.length ? pageRows.map((r, i) => `<tr data-ri="${i}" class="${opts.rowClass ? opts.rowClass(r) : ''} ${opts.onRow ? 'clickable' : ''}">${cols.map((c) => `<td class="${c.num ? 'num' : ''} ${c.wrap ? 'wrap' : ''} ${c.hideSm ? 'hide-sm' : ''}">${c.render ? c.render(r) : esc(val(c, r))}</td>`).join('')}${opts.actions ? `<td><div class="rowacts">${opts.actions(r)}</div></td>` : ''}</tr>`).join('') : `<tr><td colspan="${cols.length + (opts.actions ? 1 : 0)}"><div class="empty"><b>${esc(opts.empty || 'No records found')}</b>${st.q || Object.values(st.f).some((v) => v) ? 'Try clearing the search or filters.' : esc(opts.emptyHint || '')}</div></td></tr>`}</tbody>
        ${opts.footer && rows.length ? `<tfoot><tr>${opts.footer(rows)}</tr></tfoot>` : ''}</table></div>
        ${opts.noPaging ? '' : `<div class="pager"><span>${rows.length} record${rows.length === 1 ? '' : 's'}</span><span class="sp"></span><button class="btn xs" data-pg="-1" ${st.page <= 1 ? 'disabled' : ''} type="button">Prev</button><span>Page ${st.page} / ${pages}</span><button class="btn xs" data-pg="1" ${st.page >= pages ? 'disabled' : ''} type="button">Next</button></div>`}`;
      const s = $('input.search', container);
      if (s) s.addEventListener('input', () => { st.q = s.value; st.page = 1; const pos = s.selectionStart; draw(); const n = $('input.search', container); n.focus(); n.setSelectionRange(pos, pos); });
      $$('[data-filter]', container).forEach((sel) => sel.addEventListener('change', () => { st.f[sel.dataset.filter] = sel.value; st.page = 1; draw(); }));
      $$('th.sortable', container).forEach((th) => th.addEventListener('click', () => { const k = th.dataset.k; st.sort = st.sort && st.sort.key === k ? { key: k, dir: st.sort.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: 'asc' }; draw(); }));
      $$('[data-pg]', container).forEach((b) => b.addEventListener('click', () => { st.page += +b.dataset.pg; draw(); }));
      $$('[data-x]', container).forEach((b) => b.addEventListener('click', () => {
        if (!can('reports.export') && opts.exportPerm !== false) return toast('You do not have permission to export', 'bad');
        const ec = cols.filter((c) => c.export !== false);
        const data = rows.map((r) => ec.map((c) => (c.exportValue ? c.exportValue(r) : val(c, r))));
        if (b.dataset.x === 'csv') downloadCSV(opts.exportName, ec.map((c) => c.label), data); else downloadXLS(opts.exportName, [{ name: opts.exportName, head: ec.map((c) => c.label), rows: data }]);
      }));
      $$('tbody tr[data-ri]', container).forEach((tr) => {
        const r = pageRows[+tr.dataset.ri];
        tr.addEventListener('click', (e) => {
          const b = e.target.closest('[data-act]');
          if (b) { e.stopPropagation(); const h = opts.on && opts.on[b.dataset.act]; if (h) h(r, b); return; }
          if (opts.onRow && !e.target.closest('a,button,input,select')) opts.onRow(r);
        });
      });
    };
    draw();
    return { redraw: draw, state: st };
  }
  const act = (name, label, cls, icon, disabled, title) => `<button class="btn xs ${cls || ''}" data-act="${name}" type="button" ${disabled ? 'disabled' : ''} title="${esc(title || label)}" aria-label="${esc(title || label)}">${icon ? ico(icon) : ''}${label ? esc(label) : ''}</button>`;

  /* ---------------- exports & printing ---------------- */
  function download(name, mime, content) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  const csvCell = (v) => { let s = v === null || v === undefined ? '' : String(v); if (/^[=+\-@]/.test(s) && !/^-?\d/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  function downloadCSV(name, head, rows) {
    download(`${name}-${SP.today()}.csv`, 'text/csv;charset=utf-8', '﻿' + [head].concat(rows).map((r) => r.map(csvCell).join(',')).join('\r\n'));
  }
  /** Excel workbook (SpreadsheetML 2003 XML — opens natively in Excel, multiple sheets, typed numbers). */
  function downloadXLS(name, sheets) {
    const x = (s) => String(s === null || s === undefined ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
    const cell = (v) => (v !== null && v !== '' && typeof v !== 'boolean' && /^-?\d+(\.\d+)?$/.test(String(v)) && String(v).replace('-', '').replace('.', '').length < 16 ? `<Cell><Data ss:Type="Number">${v}</Data></Cell>` : `<Cell><Data ss:Type="String">${x(v)}</Data></Cell>`);
    const xml = `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="h"><Font ss:Bold="1"/><Interior ss:Color="#E8EEF6" ss:Pattern="Solid"/></Style></Styles>${sheets.map((s) => `<Worksheet ss:Name="${x(String(s.name).replace(/[\\/?*[\]:]/g, '').slice(0, 31) || 'Sheet')}"><Table><Row>${s.head.map((h) => `<Cell ss:StyleID="h"><Data ss:Type="String">${x(h)}</Data></Cell>`).join('')}</Row>${s.rows.map((r) => `<Row>${r.map(cell).join('')}</Row>`).join('')}</Table></Worksheet>`).join('')}</Workbook>`;
    download(`${name}-${SP.today()}.xls`, 'application/vnd.ms-excel', xml);
  }
  /** Print / Save as PDF: opens a clean document in a new window and triggers the print dialog. */
  function printDoc(title, html) {
    const w = G.open('', '_blank');
    if (!w) return toast('Allow pop-ups to print / save as PDF', 'warn');
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
      body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:11.5px;color:#111;margin:24px}
      h1{font-size:18px;margin:0 0 4px} h2{font-size:13.5px;margin:18px 0 6px} .muted{color:#555} .hdr{display:flex;justify-content:space-between;border-bottom:2px solid #1f3a5f;padding-bottom:8px;margin-bottom:12px}
      table{width:100%;border-collapse:collapse;margin:6px 0 12px} th,td{border:1px solid #bbb;padding:4px 6px;text-align:left;vertical-align:top} th{background:#eef2f7;font-size:10.5px;text-transform:uppercase}
      .num{text-align:right;white-space:nowrap} tfoot td{font-weight:700;background:#f4f6f9} .badge{border:1px solid #999;border-radius:8px;padding:0 6px;font-size:10px}
      .neg{color:#b91c1c} .pos{color:#15803d} .grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 24px} .test{background:#fff4d6;border:1px solid #f0d58c;padding:4px 8px;margin-bottom:8px}
      @page{margin:14mm} @media print{.noprint{display:none}}
    </style></head><body><div class="hdr"><div><h1>${esc(title)}</h1><div class="muted">${esc(Store.db.settings.company)}</div></div><div class="muted" style="text-align:right">Printed ${esc(fmtDT(new Date().toISOString()))}<br>by ${esc(Store.user ? Store.user.name : '')}</div></div>${html}
    <p class="noprint" style="margin-top:20px"><button onclick="print()">Print / Save as PDF</button></p><script>setTimeout(function(){print()},300)<\/script></body></html>`);
    w.document.close();
  }
  function pickFile(accept) {
    return new Promise((res) => {
      const i = document.createElement('input'); i.type = 'file'; i.accept = accept || '';
      i.onchange = () => res(i.files[0] || null); i.click();
    });
  }
  const readText = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsText(file); });
  const readDataUrl = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(file); });
  /** Image storage provider: 'embedded' (resized JPEG stored in the local database) or 'url' (external link). */
  async function imageToDataUrl(file, max = 900) {
    if (!/^image\//.test(file.type)) throw new AppError('Choose an image file (JPG, PNG, WebP)');
    if (file.size > 15 * 1024 * 1024) throw new AppError('Image is larger than 15 MB');
    const url = await readDataUrl(file);
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new AppError('Could not read the image')); i.src = url; });
    const k = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
  }

  /* ---------------- small render helpers ---------------- */
  const badge = (text, cls) => `<span class="badge ${cls || ''}">${esc(text)}</span>`;
  const STATUS_CLS = { ACTIVE: 'ok', CONFIRMED: 'ok', APPROVED: 'ok', ACCEPTED: 'ok', RESOLVED: 'ok', PAID: 'ok', OPEN: 'info', SAVED: 'ok', UNDER: 'ok', EQUAL: 'info', OVER: 'bad', DRAFT: 'warn', PENDING: 'warn', PARTIAL: 'warn', SENT: 'info', REOPENED: 'warn', CLOSED: 'brand', CANCELLED: 'bad', REJECTED: 'bad', UNPAID: 'bad', RELEASED: '', SUPERSEDED: '', ARCHIVED: '', INACTIVE: '' };
  const status = (s) => badge(String(s || '').replace(/_/g, ' '), STATUS_CLS[s] || '');
  const testTag = (r) => (r && r.isTest ? ' ' + badge('TEST DATA', 'test') : '');
  const signed = (x, f) => { const n = SP.D(x || 0); return `<span class="${n.isNeg() ? 'neg' : n.isZero() ? '' : 'pos'}">${(f || Fmt.inr)(x)}</span>`; };
  function pageHead(title, sub, actions, crumbs) {
    return `${crumbs ? `<div class="crumbs">${crumbs}</div>` : ''}<div class="ph"><div class="t"><h1>${esc(title)}</h1>${sub ? `<p>${sub}</p>` : ''}</div><div class="acts">${actions || ''}</div></div>`;
  }
  const btn = (label, attrs, cls, icon) => `<button class="btn ${cls || ''}" type="button" ${attrs || ''}>${icon ? ico(icon) : ''}${esc(label)}</button>`;
  const guard = (perm, html) => (can(perm) ? html : '');
  function empty(title, hint, action) { return `<div class="empty"><b>${esc(title)}</b>${hint || ''}${action ? `<div style="margin-top:12px">${action}</div>` : ''}</div>`; }

  /* ---------------- App shell & router ---------------- */
  const NAV = [
    { grp: 'Overview' },
    { path: 'dashboard', label: 'Dashboard', icon: 'dash', perm: 'reports.view' },
    { grp: 'Masters & costing' },
    { path: 'buyers', label: 'Buyers', icon: 'buyer', perm: 'buyers.view' },
    { path: 'styles', label: 'Style Master', icon: 'style', perm: 'styles.view' },
    { path: 'costing', label: 'Costing Inputs', icon: 'calc', perm: 'costing.view' },
    { path: 'quotes', label: 'Quote & Revised Quotes', icon: 'quote', perm: 'quotes.view' },
    { grp: 'Orders' },
    { path: 'confirmations', label: 'Order Confirmation', icon: 'check', perm: 'orders.view' },
    { path: 'pos', label: 'Purchase Orders', icon: 'po', perm: 'orders.view' },
    { path: 'pools', label: 'Order Pool Management', icon: 'pool', perm: 'pools.view' },
    { grp: 'Pool operations' },
    { path: 'expenses', label: 'Expense Management', icon: 'exp', perm: 'expenses.view' },
    { path: 'exceptions', label: 'Missing & Additional Items', icon: 'alert', perm: 'exceptions.view', count: () => Store.db.exceptions.filter((x) => x.status === 'PENDING').length },
    { path: 'shipments', label: 'Shipment Management', icon: 'ship', perm: 'shipments.view' },
    { path: 'limits', label: 'Expense Limit Analysis', icon: 'limit', perm: ['reports.view', 'expenses.view'] },
    { path: 'profitability', label: 'Profitability Reports', icon: 'profit', perm: 'reports.view' },
    { path: 'closure', label: 'Pool Closure', icon: 'lock', perm: 'pools.view' },
    { grp: 'Administration' },
    { path: 'rates', label: 'Exchange Rates', icon: 'fx', perm: 'rates.view' },
    { path: 'users', label: 'User Management', icon: 'users', perm: 'users.manage' },
    { path: 'audit', label: 'Audit Logs', icon: 'audit', perm: 'audit.view' },
    { path: 'settings', label: 'Settings', icon: 'gear', perm: 'settings.manage' },
  ];
  const allowed = (perm) => !perm || (Array.isArray(perm) ? perm.some((p) => can(p)) : can(perm));

  const App = {
    routes: {}, hold: false, pendingRefresh: false, current: null,
    route(path, perm, fn) { this.routes[path] = { perm, fn }; },
    parse() {
      const h = location.hash.replace(/^#\/?/, '');
      const [path, query] = h.split('?');
      const q = {}; new URLSearchParams(query || '').forEach((v, k) => (q[k] = v));
      return { path: path || '', q };
    },
    go(path, q) { const s = q ? qs(q) : ''; const h = '#/' + path + (s ? '?' + s : ''); if (location.hash === h) this.refresh(); else location.hash = h; },
    async refresh() {
      if (this.hold) return;
      if (!Store.user) return this.renderAuth();
      if (!$('.app')) this.renderShell();
      let { path, q } = this.parse();
      if (!path) { const first = NAV.find((n) => n.path && allowed(n.perm)); path = first ? first.path : 'profile'; }
      const r = this.routes[path];
      const view = $('#view');
      this.updateNav(path);
      if (!r) { view.innerHTML = empty('Page not found', '', `<a class="btn" href="#/">Go home</a>`); return; }
      if (r.perm && !allowed(r.perm)) { view.innerHTML = empty('Access denied', `<p>Your role does not have permission to open this page.</p>`); return; }
      if (this.current !== location.hash && this.current !== null) modalStack.slice().forEach((m) => m.close());
      const scrollKeep = this.current === location.hash ? G.scrollY : 0;
      this.current = location.hash;
      try { await r.fn(view, q); } catch (e) { console.error(e); view.innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; }
      if (scrollKeep) G.scrollTo(0, scrollKeep);
    },
    updateNav(path) {
      const base = path.split('/')[0];
      $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.p === base));
      $$('.nav a').forEach((a) => { const n = NAV.find((x) => x.path === a.dataset.p); if (n && n.count) { const c = n.count(); const el = a.querySelector('.cnt'); if (el) { el.textContent = c; el.classList.toggle('hidden', !c); } } });
      this.updateBell();
      document.body.classList.remove('nav-open');
    },
    notifications() {
      const db = Store.db; const out = [];
      if (can('exceptions.view')) { const n = db.exceptions.filter((x) => x.status === 'PENDING').length; if (n) out.push({ t: `${n} missing / additional item decision(s) pending`, h: '#/exceptions?status=PENDING' }); }
      if (can('expenses.view')) { const n = db.expenses.filter((x) => !x.deletedAt && x.status === 'DRAFT').length; if (n) out.push({ t: `${n} draft expense entr${n === 1 ? 'y' : 'ies'} to complete`, h: '#/expenses' }); }
      if (can('pools.view')) {
        db.pools.filter((p) => p.status === 'DRAFT').forEach((p) => out.push({ t: `Pool ${p.poolNo} is still a draft`, h: `#/pools/view?id=${p.id}` }));
        db.pools.filter((p) => p.status === 'REOPENED').forEach((p) => out.push({ t: `Pool ${p.poolNo} is reopened for correction`, h: `#/closure?pool=${p.id}` }));
      }
      if (can('costing.view')) { const n = db.costings.filter((c) => c.status === 'DRAFT').length; if (n) out.push({ t: `${n} costing version(s) in draft`, h: '#/costing' }); }
      return out;
    },
    updateBell() { const d = $('#bellDot'); if (!d) return; const n = this.notifications().length; d.textContent = n; d.classList.toggle('hidden', !n); },
    renderShell() {
      const u = Store.user;
      const initials = u.name.split(/\s+/).map((x) => x[0]).join('').slice(0, 2).toUpperCase();
      document.getElementById('root').innerHTML = `
      <div class="app">
        <aside class="sidebar" aria-label="Main navigation">
          <div class="brand"><div class="logo">SP</div><div><b>${esc(Store.db.settings.company)}</b><span>Costing &amp; Profitability</span></div></div>
          <nav class="nav">${NAV.filter((n) => n.grp || allowed(n.perm)).map((n) => (n.grp ? `<div class="grp">${esc(n.grp)}</div>` : `<a href="#/${n.path}" data-p="${n.path}">${ico(n.icon)}<span>${esc(n.label)}</span>${n.count ? '<span class="cnt hidden"></span>' : ''}</a>`)).join('').replace(/(<div class="grp">[^<]*<\/div>)(?=<div class="grp">|$)/g, '')}</nav>
        </aside>
        <div class="scrim" id="scrim"></div>
        <div class="main">
          <header class="topbar">
            <button class="iconbtn burger" id="burger" aria-label="Open navigation">${ico('menu')}</button>
            <div class="gsearch" role="search">${ico('search')}<input type="search" id="gq" placeholder="Search styles, POs, pools, buyers, quotes…" aria-label="Global search" autocomplete="off"><div class="gresults hidden" id="gres"></div></div>
            <div class="top-actions">
              <div style="position:relative"><button class="iconbtn" id="bell" aria-label="Notifications">${ico('bell')}<span class="dot hidden" id="bellDot"></span></button></div>
              <div style="position:relative"><button class="userchip" id="uchip" aria-haspopup="true"><span class="avatar">${esc(initials)}</span><span class="nm small"><b>${esc(u.name)}</b><br><span class="muted">${esc(SP.ROLES[u.role])}</span></span></button></div>
            </div>
          </header>
          <main class="content" id="view" tabindex="-1"></main>
        </div>
      </div>`;
      $('#burger').onclick = () => document.body.classList.toggle('nav-open');
      $('#scrim').onclick = () => document.body.classList.remove('nav-open');
      const closeMenus = () => $$('.menu').forEach((m) => m.remove());
      if (!App._docClick) { App._docClick = true; document.addEventListener('click', (e) => { if (!e.target.closest('.menu') && !e.target.closest('#bell') && !e.target.closest('#uchip')) closeMenus(); if (!e.target.closest('.gsearch')) $('#gres') && $('#gres').classList.add('hidden'); }); }
      $('#bell').onclick = (e) => {
        e.stopPropagation(); const open = $('#bell').parentNode.querySelector('.menu'); closeMenus(); if (open) return;
        const list = this.notifications();
        const m = document.createElement('div'); m.className = 'menu'; m.style.minWidth = '300px';
        m.innerHTML = `<div class="head"><b>Notifications</b></div>${list.length ? list.map((n) => `<a class="note" href="${n.h}">${esc(n.t)}</a>`).join('') : '<div class="note muted">Nothing needs your attention.</div>'}`;
        $('#bell').parentNode.appendChild(m); m.onclick = () => closeMenus();
      };
      $('#uchip').onclick = (e) => {
        e.stopPropagation(); const open = $('#uchip').parentNode.querySelector('.menu'); closeMenus(); if (open) return;
        const m = document.createElement('div'); m.className = 'menu';
        m.innerHTML = `<div class="head"><b>${esc(u.name)}</b><div class="small muted">${esc(u.email)} · ${esc(SP.ROLES[u.role])}</div></div><button id="mPw">Change password</button><button id="mOut">Sign out</button>`;
        $('#uchip').parentNode.appendChild(m);
        $('#mPw').onclick = () => { closeMenus(); Pages.changePassword(); };
        $('#mOut').onclick = () => { SP.svc.logout(); document.getElementById('root').innerHTML = ''; App.refresh(); };
      };
      // global search
      const gq = $('#gq'), gres = $('#gres');
      let sel = -1;
      gq.addEventListener('input', () => {
        const q = gq.value.trim().toLowerCase(); sel = -1;
        if (q.length < 2) return gres.classList.add('hidden');
        const db = Store.db; const out = [];
        const B = (id) => SP.byId(db, 'buyers', id);
        if (can('styles.view')) db.styles.filter((s) => (s.styleRef + ' ' + s.description + ' ' + s.code).toLowerCase().includes(q)).slice(0, 6).forEach((s) => out.push({ k: 'Style', t: `${s.styleRef} — ${s.description || ''}`, h: `#/styles?view=${s.id}` }));
        if (can('orders.view')) db.pos.filter((p) => p.poNumber.toLowerCase().includes(q)).slice(0, 5).forEach((p) => out.push({ k: 'PO', t: `${p.poNumber} — ${(B(p.buyerId) || {}).name || ''}`, h: `#/pos/view?id=${p.id}` }));
        if (can('orders.view')) db.lines.filter((l) => l.confNo.toLowerCase().includes(q)).slice(0, 4).forEach((l) => out.push({ k: 'Order', t: `${l.confNo} — ${l.combo}`, h: `#/confirmations?view=${l.id}` }));
        if (can('pools.view')) db.pools.filter((p) => p.poolNo.toLowerCase().includes(q)).slice(0, 5).forEach((p) => out.push({ k: 'Pool', t: `${p.poolNo} — ${p.status}`, h: `#/pools/view?id=${p.id}` }));
        if (can('buyers.view')) db.buyers.filter((b) => (b.name + ' ' + b.code).toLowerCase().includes(q)).slice(0, 4).forEach((b) => out.push({ k: 'Buyer', t: `${b.name} (${b.code})`, h: `#/buyers?view=${b.id}` }));
        if (can('quotes.view')) db.quotes.filter((x) => x.quoteNo.toLowerCase().includes(q)).slice(0, 4).forEach((x) => out.push({ k: 'Quote', t: `${x.quoteNo} — ${x.label}`, h: `#/quotes?view=${x.id}` }));
        if (can('shipments.view')) db.shipments.filter((x) => !x.deletedAt && (x.shipNo + ' ' + x.invoiceRef).toLowerCase().includes(q)).slice(0, 4).forEach((x) => out.push({ k: 'Shipment', t: `${x.shipNo} ${x.invoiceRef || ''}`, h: `#/shipments?view=${x.id}` }));
        gres.innerHTML = out.length ? out.map((o, i) => `<a href="${o.h}" data-i="${i}"><span class="k">${o.k}</span>${esc(o.t)}</a>`).join('') : '<div class="empty small">No matches</div>';
        gres.classList.remove('hidden');
      });
      gq.addEventListener('keydown', (e) => {
        const items = $$('a', gres);
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, Math.min(items.length - 1, sel + (e.key === 'ArrowDown' ? 1 : -1))); items.forEach((a, i) => a.classList.toggle('sel', i === sel)); }
        if (e.key === 'Enter' && items[sel >= 0 ? sel : 0]) { location.hash = items[sel >= 0 ? sel : 0].getAttribute('href'); gres.classList.add('hidden'); gq.value = ''; gq.blur(); }
        if (e.key === 'Escape') gres.classList.add('hidden');
      });
      gres.addEventListener('click', () => { gres.classList.add('hidden'); gq.value = ''; });
    },
    renderAuth() {
      const root = document.getElementById('root');
      const setup = !SP.svc.hasUsers();
      root.innerHTML = `<div class="auth"><form class="box" id="authf" novalidate>
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:14px"><div class="avatar" style="background:var(--brand);width:40px;height:40px;border-radius:9px">SP</div><div><b>${esc(Store.db.settings.company)}</b><div class="small muted">Garment Costing &amp; Profitability</div></div></div>
        <h1>${setup ? 'Create administrator' : 'Sign in'}</h1><p>${setup ? 'First run: create the administrator account. You can add other users and roles afterwards.' : 'Use your account to continue.'}</p>
        <div class="form-error hidden" role="alert"></div>
        ${form(setup ? [
          { name: 'name', label: 'Full name', required: true, span: 's12', autocomplete: 'name' },
          { name: 'email', label: 'Email', type: 'email', required: true, span: 's12', autocomplete: 'username' },
          { name: 'password', label: 'Password', type: 'password', required: true, span: 's12', help: 'At least 8 characters with letters and numbers', autocomplete: 'new-password' },
          { name: 'password2', label: 'Confirm password', type: 'password', required: true, span: 's12', autocomplete: 'new-password' },
        ] : [
          { name: 'email', label: 'Email', type: 'email', required: true, span: 's12', autocomplete: 'username' },
          { name: 'password', label: 'Password', type: 'password', required: true, span: 's12', autocomplete: 'current-password' },
        ])}
        <button class="btn primary" style="width:100%;margin-top:16px" type="submit">${setup ? 'Create account' : 'Sign in'}</button>
        <p class="small" style="margin-top:14px">Data is stored in this browser (IndexedDB). Use Settings → Data → Backup regularly.</p>
      </form></div>`;
      const f = $('#authf');
      f.onsubmit = (e) => {
        e.preventDefault();
        run(f.querySelector('button[type=submit]'), async () => {
          const v = read(f);
          if (setup) { if (v.password !== v.password2) throw new AppError('Passwords do not match', 'password2'); await SP.svc.setupAdmin(v); }
          else await SP.svc.login(v.email, v.password);
          root.innerHTML = ''; App.refresh();
        }, f);
      };
      setTimeout(() => { const i = f.querySelector('input'); i && i.focus(); }, 20);
    },
  };

  /** Remove a one-shot query param (e.g. ?view=) so the modal is not reopened on refresh. */
  function consume(param) {
    const [path, query] = location.hash.split('?');
    const u = new URLSearchParams(query || ''); if (!u.has(param)) return;
    u.delete(param); const h = path + (u.toString() ? '?' + u.toString() : '');
    history.replaceState(null, '', h); App.current = h;
  }
  const Pages = {};
  G.SP.UI = { esc, $, $$, ico, toast, modal, confirm, ask, run, form, field, read, enhance, setOptions, table, act, downloadCSV, downloadXLS, download, printDoc, consume, pickFile, readText, readDataUrl, imageToDataUrl, badge, status, testTag, signed, pageHead, btn, guard, empty, fmtDate, fmtDT, qs, showError, clearErrors, modalStack };
  G.SP.App = App; G.SP.Pages = Pages; G.SP.NAV = NAV;
})(window);
