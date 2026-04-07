import type { Prisma, ProvisioningStatus, TenantStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";

export type GetTenantResult = {
  id: string;
  slug: string;
  status: TenantStatus;
  createdAt: Date;
  updatedAt: Date;
  provisioningJob: {
    id: string;
    tenantId: string;
    status: ProvisioningStatus;
    currentStep: string;
    attemptCount: number;
    payload: Prisma.JsonValue | null;
    result: Prisma.JsonValue | null;
    failureReason: string | null;
    createdAt: Date;
    finishedAt: Date | null;
  } | null;
};

export async function getTenantById(id: string): Promise<GetTenantResult | null> {
  const tenant = await prisma.tenant.findUnique({
    where: { id },
    select: {
      id: true,
      slug: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      jobs: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          tenantId: true,
          status: true,
          currentStep: true,
          attemptCount: true,
          payload: true,
          result: true,
          failureReason: true,
          createdAt: true,
          finishedAt: true,
        },
      },
    },
  });

  if (!tenant) {
    return null;
  }

  const [job] = tenant.jobs;

  return {
    id: tenant.id,
    slug: tenant.slug,
    status: tenant.status,
    createdAt: tenant.createdAt,
    updatedAt: tenant.updatedAt,
    provisioningJob: job ?? null,
  };
}
