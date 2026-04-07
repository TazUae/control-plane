import { z } from "zod";

export const GetJobParamsSchema = z.object({
  id: z.string().uuid(),
});

export type GetJobParams = z.infer<typeof GetJobParamsSchema>;
