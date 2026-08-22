/** Quota funnel tests with a fake localStorage. */
import { pathToFileURL } from "node:url";

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};

const mod = await import(pathToFileURL("C:/Users/bapti/Downloads/pelure/js/auth.js").href);
const { consumeOne, refundOne, canCut, quota, signup, currentUser, paidBatchSize } = mod;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

for (let i = 0; i < 10; i++) consumeOne();
assert(quota().used === 10, "guest used 10");
refundOne();
assert(quota().used === 9, "failed cut refunds");
consumeOne();
assert(quota().used === 10, "guest used 10 after refund");
assert(paidBatchSize(2, 5) === 2, "paid batch never exceeds remaining slots");
assert(paidBatchSize(0, 5) === 0, "empty remaining cuts nobody paid");
assert(paidBatchSize(Infinity, 5) === 3, "subscribed still batches by 3");
assert(paidBatchSize(10, 2) === 2, "paid batch never exceeds pending");
assert(canCut().ok === false && canCut().gate === "account", "11th needs account");
try { consumeOne(); throw new Error("should not consume"); } catch (e) {
  assert(e.gate === "account", "consume blocked as guest");
}

await signup("test@pullbg.com", "secret1");
assert(currentUser().email === "test@pullbg.com", "signed in");
assert(quota().remaining === 0, "guest usage transferred, no second 10");
assert(canCut().gate === "plan", "after account, wall is plan not login");

console.log("quota funnel ok", quota());
