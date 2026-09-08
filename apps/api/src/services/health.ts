import type { PrismaClient } from "@agentcommons/db";
import type { TraceRepository } from "@agentcommons/traces";
export class HealthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly traces: Pick<TraceRepository, "ready">,
  ) {}
  health() {
    return { status: "ok" } as const;
  }
  async ready(): Promise<{ status: "ok" | "unavailable" }> {
    try {
      const [, ready] = await Promise.all([
        this.prisma.$queryRaw`SELECT 1`,
        this.traces.ready(),
      ]);
      return { status: ready ? "ok" : "unavailable" };
    } catch {
      return { status: "unavailable" };
    }
  }
}
