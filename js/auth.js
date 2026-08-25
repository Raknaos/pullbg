/** Comptes : serveur sur cutbg.studio, localStorage hors ligne / tests. */

const USERS_KEY = "pullbg_users_v1";
const SESSION_KEY = "pullbg_session_v1";
const USAGE_KEY = "pullbg_usage_v1";
const GUEST_KEY = "pullbg_guest_v1";
const DAILY = 10;

function useServer() {
  try {
    return ["cutbg.studio", "www.cutbg.studio", "169.58.230.80"].includes(location.hostname);
  } catch {
    return false;
  }
}

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

function saveSession(session) {
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
  return session;
}

export async function refreshSession() {
  if (!useServer()) return currentUser();
  try {
    const r = await fetch("/api/me", { credentials: "include" });
    const u = await r.json();
    if (u && u.email) return saveSession({ email: u.email, plan: u.plan, planUntil: u.planUntil });
    localStorage.removeItem(SESSION_KEY);
    return null;
  } catch {
    return currentUser();
  }
}

export async function logout() {
  localStorage.removeItem(SESSION_KEY);
  if (useServer()) {
    try { await fetch("/api/logout", { method: "POST", credentials: "include" }); } catch {}
  }
}

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
  if (useServer()) {
    const r = await fetch("/api/signup", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Inscription impossible.");
    transferGuestInto(data.email);
    return saveSession(data);
  }
  if (!email.includes("@") || password.length < 6) throw new Error("Email valide et mot de passe ≥ 6 caractères.");
  const users = loadUsers();
  if (users.some((u) => u.email === email)) throw new Error("Ce compte existe déjà.");
  const user = { email, pass: await sha256(password), created: Date.now(), plan: "free", planUntil: null };
  users.push(user);
  saveUsers(users);
  transferGuestInto(email);
  return saveSession({ email, plan: user.plan, planUntil: user.planUntil });
}

export async function login(email, password) {
  email = email.trim().toLowerCase();
  if (useServer()) {
    const r = await fetch("/api/login", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Connexion impossible.");
    transferGuestInto(data.email);
    return saveSession(data);
  }
  const user = loadUsers().find((u) => u.email === email);
  if (!user || user.pass !== await sha256(password)) throw new Error("Identifiants incorrects.");
  return saveSession({ email, plan: user.plan, planUntil: user.planUntil });
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
  return saveSession(session);
}

export async function startCheckout(plan) {
  const r = await fetch("/api/checkout", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ plan }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "Paiement indisponible.");
  if (!data.url) throw new Error("Lien de paiement manquant.");
  location.href = data.url;
}

export async function confirmCheckout(sessionId) {
  const r = await fetch(`/api/pay/confirm?session_id=${encodeURIComponent(sessionId)}`, { credentials: "include" });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "Paiement non confirmé.");
  return saveSession(data);
}

export function paintNav() {
  const user = currentUser();
  const slot = document.querySelector("[data-auth]");
  if (!slot) return;
  slot.innerHTML = user
    ? `<a href="./account.html">${user.email}</a>`
    : `<a href="./login.html">Se connecter</a><a class="btn btn-acc nav-cta" href="./login.html?signup=1">S’inscrire</a>`;
}

export function clientId() {
  const user = currentUser();
  if (user && user.email) return user.email;
  let id = localStorage.getItem("cutbg_cid");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("cutbg_cid", id);
  }
  return id;
}

export function quotaLabel(q = quota()) {
  if (q.subscribed) return "Illimité";
  const left = `${q.remaining} / ${q.limit} aujourd’hui`;
  if (q.remaining > 0) return left;
  return `${left} · nouveau lot dans ${formatCountdown(nextResetAt() - Date.now())}`;
}
