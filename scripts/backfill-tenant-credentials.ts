/**
 * H1 Phase C — tenant ERP credential backfill tool.
 *
 * Modes:
 *   (default)   dry-run  — scan, simulate sealing in memory, report counts. No writes.
 *   --verify             — report encryption coverage (counts only). No sealing, no writes.
 *   --apply              — write missing encrypted columns. GUARDED (see below). Never run
 *                          without a verified DB backup.
 *
 * Apply mode requires ALL of:
 *   --apply
 *   --i-have-a-db-backup
 *   --confirm-control-plane-credential-backfill
 *   ERP_CREDENTIAL_ENCRYPTION_ENABLED=true   (env)
 *   ERP_CREDENTIAL_ENCRYPTION_KEY valid       (env; sealing preflight)
 *
 * Safety: only seals fields where plaintext exists and *Enc is empty; never overwrites
 * an existing *Enc; never touches plaintext; never logs credential values.
 */
import { prisma } from "../src/lib/prisma.js";
import { env } from "../src/config/env.js";
import { sealSecret } from "../src/lib/crypto/secret-box.js";
import {
  buildTenantCredentialBackfillUpdate,
  summarizeCredentialBackfill,
  type BackfillTenant,
} from "../src/lib/tenant-credential-backfill.js";

const CREDENTIAL_SELECT = {
  id: true,
  erpApiKey: true,
  erpApiSecret: true,
  webhookSecret: true,
  erpApiKeyEnc: true,
  erpApiSecretEnc: true,
  webhookSecretEnc: true,
  credentialEncryptionVersion: true,
} as const;

function hasFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

/** Confirm the encryption key is present + valid by sealing a throwaway sentinel. */
function assertKeyUsable(): void {
  sealSecret("backfill-preflight-sentinel");
}

async function loadTenants(): Promise<BackfillTenant[]> {
  return prisma.tenant.findMany({ select: CREDENTIAL_SELECT });
}

async function runVerify(): Promise<number> {
  const tenants = await loadTenants();
  const s = summarizeCredentialBackfill(tenants);
  console.log("[credentials:verify]", JSON.stringify({
    totalScanned: s.totalScanned,
    alreadyComplete: s.alreadyComplete,
    incompleteNeedingBackfill: s.needingBackfill,
    skippedNoCredentials: s.skippedNoCredentials,
    missing: {
      erpApiKeyEnc: s.needingErpApiKeyEnc,
      erpApiSecretEnc: s.needingErpApiSecretEnc,
      webhookSecretEnc: s.needingWebhookSecretEnc,
    },
  }, null, 2));
  return 0;
}

async function runDryRun(): Promise<number> {
  // Require a valid key for the sealing simulation; fail safely otherwise.
  assertKeyUsable();
  const tenants = await loadTenants();
  const s = summarizeCredentialBackfill(tenants);

  // Sealing simulation: build (and discard) the update for each needing tenant to
  // prove the key seals every pending value. Nothing is written or logged.
  let simulatedSeals = 0;
  for (const tenant of tenants) {
    const update = buildTenantCredentialBackfillUpdate(tenant);
    if (update) simulatedSeals += 1;
  }

  console.log("[credentials:dry-run] NO WRITES PERFORMED", JSON.stringify({
    totalScanned: s.totalScanned,
    needingErpApiKeyEnc: s.needingErpApiKeyEnc,
    needingErpApiSecretEnc: s.needingErpApiSecretEnc,
    needingWebhookSecretEnc: s.needingWebhookSecretEnc,
    tenantsNeedingBackfill: s.needingBackfill,
    alreadyComplete: s.alreadyComplete,
    skippedNoCredentials: s.skippedNoCredentials,
    simulatedSeals,
    tenantIdsNeedingBackfill: s.tenantIdsNeedingBackfill,
  }, null, 2));
  return 0;
}

async function runApply(): Promise<number> {
  // ── Safety gates ──────────────────────────────────────────────────────────
  const missingGates: string[] = [];
  if (!hasFlag("--i-have-a-db-backup")) missingGates.push("--i-have-a-db-backup");
  if (!hasFlag("--confirm-control-plane-credential-backfill")) {
    missingGates.push("--confirm-control-plane-credential-backfill");
  }
  if (!env.ERP_CREDENTIAL_ENCRYPTION_ENABLED) {
    missingGates.push("ERP_CREDENTIAL_ENCRYPTION_ENABLED=true");
  }
  if (missingGates.length > 0) {
    console.error(
      "[credentials:apply] REFUSING TO RUN — missing required safety gates:",
      JSON.stringify(missingGates),
    );
    return 1;
  }
  // Key preflight (env already fails closed if ENABLED=true without a valid key,
  // but verify explicitly before any write).
  try {
    assertKeyUsable();
  } catch {
    console.error("[credentials:apply] REFUSING TO RUN — ERP_CREDENTIAL_ENCRYPTION_KEY is missing/invalid");
    return 1;
  }

  const tenants = await loadTenants();
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  for (const tenant of tenants) {
    const update = buildTenantCredentialBackfillUpdate(tenant);
    if (!update) {
      skipped += 1;
      continue;
    }
    try {
      await prisma.tenant.update({ where: { id: tenant.id }, data: update });
      updated += 1;
    } catch (err) {
      failed += 1;
      console.error(
        "[credentials:apply] update failed for tenant",
        tenant.id,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  console.log("[credentials:apply] done", JSON.stringify({ updated, skipped, failed }, null, 2));
  return failed > 0 ? 1 : 0;
}

async function main(): Promise<void> {
  const mode = hasFlag("--apply") ? "apply" : hasFlag("--verify") ? "verify" : "dry-run";
  let code = 1;
  try {
    if (mode === "apply") code = await runApply();
    else if (mode === "verify") code = await runVerify();
    else code = await runDryRun();
  } catch (err) {
    // Never print credential material in error paths.
    console.error(`[credentials:${mode}] aborted:`, err instanceof Error ? err.message : String(err));
    code = 1;
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
  process.exit(code);
}

void main();
