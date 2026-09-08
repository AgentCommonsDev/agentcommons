import { createContext, useContext, type ReactNode } from "react";
import {
  billingConfigSchema,
  defaultBillingConfig,
  type BillingConfig,
} from "@agentcommons/core/schemas/billing";

import { publicConfigElementId } from "@agentcommons/core/format/public-config";

const BillingContext = createContext<BillingConfig>(defaultBillingConfig);
export function BillingProvider({
  config,
  children,
}: {
  config: BillingConfig;
  children: ReactNode;
}) {
  return (
    <BillingContext.Provider value={config}>{children}</BillingContext.Provider>
  );
}
export function useBillingConfig() {
  return useContext(BillingContext);
}
export async function browserBillingConfig(): Promise<BillingConfig> {
  const bootstrap = document.getElementById(publicConfigElementId);
  if (bootstrap?.textContent)
    return billingConfigSchema.parse(JSON.parse(bootstrap.textContent));
  if (import.meta.env.DEV) {
    const response = await fetch("/api/v1/billing/config");
    if (!response.ok)
      throw new Error(`Public configuration: HTTP ${String(response.status)}`);
    return billingConfigSchema.parse(await response.json());
  }
  return defaultBillingConfig;
}
