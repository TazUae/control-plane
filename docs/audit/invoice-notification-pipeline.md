# Invoice-submitted notification pipeline — implementation plan (NOT IMPLEMENTED)

**Status:** Planned. **Not implemented this run** — control-plane lacks the required primitives, and the work belongs (mostly) in FitDesk's domain. The receiver remains **fail-visible** (`INVOICE_WEBHOOK_NOTIFY_ENABLED=false` → 503), which is safe.

## Why control-plane cannot build this safely today (audited on `origin/main`)
- **No Whish client** — only `WHISH_MONEY_API_URL/KEY` env vars; no payment-link code.
- **No Evolution/WhatsApp client** — only `EVOLUTION_API_URL/KEY/INSTANCE` env vars; no send code.
- **No client-phone resolution** — the customer's phone lives in the **tenant's ERPNext** (Contact/Customer); control-plane has **no general ERP read client** (and the ERP proxy, M1, doesn't exist yet).
- Only the **provisioning** queue exists; a notification queue here would have **no valid processor** (it would need the three missing primitives), so building it now is premature scaffolding.

Per FitDesk's own rules, **clients, Whish payments, and Evolution/WhatsApp are FitDesk's domain.** Re-implementing them in control-plane would duplicate that domain and add new ERP I/O — so this is a **FitDesk-ownership decision**, not a control-plane-only task.

## Pipeline (each step + data source)
1. **Resolve customer phone** — from the tenant's ERPNext Contact/Customer. *Owner: FitDesk* (already reads client/contact data). Control-plane would need an ERP read path (M1 proxy) it doesn't have.
2. **Generate Whish payment link** — POST to the Whish Money API. *Owner: FitDesk* (has the Whish provider abstraction).
3. **Send WhatsApp** — via Evolution API with the payment link (templated). *Owner: FitDesk* (owns Evolution).
4. **Confirm success** — return success **only after** the WhatsApp send is confirmed.

## Ownership recommendation
- **Recommended (MVP): FitDesk owns the notification; control-plane stays the secure intake and forwards.** When `INVOICE_WEBHOOK_NOTIFY_ENABLED=true`, control-plane (after auth + dedupe + audit) makes a **signed internal request** to a new FitDesk endpoint that resolves the phone, creates the Whish link, sends WhatsApp, and returns `{ sent: true|false }`. Control-plane returns **`200 { ok:true, sent:true }` only on FitDesk's confirmed `sent:true`**; any failure → **non-2xx** + audited reason + **no idempotency success key**. Keeps the ERP→control-plane URL stable and respects domain ownership; nothing Whish/Evolution/ERP-read is duplicated in control-plane.
- **Long-term alternative:** re-point the ERP server script to POST directly to a FitDesk endpoint (change `fitdesk_setup.py` generator + re-provision tenants). Cleaner, but a larger ERP-side migration.

## MVP must be SYNCHRONOUS confirmed-send (until the ERP contract changes)
The ERP server script marks `custom_whatsapp_sent=1` on **any 2xx** and does not inspect the body. So for MVP, **200 must mean actually sent** — i.e., synchronous send before ack. A **queued/async** design requires first changing the ERP script to mark sent only on **`{ ok:true, sent:true }`** (and re-provisioning existing tenants); only then can control-plane return 2xx-on-queued safely. Until that contract change, do **not** introduce an async queue for this.

## Failure semantics (when flag on)
- Missing phone/contact → non-2xx, audit `reason: missing_contact`, no success key.
- Whish link failure → non-2xx, audit `reason: whish_failed`, no success key.
- WhatsApp send failure → non-2xx, audit `reason: whatsapp_failed`, no success key.
- All succeed → write idempotency key, write success audit, return `{ ok:true, sent:true }`.
- Replay after success → deduped; replay after failure → **not** deduped (no key was written).
- Never log secrets, full payloads, or the payment URL.

## Tests to write first (when implemented)
flag false → 503; flag true + missing phone → non-2xx; + Whish failure → non-2xx; + WhatsApp failure → non-2xx; success → `{ ok:true, sent:true }`; replay-after-success deduped; replay-after-failure not deduped; no secret in logs/audit; H4 rate-limit still passes.

## Deferred / decisions needed
- **Ownership decision** (recommend FitDesk-owned, control-plane forwards) — needs sign-off; cross-repo work (new FitDesk endpoint + signed control-plane→FitDesk client).
- **ERP script `{ ok:true, sent:true }` contract change** + tenant re-provision (required before any queued/async path).
- **Whish `payment-confirmed` HMAC webhook** (separate event; HMAC over raw body from `X-Whish-Signature`).
- Keep `INVOICE_WEBHOOK_NOTIFY_ENABLED=false` until confirmed-send exists.
