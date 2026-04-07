import type { ProvisioningStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";

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
