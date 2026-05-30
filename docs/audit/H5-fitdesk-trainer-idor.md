# H5 — FitDesk trainer ownership / IDOR (AUDIT + PLAN ONLY)

**Status:** Audit only. **No FitDesk code changed in this run** (per task scope; FitDesk auth/ownership semantics are approval-gated and need FitDesk's own test harness).
Target repo for the fix: **`FitDesk`** (not control-plane).

## Problem
Some FitDesk server-action write paths trust client-supplied identifiers instead of deriving them from the session. Today this is contained by (a) the Control Plane JWT pinning the tenant (no cross-tenant access) and (b) the single-trainer-per-tenant invariant. It becomes a real **intra-tenant IDOR** the moment multi-trainer-per-tenant ships.

## Evidence
- `FitDesk/lib/scheduling/bookingService.ts:148-161` — `bookFromPlan` writes `trainerId: plan.trainerId` and `clientId: plan.clientId` straight from the **client-supplied** `plan`.
- `FitDesk/actions/schedulingActions.ts:242-261` — `bookPlanAction` resolves `trainer` from the session but passes `plan` through unchanged; the "client-computed plan is not trusted for authorization" comment only applies to the conflict-window fetch (`findSessionsInRange`), **not** the write.
- `FitDesk/lib/scheduling/sessionService.ts` (reschedule/cancel/complete/markNoShow) — fetch by docname via `sessionRepository.findSessionById` with no assertion that the session belongs to the calling trainer.
- `FitDesk/actions/invoices.ts` (`getInvoiceById`) / ERP `fetchInvoiceById` — no per-trainer ownership filter.

## Impact
Intra-tenant only (cross-tenant blocked by the proxy JWT): a directly-invoked server action can attribute sessions/invoices to another trainer, or act on another trainer's session/invoice by id. Low under single-trainer-per-tenant; **High** once multi-trainer.

## Implementation plan (minimal, defense-in-depth)
1. **Server-derive identity:** in `bookFromPlan`/`bookPlanAction`, override `plan.trainerId` with the session-derived `config.trainerId` and reject/ignore any mismatching client value. (Small, well-isolated.)
2. **Ownership guard:** add `assertSessionOwnedBy(trainerId, session)` and call it in reschedule/cancel/complete/markNoShow after `findSessionById`.
3. **Invoices:** once a `custom_trainer_id` field exists, filter invoice reads by it; until then document the single-trainer constraint and don't expose invoice-by-id to multi-trainer tenants.
4. **Tests:** directly-invoked `bookPlanAction` with a forged `plan.trainerId` → overridden/rejected; mutation on a non-owned session → denied.

## Why deferred this run
- The booking fix is fairly isolated, but FitDesk has its own working tree/test harness not validated here, and changing authorization semantics is approval-gated.
- **Prerequisite:** confirm the single-trainer-per-tenant invariant is actually enforced upstream before relying on it as the current mitigation.
