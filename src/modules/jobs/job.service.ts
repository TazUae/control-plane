import { ProvisioningStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { provisioningQueue } from "../../lib/queue.js";
import { logger } from "../../lib/logger.js";

export type LatestStepInfo = {
  step: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  error: string | null;
};

export type GetProvisioningJobResult = {
  id: string;
  tenantId: string;
  status: ProvisioningStatus;
  currentStep: string;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  latestStep: LatestStepInfo | null;
};

export async function getProvisioningJobById(id: string): Promise<GetProvisioningJobResult | null> {
  const job = await prisma.provisioningJob.findUnique({
    where: { id },
    select: {
      id: true,
      tenantId: true,
      status: true,
      currentStep: true,
      failureReason: true,
      createdAt: true,
      updatedAt: true,
      finishedAt: true,
      steps: {
        orderBy: { startedAt: "desc" },
        take: 1,
        select: {
          step: true,
          status: true,
          startedAt: true,
          finishedAt: true,
          error: true,
        },
      },
    },
  });

  if (!job) {
    return null;
  }

  const [latest] = job.steps;
  const latestStep: LatestStepInfo | null = latest
    ? {
        step: latest.step,
        status: latest.status,
        startedAt: latest.startedAt,
        finishedAt: latest.finishedAt,
        error: latest.error,
      }
    : null;

  return {
    id: job.id,
    tenantId: job.tenantId,
    status: job.status,
    currentStep: job.currentStep,
    lastError: job.failureReason,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    latestStep,
  };
}

export type RetryEnqueueResult =
  | { kind: "not_found" }
  | { kind: "conflict"; jobStatus: ProvisioningStatus }
  | {
      kind: "ok";
      jobId: string;
      tenantId: string;
      queueJobId: string | undefined;
      status: ProvisioningStatus;
      attemptCount: number;
    }
  | { kind: "enqueue_failed"; message: string };

export async function retryEnqueueProvisioningJob(
  jobId: string,
  requestId: string
): Promise<RetryEnqueueResult> {
  const job = await prisma.provisioningJob.findUnique({
    where: { id: jobId },
    include: { tenant: true },
  });

  if (!job) {
    return { kind: "not_found" };
  }

  if (job.status !== ProvisioningStatus.enqueue_failed) {
    return { kind: "conflict", jobStatus: job.status };
  }

  const retryAttempt = job.attemptCount + 1;

  const reserved = await prisma.provisioningJob.updateMany({
    where: { id: jobId, status: ProvisioningStatus.enqueue_failed },
    data: {
      status: ProvisioningStatus.queued,
      failureReason: null,
    },
  });

  if (reserved.count === 0) {
    const j = await prisma.provisioningJob.findUnique({ where: { id: jobId } });
    if (!j) {
      return { kind: "not_found" };
    }
    return { kind: "conflict", jobStatus: j.status };
  }

  try {
    const queueJob = await provisioningQueue.add(
      "provision",
      {
        jobId: job.id,
        tenantId: job.tenantId,
        slug: job.tenant.slug,
        plan: job.tenant.plan,
        region: job.tenant.region,
        requestId,
      },
      { attempts: 1, jobId: job.id }
    );

    await prisma.provisioningJob.update({
      where: { id: jobId },
      data: { attemptCount: { increment: 1 } },
    });

    const updated = await prisma.provisioningJob.findUnique({
      where: { id: jobId },
      select: { attemptCount: true },
    });

    logger.info(
      {
        jobId: job.id,
        tenantId: job.tenantId,
        retryAttempt,
        queueJobId: queueJob.id,
        requestId,
      },
      "Provisioning job re-enqueued after enqueue_failed"
    );

    return {
      kind: "ok",
      jobId: job.id,
      tenantId: job.tenantId,
      queueJobId: queueJob.id,
      status: ProvisioningStatus.queued,
      attemptCount: updated?.attemptCount ?? retryAttempt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(
      {
        err: error,
        jobId: job.id,
        tenantId: job.tenantId,
        retryAttempt,
        requestId,
      },
      `Provisioning retry enqueue failed: ${message}`
    );
    await prisma.provisioningJob.update({
      where: { id: jobId },
      data: {
        status: ProvisioningStatus.enqueue_failed,
        failureReason: message,
      },
    });
    return { kind: "enqueue_failed", message };
  }
}
