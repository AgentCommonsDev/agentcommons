import type { PrismaClient } from "@agentcommons/db";
export class HealthService {
  constructor(private readonly prisma: PrismaClient) {}
  health() {
    return { status: "ok" } as const;
  }
  async ready(): Promise<{ status: "ok" | "unavailable" }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: "ok" };
    } catch {
      return { status: "unavailable" };
    }
  }
}
