import type { Prisma } from "@prisma/client";

// Never select credentialsCiphertext for anything that reaches a page/component.
export const API_CONNECTION_SAFE_SELECT = {
  id: true,
  brandId: true,
  name: true,
  provider: true,
  baseUrl: true,
  authType: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ApiConnectionSelect;
