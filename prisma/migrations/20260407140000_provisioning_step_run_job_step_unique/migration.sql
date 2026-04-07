-- Remove duplicate (jobId, step) rows; keep the row with latest startedAt (then id).
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "jobId", "step" ORDER BY "startedAt" DESC, "id" DESC) AS rn
  FROM "ProvisioningStepRun"
)
DELETE FROM "ProvisioningStepRun" WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- CreateIndex
CREATE UNIQUE INDEX "ProvisioningStepRun_jobId_step_key" ON "ProvisioningStepRun"("jobId", "step");
