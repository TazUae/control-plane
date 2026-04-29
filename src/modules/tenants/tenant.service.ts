import type { Prisma, ProvisioningStatus, TenantStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";

export type TenantStepRun = {
  step: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  error: string | null;
};

export type GetTenantResult = {
  id: string;
  slug: string;
  status: TenantStatus;
  plan: string;
  region: string;
  country: string;
  defaultCurrency: string;
  timezone: string;
  language: string;
  dateFormat: string;
  currencyPrecision: number;
  companyName: string;
  companyAbbr: string;
  fiscalYearStartMonth: number;
  fiscalYearName: string | null;
  regionalSetupModule: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** All step runs from the latest provisioning job, ordered by startedAt asc. */
  steps: TenantStepRun[];
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
      plan: true,
      region: true,
      country: true,
      defaultCurrency: true,
      timezone: true,
      language: true,
      dateFormat: true,
      currencyPrecision: true,
      companyName: true,
      companyAbbr: true,
      fiscalYearStartMonth: true,
      fiscalYearName: true,
      regionalSetupModule: true,
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
          steps: {
            orderBy: { startedAt: "asc" },
            select: {
              step: true,
              status: true,
              startedAt: true,
              finishedAt: true,
              error: true,
            },
          },
        },
      },
    },
  });

  if (!tenant) {
    return null;
  }

  const [latestJob] = tenant.jobs;
  const steps: TenantStepRun[] = latestJob?.steps ?? [];

  const provisioningJob = latestJob
    ? {
        id: latestJob.id,
        tenantId: latestJob.tenantId,
        status: latestJob.status,
        currentStep: latestJob.currentStep,
        attemptCount: latestJob.attemptCount,
        payload: latestJob.payload,
        result: latestJob.result,
        failureReason: latestJob.failureReason,
        createdAt: latestJob.createdAt,
        finishedAt: latestJob.finishedAt,
      }
    : null;

  return {
    id: tenant.id,
    slug: tenant.slug,
    status: tenant.status,
    plan: tenant.plan,
    region: tenant.region,
    country: tenant.country,
    defaultCurrency: tenant.defaultCurrency,
    timezone: tenant.timezone,
    language: tenant.language,
    dateFormat: tenant.dateFormat,
    currencyPrecision: tenant.currencyPrecision,
    companyName: tenant.companyName,
    companyAbbr: tenant.companyAbbr,
    fiscalYearStartMonth: tenant.fiscalYearStartMonth,
    fiscalYearName: tenant.fiscalYearName,
    regionalSetupModule: tenant.regionalSetupModule,
    createdAt: tenant.createdAt,
    updatedAt: tenant.updatedAt,
    steps,
    provisioningJob,
  };
}
