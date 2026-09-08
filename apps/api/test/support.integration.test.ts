import { Client } from "pg";
import { expect, it, vi } from "vitest";
import { cleanup } from "../../../scripts/cleanup.js";
import { startDatabase } from "./support.js";

it("disconnects Prisma and stops the actual database after reader cleanup reports a failure", async () => {
  const database = await startDatabase();
  const probe = new Client({
    connectionString: database.urls.app,
    connectionTimeoutMillis: 1000,
  });
  const failure = new Error("Injected reader cleanup failure");
  const closeReaders = database.readers.close.bind(database.readers);
  const disconnect = database.prisma.$disconnect.bind(database.prisma);
  const disconnected = vi.fn(async () => disconnect());
  vi.spyOn(database.prisma, "$disconnect").mockImplementation(disconnected);
  vi.spyOn(database.readers, "close").mockImplementation(async () => {
    await closeReaders();
    throw failure;
  });
  try {
    await expect(database.close()).rejects.toMatchObject({ errors: [failure] });
    expect(disconnected).toHaveBeenCalledOnce();
    await expect(probe.connect()).rejects.toThrow();
    await expect(database.close()).resolves.toBeUndefined();
    expect(disconnected).toHaveBeenCalledOnce();
  } finally {
    expect(await cleanup([() => probe.end(), () => database.close()])).toEqual(
      [],
    );
  }
});
