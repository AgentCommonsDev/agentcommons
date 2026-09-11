import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readUpdaterState } from "../src/services/health.js";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function stateFile(content: string): string {
  const directory = mkdtempSync(join(tmpdir(), "agentcommons-updater-state-"));
  directories.push(directory);
  const path = join(directory, "update-state");
  writeFileSync(path, content);
  return path;
}
describe("host updater state", () => {
  // @req R-INF-13
  it("reads the updater's KEY=VALUE file as the status report, with empty values null and a missing file as no report", async () => {
    expect(
      await readUpdaterState("/nonexistent/agentcommons/update-state"),
    ).toBeNull();
    const state = await readUpdaterState(
      stateFile(
        [
          "last_check=2026-09-11T03:00:12Z",
          "last_result=rolled-back",
          "previous_image=sha256:aaa",
          "last_image=sha256:ccc",
          "failed_image=sha256:ccc",
          "failed_at=2026-09-11T03:00:12Z",
          "failures=1",
          "updated_at=",
          "last_ok=2026-09-11T02:00:09Z",
          "running_revision=048d978aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          "running_created=2026-09-11T16:30:00Z",
          "pulled_revision=84f9941bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          "pulled_created=",
          "",
        ].join("\n"),
      ),
    );
    expect(state).toEqual({
      last_check: "2026-09-11T03:00:12Z",
      last_ok: "2026-09-11T02:00:09Z",
      last_result: "rolled-back",
      last_image: "sha256:ccc",
      previous_image: "sha256:aaa",
      updated_at: null,
      failed_image: "sha256:ccc",
      failed_at: "2026-09-11T03:00:12Z",
      failures: 1,
      running_revision: "048d978aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      running_created: "2026-09-11T16:30:00Z",
      pulled_revision: "84f9941bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      pulled_created: null,
    });
  });
  // @req R-INF-14
  it("reports the release stamps of both sides of a held update", async () => {
    const state = await readUpdaterState(
      stateFile(
        [
          "last_result=held-newer-running",
          "running_revision=048d978aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          "running_created=2026-09-11T16:30:00Z",
          "pulled_revision=84f9941bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          "pulled_created=2026-09-11T04:12:41Z",
          "",
        ].join("\n"),
      ),
    );
    expect(state).toMatchObject({
      last_result: "held-newer-running",
      running_revision: "048d978aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      running_created: "2026-09-11T16:30:00Z",
      pulled_revision: "84f9941bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      pulled_created: "2026-09-11T04:12:41Z",
      failures: 0,
    });
  });
  // @req R-INF-13
  it("drops a value the schema rejects instead of failing the whole report", async () => {
    const state = await readUpdaterState(
      stateFile("last_check=yesterday\nlast_result=disabled\nfailures=many\n"),
    );
    expect(state).toMatchObject({
      last_check: null,
      last_result: "disabled",
      failures: 0,
    });
  });
});
