/** Step run row status (DB column is string; no Prisma enum — use these constants for writes). */
export const StepRunStatus = {
  Running: "running",
  Completed: "completed",
  Failed: "failed",
} as const;

export type StepRunStatusValue = (typeof StepRunStatus)[keyof typeof StepRunStatus];
