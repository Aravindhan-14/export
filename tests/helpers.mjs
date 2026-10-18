// Loads the same source files that are inlined into index.html into Node's global scope.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let loaded = false;
export function load() {
  if (!loaded) {
    for (const f of ['src/core.js', 'src/store.js', 'src/seed.js']) {
      vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
    }
    loaded = true;
  }
  return globalThis.SP;
}

/** Fresh in-memory database with a logged-in administrator. */
export async function freshAdmin() {
  const SP = load();
  SP.Store.user = null;
  SP.Store.listeners = new Set();
  SP.Store._chain = Promise.resolve();
  await SP.Store.init(SP.MemoryAdapter());
  await SP.svc.setupAdmin({ name: 'Test Admin', email: 'admin@test.local', password: 'Admin12345' });
  return SP;
}

export async function asRole(SP, role, email) {
  const admin = SP.Store.user;
  await SP.svc.saveUser({ name: role + ' user', email, role, password: 'Passw0rd99', active: true });
  const u = SP.Store.db.users.find((x) => x.email === email);
  SP.Store.user = u;
  return () => { SP.Store.user = admin; };
}
