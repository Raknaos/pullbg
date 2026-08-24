/** Comptes locaux + quota journalier. Guest d’abord, compte seulement au mur. */

const USERS_KEY = "pullbg_users_v1";
const SESSION_KEY = "pullbg_session_v1";
const USAGE_KEY = "pullbg_usage_v1";
const GUEST_KEY = "pullbg_guest_v1";
const DAILY = 10;

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function todayLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function nextResetAt() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0);
}

export function formatCountdown(ms) {
  if (ms <= 0) return "quelques secondes";
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} h ${String(m).padStart(2, "0")}`;
  if (m > 0) return `${m} min`;
  return `${s} s`;
}

function loadUsers() {
  try { return JSON.parse(localStorage.getItem(USERS_KEY) || "[]"); } catch { return []; }
}
function saveUsers(users) { localStorage.setItem(USERS_KEY, JSON.stringify(users)); }

function loadUsage() {
  try { return JSON.parse(localStorage.getItem(USAGE_KEY) || "{}"); } catch { return {}; }
}

function guestRec() {
  try { return JSON.parse(localStorage.getItem(GUEST_KEY) || "null"); } catch { return null; }
}

function usedToday(rec) {
  if (!rec || rec.date !== todayLocal()) return 0;
  return rec.used || 0;
}

export function currentUser() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch { return null; }
}

export function logout() { localStorage.removeItem(SESSION_KEY); }

export function isSubscribed(user) {
  if (!user) return false;
  if (user.plan !== "monthly" && user.plan !== "yearly") return false;
  if (!user.planUntil) return true;
  return user.planUntil >= todayLocal();
}

export function quota() {
  const user = currentUser();
  if (user && isSubscribed(user)) {
    return {
      used: 0,
      limit: Infinity,
      remaining: Infinity,
      subscribed: true,
      guest: false,
      needAccount: false,
      resetAt: nextResetAt().toISOString(),
    };
  }
  if (user) {
    const rec = loadUsage()[user.email];
    const used = usedToday(rec);
    return {
      used,
      limit: DAILY,
      remaining: Math.max(0, DAILY - used),
      subscribed: false,
      guest: false,
      needAccount: false,
      resetAt: nextResetAt().toISOString(),
    };
  }
  const used = usedToday(guestRec());
  return {
    used,
    limit: DAILY,
    remaining: Math.max(0, DAILY - used),
    subscribed: false,
    guest: true,
    needAccount: used >= DAILY,
    resetAt: nextResetAt().toISOString(),
  };
}

export function canCut() {
  const q = quota();
  if (q.subscribed) return { ok: true, q };
  if (q.remaining > 0) return { ok: true, q };
  if (q.guest) return { ok: false, gate: "account", q };
  return { ok: false, gate: "plan", q };
}

/** How many pending jobs can consume a quota slot in this parallel batch. */
export function paidBatchSize(remaining, pending, max = 3) {
  if (!Number.isFinite(remaining)) return Math.min(max, pending);
  return Math.min(max, pending, Math.max(0, remaining));
}

export function consumeOne() {
  const user = currentUser();
  if (user && isSubscribed(user)) return quota();
  const day = todayLocal();
  if (user) {
    const usage = loadUsage();
    const used = usedToday(usage[user.email]);
    if (used >= DAILY) throw Object.assign(new Error("quota"), { gate: "plan" });
    usage[user.email] = { date: day, used: used + 1 };
    localStorage.setItem(USAGE_KEY, JSON.stringify(usage));
    return quota();
  }
  const used = usedToday(guestRec());
  if (used >= DAILY) throw Object.assign(new Error("quota"), { gate: "account" });
  localStorage.setItem(GUEST_KEY, JSON.stringify({ date: day, used: used + 1 }));
  return quota();
}

export function refundOne() {
  const user = currentUser();
  if (user && isSubscribed(user)) return quota();
  const day = todayLocal();
  if (user) {
    const usage = loadUsage();
    const used = usedToday(usage[user.email]);
    if (!used) return quota();
    usage[user.email] = { date: day, used: used - 1 };
    localStorage.setItem(USAGE_KEY, JSON.stringify(usage));
    return quota();
  }
  const used = usedToday(guestRec());
  if (!used) return quota();
  localStorage.setItem(GUEST_KEY, JSON.stringify({ date: day, used: used - 1 }));
  return quota();
}

function transferGuestInto(email) {
  const used = usedToday(guestRec());
  if (!used) return;
  const usage = loadUsage();
  const already = usedToday(usage[email]);
  usage[email] = { date: todayLocal(), used: Math.max(already, used) };
  localStorage.setItem(USAGE_KEY, JSON.stringify(usage));
}

export async function signup(email, password) {
  email = email.trim().toLowerCase();
  if (!email.includes("@") || password.length < 6) throw new Error("Email valide et mot de passe ≥ 6 caractères.");
  const users = loadUsers();
  if (users.some((u) => u.email === email)) throw new Error("Ce compte existe déjà.");
  const user = { email, pass: await sha256(password), created: Date.now(), plan: "free", planUntil: null };
  users.push(user);
  saveUsers(users);
  transferGuestInto(email);
  const session = { email, plan: user.plan, planUntil: user.planUntil };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export async function login(email, password) {
  email = email.trim().toLowerCase();
  const user = loadUsers().find((u) => u.email === email);
  if (!user || user.pass !== await sha256(password)) throw new Error("Identifiants incorrects.");
  const session = { email, plan: user.plan, planUntil: user.planUntil };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export function setPlan(plan) {
  const session = currentUser();
  if (!session) throw new Error("Connecte-toi.");
  const until = new Date();
  if (plan === "monthly") until.setMonth(until.getMonth() + 1);
  else if (plan === "yearly") until.setFullYear(until.getFullYear() + 1);
  else throw new Error("Offre inconnue.");
  const users = loadUsers();
  const u = users.find((x) => x.email === session.email);
  const iso = until.toISOString().slice(0, 10);
  if (u) {
    u.plan = plan;
    u.planUntil = iso;
  }
  saveUsers(users);
  session.plan = plan;
  session.planUntil = iso;
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export function paintNav() {
  const user = currentUser();
  const slot = document.querySelector("[data-auth]");
  if (!slot) return;
  slot.innerHTML = user
    ? `<a href="./account.html">${user.email}</a>`
    : `<a href="./login.html">Compte</a>`;
}

export function clientId() {
  const user = currentUser();
  if (user && user.email) return user.email;
  let id = localStorage.getItem("studiocut_cid");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("studiocut_cid", id);
  }
  return id;
}

export function quotaLabel(q = quota()) {
  if (q.subscribed) return "Illimité";
  const left = `${q.remaining} / ${q.limit} aujourd’hui`;
  if (q.remaining > 0) return left;
  return `${left} · nouveau lot dans ${formatCountdown(nextResetAt() - Date.now())}`;
}
