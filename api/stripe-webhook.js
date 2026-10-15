// Vercel serverless function: /api/stripe-webhook
// Listens for `customer.subscription.deleted` on Gemstar's Unlimited plan.
// Unlimited's intro offer is 10% off the first 3 months, on the condition
// (disclosed in legal.html) that the subscriber stays subscribed through
// that 3-month window -- cancel early and Gemstar recoups the discount for
// however many of those months were already billed at the reduced rate.
// Completing all 3 discounted months (or never receiving the discount at
// all) triggers no charge.
//
// No Stripe SDK is used anywhere in this codebase (everything else is
// hand-rolled `fetch` calls to Stripe's REST API), so the webhook signature
// is verified by hand too, the same way Stripe's own docs describe doing it
// without the SDK: HMAC-SHA256 over "{timestamp}.{raw body}" using the
// endpoint's signing secret, compared against the `Stripe-Signature` header.
// That means this handler needs the EXACT raw request bytes, not Vercel's
// parsed req.body -- hence `module.exports.config` below, which turns off
// Vercel's automatic body parsing for this function specifically.
//
// Idempotency: Stripe can and does redeliver webhooks. Supabase's
// `gemstar_clawback_charges` table (subscription_id primary key) is used as
// a claim: the first thing this handler does for an eligible subscription
// is try to INSERT a `pending` row for it, with duplicates ignored at the
// database level. If that insert comes back empty, some delivery (this one
// or an earlier retry) already has this subscription claimed, so we stop --
// never double-charge on a redelivered event.
//
// Requires env vars: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Optional: RESEND_API_KEY / EMAIL_FROM (best-effort transparency email)

const crypto = require("crypto");
const C = require("./_lib/common");

const UNLIMITED_PRODUCT_ID = "prod_VGeeA7bsIqkNBz";
const FALLBACK_UNLIMITED_PRICE_CENTS = 9900; // used only if the price's unit_amount is ever missing
const DISCOUNT_PERCENT = 10;
const MAX_DISCOUNTED_MONTHS = 3;
const SIGNATURE_TOLERANCE_SECONDS = 300;

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Manual equivalent of Stripe's `stripe.webhooks.constructEvent`. Parses the
// "t=...,v1=...[,v1=...]" header, recomputes the HMAC over "{t}.{rawBody}",
// and timing-safe-compares against every v1 value present (Stripe can send
// more than one during secret rotation).
function verifyStripeSignature(rawBody, sigHeader, secret) {
  if (!sigHeader || !secret) return false;
  const parsed = String(sigHeader).split(",").reduce((acc, kv) => {
    const idx = kv.indexOf("=");
    if (idx === -1) return acc;
    const k = kv.slice(0, idx).trim();
    const v = kv.slice(idx + 1).trim();
    if (k === "t") acc.t = v;
    else if (k === "v1") acc.v1.push(v);
    return acc;
  }, { t: null, v1: [] });

  if (!parsed.t || !parsed.v1.length) return false;

  const signedPayload = `${parsed.t}.${rawBody.toString("utf8")}`;
  const expected = crypto.createHmac("sha256", secret).update(signedPayload).digest("hex");
  const expBuf = Buffer.from(expected, "hex");
  const sigMatches = parsed.v1.some((v1) => {
    const vBuf = Buffer.from(v1, "hex");
    return vBuf.length === expBuf.length && crypto.timingSafeEqual(vBuf, expBuf);
  });
  if (!sigMatches) return false;

  const age = Math.floor(Date.now() / 1000) - parseInt(parsed.t, 10);
  return Number.isFinite(age) && Math.abs(age) <= SIGNATURE_TOLERANCE_SECONDS;
}

async function handleSubscriptionDeleted(sub, stripeKey) {
  if (!sub || !sub.id || !sub.customer) return;

  const items = (sub.items && sub.items.data) || [];
  const unlimitedItem = items.find((it) => it.price && it.price.product === UNLIMITED_PRODUCT_ID);
  if (!unlimitedItem) return; // clawback only applies to the Unlimited intro offer

  const cfg = C.sbConfig();
  if (!cfg) return; // without Supabase we can't safely dedupe -- skip rather than risk double-charging

  // Claim this subscription. An empty result means some delivery already
  // claimed (or finished) it -- stop here either way.
  const claimed = await C.sbRest(cfg, "gemstar_clawback_charges", {
    method: "POST",
    headers: Object.assign({}, cfg.headers, { Prefer: "resolution=ignore-duplicates,return=representation" }),
    body: JSON.stringify({
      subscription_id: sub.id,
      amount_cents: 0,
      months_discounted: 0,
      status: "pending",
    }),
  }).catch(() => []);
  if (!Array.isArray(claimed) || claimed.length === 0) return;

  try {
    // How many paid invoices on this subscription carried a discount? Since
    // Unlimited has no other discount mechanism in this codebase, "had a
    // discount at all" reliably means "had this intro coupon".
    const invResp = await fetch(
      `https://api.stripe.com/v1/invoices?subscription=${sub.id}&status=paid&limit=100`,
      { headers: { Authorization: `Bearer ${stripeKey}` } }
    );
    const invData = await invResp.json();
    const paidInvoices = (invData && invData.data) || [];
    const discountedCount = paidInvoices.filter(
      (inv) => Array.isArray(inv.total_discount_amounts) && inv.total_discount_amounts.length > 0
    ).length;
    const monthsDiscounted = Math.min(discountedCount, MAX_DISCOUNTED_MONTHS);

    // Completed the full 3-month commitment already, or never actually
    // received the discount -- nothing to claw back.
    if (monthsDiscounted <= 0 || monthsDiscounted >= MAX_DISCOUNTED_MONTHS) {
      await C.sbRest(cfg, `gemstar_clawback_charges?subscription_id=eq.${sub.id}`, {
        method: "PATCH",
        headers: Object.assign({}, cfg.headers, { Prefer: "return=minimal" }),
        body: JSON.stringify({ status: "not_applicable", months_discounted: monthsDiscounted }),
      });
      return;
    }

    const priceCents =
      typeof unlimitedItem.price.unit_amount === "number"
        ? unlimitedItem.price.unit_amount
        : FALLBACK_UNLIMITED_PRICE_CENTS;
    const amountCents = Math.round(monthsDiscounted * priceCents * (DISCOUNT_PERCENT / 100));
    const customerId = sub.customer;

    // Best-effort email lookup for the record + the transparency email below.
    let email = null;
    try {
      const custResp = await fetch(`https://api.stripe.com/v1/customers/${customerId}`, {
        headers: { Authorization: `Bearer ${stripeKey}` },
      });
      const cust = await custResp.json();
      email = (cust && cust.email) || null;
    } catch (e) {}

    const description =
      `Early-cancellation recoupment: ${monthsDiscounted} month(s) of the Unlimited intro 10% discount, ` +
      `per Gemstar's Terms of Service (3-month minimum to keep the intro rate).`;

    const itemParams = new URLSearchParams();
    itemParams.set("customer", customerId);
    itemParams.set("amount", String(amountCents));
    itemParams.set("currency", "usd");
    itemParams.set("description", description);
    await fetch("https://api.stripe.com/v1/invoiceitems", {
      method: "POST",
      headers: { Authorization: `Bearer ${stripeKey}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: itemParams.toString(),
    });

    const invParams = new URLSearchParams();
    invParams.set("customer", customerId);
    invParams.set("collection_method", "charge_automatically");
    invParams.set("auto_advance", "true");
    invParams.set("description", description);
    const createInvResp = await fetch("https://api.stripe.com/v1/invoices", {
      method: "POST",
      headers: { Authorization: `Bearer ${stripeKey}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: invParams.toString(),
    });
    const draftInvoice = await createInvResp.json();

    let finalInvoice = draftInvoice;
    if (draftInvoice && draftInvoice.id) {
      const finalizeResp = await fetch(`https://api.stripe.com/v1/invoices/${draftInvoice.id}/finalize`, {
        method: "POST",
        headers: { Authorization: `Bearer ${stripeKey}` },
      });
      finalInvoice = await finalizeResp.json();

      if (finalInvoice && finalInvoice.status !== "paid") {
        try {
          const payResp = await fetch(`https://api.stripe.com/v1/invoices/${draftInvoice.id}/pay`, {
            method: "POST",
            headers: { Authorization: `Bearer ${stripeKey}` },
          });
          const paid = await payResp.json();
          if (paid && paid.status) finalInvoice = paid;
        } catch (e) {}
      }
    }

    await C.sbRest(cfg, `gemstar_clawback_charges?subscription_id=eq.${sub.id}`, {
      method: "PATCH",
      headers: Object.assign({}, cfg.headers, { Prefer: "return=minimal" }),
      body: JSON.stringify({
        customer_email: email,
        amount_cents: amountCents,
        months_discounted: monthsDiscounted,
        stripe_charge_id: (finalInvoice && finalInvoice.id) || null,
        status: finalInvoice && finalInvoice.status === "paid" ? "charged" : "invoiced",
      }),
    });

    // Best-effort transparency email -- never fails the charge itself.
    if (email) {
      const amountDisplay = (amountCents / 100).toFixed(2);
      await C.sendEmail(
        email,
        "Your Gemstar Unlimited subscription was canceled",
        `<div style="font-family:sans-serif;max-width:420px;margin:auto;padding:24px;">` +
        `<img src="https://gemstaraudio.com/email-logo.png" width="140" alt="Gemstar" style="display:block;margin:0 auto 20px;">` +
        `<h2 style="margin:0 0 12px;">Your subscription has been canceled</h2>` +
        `<p style="color:#555;font-size:14px;">Your Unlimited plan included 10% off for your first 3 months, on the condition that you stayed subscribed through that period (see Gemstar's Terms of Service). ` +
        `Since you canceled before completing it, a one-time charge of $${amountDisplay} was applied to recover that discount for the ${monthsDiscounted} month(s) you already received it.</p>` +
        `<p style="color:#888;font-size:13px;">Questions? Email Gemstaraudio@gmail.com.</p>` +
        `</div>`
      );
    }
  } catch (err) {
    await C.sbRest(cfg, `gemstar_clawback_charges?subscription_id=eq.${sub.id}`, {
      method: "PATCH",
      headers: Object.assign({}, cfg.headers, { Prefer: "return=minimal" }),
      body: JSON.stringify({ status: "failed" }),
    }).catch(() => {});
    throw err;
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).end();
    return;
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!webhookSecret || !stripeKey) {
    res.status(500).end();
    return;
  }

  let raw;
  try {
    raw = await readRawBody(req);
  } catch (e) {
    res.status(400).end();
    return;
  }

  const sigHeader = req.headers["stripe-signature"];
  if (!verifyStripeSignature(raw, sigHeader, webhookSecret)) {
    res.status(400).json({ error: "Invalid signature" });
    return;
  }

  let event;
  try {
    event = JSON.parse(raw.toString("utf8"));
  } catch (e) {
    res.status(400).json({ error: "Invalid payload" });
    return;
  }

  if (event.type === "customer.subscription.deleted") {
    try {
      await handleSubscriptionDeleted(event.data && event.data.object, stripeKey);
    } catch (err) {
      // Respond 200 regardless -- the Supabase row (claimed above) records
      // what happened, and we don't want Stripe hammering retries over a
      // bug on our side while it's being investigated.
    }
  }

  res.status(200).json({ received: true });
};

// Vercel needs the exact raw request bytes to verify Stripe's signature
// (see the comment at the top of this file), so automatic JSON body
// parsing is turned off for this function only.
module.exports.config = { api: { bodyParser: false } };
