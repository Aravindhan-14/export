# Sports Pro — Garment Costing & Profitability (single-file app)

**Deliverable: `index.html`** — one self-contained file. Open it in Chrome, Edge, Firefox or Safari (desktop or mobile). No server, no install, works offline.

## Quick start
1. Double-click `index.html` (or host it on any static web server / intranet share).
2. First run: create the **administrator** account.
3. Optional: *Settings → Data → Load BGPL-001 test data* to see the full workflow with the source example (all records tagged **TEST DATA**; remove them from the same screen).
4. *User Management* → add users and roles; *Roles & permissions* tab to adjust the permission matrix.

## Where the data lives
* Stored in the browser's **IndexedDB** on that device/browser profile (not shared between computers).
* **Back up regularly:** *Settings → Data → Download backup (.json)*; restore from the same screen.
* Multiple tabs are safe: every save checks a revision number atomically, so two tabs cannot both allocate the same PO quantity (the second gets "data was changed in another window" and must retry).
* For multi-user access over a network the same data model and services can be moved to a server (PostgreSQL) — the business logic in `src/core.js` / `src/store.js` is UI-independent.

## Security notes
Passwords are hashed (PBKDF2-SHA256, 120 000 iterations, per-user salt); 5 failed logins lock the account for 5 minutes; sessions expire (Settings). Permissions are enforced in the data-service layer for every operation, not only by hiding buttons. **Limitation:** because everything runs inside the browser, anyone with access to that computer's browser profile could read the raw IndexedDB data with developer tools — this is local access control, not server-grade security.

## Modules
Dashboard · Buyers · Style Master (images, size sets, expected qty) · Costing Inputs (live editor, versions, Save As, approve, copy rows) · Quote & Revised Quotes (compare, print/PDF) · Order Confirmation (size-wise qty, price history) · Purchase Orders · Order Pool Management (allocation, release, history) · Expense Management (per pool, per category, payments, attachments, copy table) · Missing & Additional Items · Shipment Management + Pool Shipment Summary (additions/deductions) · Expense Limit Analysis (drill-down) · Profitability Reports (pool / style / buyer / season / category; CSV, Excel, PDF) · Pool Closure (checklist, snapshot, reopen) · Exchange Rates · User Management · Audit Logs · Settings (formulas, lists, policies, CSV import, backup).

PDF output uses the browser's print dialog (**Print / Save as PDF**). Excel export produces `.xls` (Excel XML workbook, multi-sheet).

## Formulas (formula version `SP-COST-1.0`)
All money uses exact decimal arithmetic (BigInt fixed-point, no floating point).

| Item | Formula | Verified against source |
|---|---|---|
| Expected qty | qty per combo × number of combos | 250 × 4 = 1000 |
| Costing row | qty/consumption × rate × (1 + allowance %), 2 dp | fabric loss **5%**: 0.080×500→42.00, 0.030×450→14.18 |
| Total INR | items total + overall % amount | 148.90 + 40% = 208.46 |
| Foreign price | total INR ÷ INR per unit (4 dp) | 208.46 ÷ 115 = £1.8127 |
| Shipment value | shipped qty × confirmed price | 248 × £1.65 = £409.20 |
| INR value | foreign value × shipment rate | £409.20 × 116 = ₹47,467.20 |
| Qty difference | shipped − ordered | 248 − 250 = −2 |
| Adjusted INR (INR received) | INR value + additions − deductions | 224,645.60 + 2,300 − 4,500 = 222,445.60 |
| Expense limit | Σ(allocated qty × costing cost/pc) × (1 + variance %) | 440 × 50.40 × (1 − 3.99%) = 21,291.18 |
| Expense difference | limit − actual (positive = under limit) | |
| Budget-based margin | INR received − Σ expense limits (estimate) | |
| Actual-based margin | INR received − Σ actual expenses (result) | 222,445.60 − 174,710 = **47,735.60** |

Additions/deductions are counted once (inside INR received) and never deducted again from margins.

Rules: remaining pool-eligible qty = order qty − Σ **active** allocations (released allocations don't count; closed-pool allocations do). Shipments above order × (1 + max excess %, default 5%) need commercial acceptance. Rates are copied onto costings/shipments when saved and are never recalculated.

## Findings from the source documents — please confirm
1. **Expense limits vs actuals are swapped in the brief.** In the source summary, ₹160,014.47 is the "as per costing" (expense limit) column — it contains the computed fabric 58,493.13, application 28,995.02 and CMT 41,476.32 — and ₹174,710 is "actual expenses". So the source's "Margin (including OH) 47,736" = INR received − **actual** expenses. The app implements it that way; the budget-based margin for the source figures would be 222,445.60 − 160,014.47 = ₹62,431.13.
2. **Source difference sign is Actual − Limit** (fabric +2,006.87 when actual exceeds limit). The app uses the brief's convention Limit − Actual (positive = under limit).
3. **The −3.99% "average costing difference" cannot be reproduced** from the source prices: per-style differences are −8.98% (£1.65 vs £1.8127) and −3.12% (£2.00 vs £2.0644); simple average −6.05%, qty-weighted −5.60%, value-weighted −5.33%. The method is configurable (Settings → Expense limits, marked "pending confirmation") and a per-pool approved override exists; the test pool uses an override of −3.99% to reproduce the source rows.
4. **Trims / labelling / packaging / forwarding / others limits** in the source (13,400 / 5,600 / 3,200 / 4,850 / 4,000) do not follow from the costing sheet (e.g. labelling 1,040 pcs × ₹10 × 0.9601 = 9,985.04). They look like placeholders, so the app's computed total limit for the test pool is ₹160,590.16, not 160,014.47.
5. The detailed expense sheet (fabric ₹119,000, CMT ₹57,000) differs from the summary (₹60,500 / ₹65,000); the test data follows the summary.
6. Shipment note "Shortage 4 pc" for 250 ordered / 248 shipped is actually a shortage of 2.
7. The Revised 1 costing column (£1.67 / 185.70 / 130.50) does not reconcile; the test revision is illustrative only.
8. "Packaging" (expense summary) and "Pack Acc" (costing) are probably the same category; they are separate categories in the app, and the test data books packaging under Packing Accessories.

## Development
Source is in `src/`; `index.html` is generated:
```
node build.mjs        # rebuild index.html from src/
npm test              # 30 unit + workflow tests (Node 20+, no dependencies)
```
`tests/formulas.test.mjs` covers the formulas; `tests/workflow.test.mjs` runs the BGPL-001 regression, allocation limits (incl. concurrent attempts), quote revisions, shipment rules, closure/reopen, closed-pool locks, permissions and CSV import.
