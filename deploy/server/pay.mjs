/** Stripe Checkout for Cut BG Studio. Confirm via session retrieve (no webhook required). */
import { userFromReq, setUserPlan } from "./accounts.mjs";

const KEY = process.env.STRIPE_SECRET_KEY || "";
const PRICES = {
  monthly: process.env.STRIPE_PRICE_MONTHLY || "",
  yearly: process.env.STRIPE_PRICE_YEARLY || "",
};
const SITE = process.env.PULLBG_PUBLIC_URL || "https://cutbg.studio";

async function stripe(method, path, form) {
  const body = form ? new URLSearchParams(form).toString() : undefined;
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error?.message || "Paiement indisponible.";
    throw Object.assign(new Error(msg), { status: 502 });
  }
  return data;
}

function untilIso(plan) {
  const d = new Date();
  if (plan === "yearly") d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}

export function paymentsReady() {
  return Boolean(KEY && PRICES.monthly && PRICES.yearly);
}

export function mountPay(app) {
  app.get("/api/pay/status", (_req, res) => {
    res.json({ ready: paymentsReady(), methods: ["card", "link"] });
  });

  app.post("/api/checkout", async (req, res) => {
    try {
      const u = await userFromReq(req);
      if (!u) return res.status(401).json({ error: "Connecte-toi." });
      const plan = req.body?.plan === "yearly" ? "yearly" : req.body?.plan === "monthly" ? "monthly" : "";
      if (!plan || !PRICES[plan]) return res.status(400).json({ error: "Offre inconnue." });
      if (!KEY) return res.status(503).json({ error: "Paiement pas encore branché." });
      const session = await stripe("POST", "/checkout/sessions", {
        mode: "subscription",
        "line_items[0][price]": PRICES[plan],
        "line_items[0][quantity]": "1",
        success_url: `${SITE}/pricing.html?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${SITE}/pricing.html?cancel=1`,
        customer_email: u.email,
        client_reference_id: u.email,
        "metadata[plan]": plan,
        "metadata[email]": u.email,
        "subscription_data[metadata][plan]": plan,
        "subscription_data[metadata][email]": u.email,
        allow_promotion_codes: "true",
        billing_address_collection: "auto",
      });
      res.json({ url: session.url });
    } catch (e) {
      res.status(e.status || 400).json({ error: e.message });
    }
  });

  app.get("/api/pay/confirm", async (req, res) => {
    try {
      const u = await userFromReq(req);
      if (!u) return res.status(401).json({ error: "Connecte-toi." });
      const id = String(req.query.session_id || "");
      if (!id.startsWith("cs_")) return res.status(400).json({ error: "Session invalide." });
      const session = await stripe("GET", `/checkout/sessions/${id}`);
      const email = session.metadata?.email || session.client_reference_id;
      const plan = session.metadata?.plan;
      if (email !== u.email) return res.status(403).json({ error: "Session d’un autre compte." });
      const paid = session.payment_status === "paid" || session.status === "complete";
      if (!paid || (plan !== "monthly" && plan !== "yearly")) {
        return res.status(400).json({ error: "Paiement incomplet." });
      }
      const user = await setUserPlan(u.email, plan, untilIso(plan));
      res.json({ email: user.email, plan: user.plan, planUntil: user.planUntil });
    } catch (e) {
      res.status(e.status || 400).json({ error: e.message });
    }
  });
}
