import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { agentInstructions } from "@agentcommons/core/format/install";
import {
  Recorder,
  documentPath,
  enforceToolCall,
  isFullContext,
  mergeMessages,
  sendEvent,
  v1Hooks,
  v2Setup,
  type SessionRead,
  type V2Context,
} from "./index.js";

function installation(): string {
  const directory = mkdtempSync(join(tmpdir(), "agentcommons-opencode-"));
  writeFileSync(
    join(directory, "config.json"),
    JSON.stringify({ node: "node" }),
  );
  return directory;
}
function session(
  id: string,
  messages: unknown[],
  parentId: string | null = null,
): SessionRead {
  return {
    session: {
      id,
      parentId,
      title: `title ${id}`,
      directory: "/work/repository",
      harnessVersion: "2.4.1",
      startedAt: "2026-11-27T23:00:00.000Z",
      agent: parentId ? "general" : "build",
    },
    messages,
  };
}
type Sent = { payload: Record<string, unknown>; wait: boolean };
/** A recorder with its own session memory, as a separate opencode process has. */
function recorder(
  directory: string,
  reads: Record<string, SessionRead>,
  sessions = new Map<string, { parent: string | null; active: number }>(),
) {
  const sent: Sent[] = [];
  const instance = new Recorder(
    (id) => Promise.resolve(reads[id] ?? null),
    () => directory,
    (_directory, payload, wait) => sent.push({ payload, wait }),
    Date.now,
    sessions,
  );
  return { instance, sent };
}
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("opencode plugin", () => {
  // @req R-HRN-09
  it("keeps every message across reads: updates in place, appends new ones, drops none after a compaction", () => {
    const first = [
      { id: "m1", type: "user", text: "one" },
      { id: "m2", type: "assistant", content: [] },
    ];
    // opencode 2.x returns only what follows the last compaction.
    const afterCompaction = [
      {
        id: "m2",
        type: "assistant",
        content: [{ type: "text", text: "done" }],
      },
      { id: "m3", type: "compaction", summary: "summary" },
    ];
    expect(mergeMessages(first, afterCompaction)).toEqual([
      first[0],
      afterCompaction[0],
      afterCompaction[1],
    ]);
    // 1.x keeps the id inside `info`.
    const v1 = [{ info: { id: "a" }, parts: [] }];
    expect(
      mergeMessages(v1, [{ info: { id: "a" }, parts: [{ type: "text" }] }]),
    ).toEqual([{ info: { id: "a" }, parts: [{ type: "text" }] }]);
  });

  // @req R-HRN-09
  it("starts a session once, maps later events, and ends it at shutdown with a waited hand-off", async () => {
    const directory = installation();
    const reads = {
      s1: session("s1", [{ id: "m1", type: "user", text: "hi" }]),
    };
    const { instance, sent } = recorder(directory, reads);
    await instance.record("s1", "prompt");
    await instance.record("s1", "tool");
    await instance.record("s1", "idle");
    instance.close();
    instance.close();
    expect(
      sent.map(({ payload, wait }) => [payload.hook_event_name, wait]),
    ).toEqual([
      ["session.start", false],
      ["tool.after", false],
      ["idle", false],
      ["session.end", true],
    ]);
    expect(sent[0]?.payload).toMatchObject({
      session_id: "s1",
      cwd: "/work/repository",
      transcript_path: documentPath(directory, "s1"),
    });
    const document: unknown = JSON.parse(
      readFileSync(documentPath(directory, "s1"), "utf8"),
    );
    expect(document).toEqual({
      sessionId: "s1",
      parentSessionId: null,
      title: "title s1",
      directory: "/work/repository",
      harnessVersion: "2.4.1",
      startedAt: "2026-11-27T23:00:00.000Z",
      agent: "build",
      messages: [{ id: "m1", type: "user", text: "hi" }],
    });
    // A later process that finds the document marks the start as a resume.
    const later = recorder(directory, reads);
    await later.instance.record("s1", "idle");
    expect(later.sent[0]?.payload).toMatchObject({
      hook_event_name: "session.start",
      source: "resume",
    });
  });

  // @req R-HRN-09
  it("sends a child session as subagent events on its parent, writing the parent document first", async () => {
    const directory = installation();
    const { instance, sent } = recorder(directory, {
      parent: session("parent", [{ id: "p1", type: "user", text: "go" }]),
      child: session(
        "child",
        [{ id: "c1", type: "user", text: "read" }],
        "parent",
      ),
    });
    await instance.record("child", "created");
    await instance.record("child", "idle");
    instance.close();
    expect(sent.map(({ payload }) => payload.hook_event_name)).toEqual([
      "subagent.start",
      "subagent.sync",
      "subagent.end",
    ]);
    expect(sent[0]?.payload).toMatchObject({
      session_id: "parent",
      transcript_path: documentPath(directory, "parent"),
      agent_id: "child",
      agent_transcript_path: documentPath(directory, "child"),
      agent_type: "general",
    });
    expect(readdirSync(join(directory, "opencode")).sort()).toEqual([
      "child.json",
      "parent.json",
    ]);
  });

  // @req R-HRN-09
  it("records nothing without an installation and drops an event whose read fails", async () => {
    const missing = mkdtempSync(join(tmpdir(), "agentcommons-opencode-"));
    const absent = recorder(missing, { s1: session("s1", []) });
    await absent.instance.record("s1", "idle");
    expect(absent.sent).toEqual([]);
    const directory = installation();
    const failing = new Recorder(
      () => Promise.reject(new Error("engine stopped")),
      () => directory,
      () => {
        throw new Error("no send expected");
      },
      Date.now,
      new Map(),
    );
    await expect(failing.record("s1", "idle")).resolves.toBeUndefined();
  });

  // @req R-HRN-09 @req R-POL-09
  it("blocks a denied command by throwing the rule's reason and spools the decision; anything else runs", () => {
    const directory = installation();
    writeFileSync(
      join(directory, "tool-policy.json"),
      JSON.stringify({
        enabled: true,
        rules: [
          {
            id: "no-rm",
            harnesses: ["OPENCODE"],
            tool: "*",
            command_patterns: [{ kind: "substring", value: "rm -rf" }],
            action: "deny",
            severity: "high",
            description: "No recursive deletes.",
          },
          {
            id: "warn-curl",
            harnesses: ["OPENCODE"],
            tool: "*",
            command_patterns: [{ kind: "substring", value: "curl" }],
            action: "warn",
            severity: "low",
          },
        ],
      }),
    );
    expect(() => {
      enforceToolCall("bash", { command: "rm -rf /tmp/x" }, "s1", directory);
    }).toThrow("No recursive deletes.");
    const spooled = readdirSync(join(directory, "tool-policy", "violations"));
    expect(spooled).toHaveLength(1);
    expect(
      JSON.parse(
        readFileSync(
          join(directory, "tool-policy", "violations", spooled[0] ?? ""),
          "utf8",
        ),
      ) as unknown,
    ).toMatchObject({ harness: "OPENCODE", tool: "bash", decision: "deny" });
    expect(() => {
      enforceToolCall(
        "shell",
        { command: "curl example.test" },
        "s1",
        directory,
      );
    }).not.toThrow();
    expect(() => {
      enforceToolCall("read", { path: "a.txt" }, "s1", directory);
    }).not.toThrow();
    vi.stubEnv("AGENTCOMMONS_DISABLE", "1");
    expect(() => {
      enforceToolCall("bash", { command: "rm -rf /tmp/x" }, "s1", directory);
    }).not.toThrow();
  });

  // @req R-HRN-09
  it("does nothing under 1.19.6's early 2.x loader, whose context has no event, session or tool domain", () => {
    const partial = Object.fromEntries(
      [
        "options",
        "agent",
        "aisdk",
        "catalog",
        "command",
        "integration",
        "plugin",
        "reference",
        "skill",
      ].map((key) => [key, {}]),
    );
    expect(isFullContext(partial)).toBe(false);
    expect(
      isFullContext({ ...partial, app: {}, event: {}, session: {}, tool: {} }),
    ).toBe(true);
  });

  // @req R-HRN-09
  it("adds the AgentCommons guidance to the system prompt in both interfaces", async () => {
    const system: string[] = [];
    const hooks = v1Hooks({
      client: {
        session: {
          get: () => Promise.resolve({}),
          messages: () => Promise.resolve({}),
        },
      },
    });
    await hooks["experimental.chat.system.transform"]({}, { system });
    expect(system).toEqual([agentInstructions]);

    const registered = new Map<string, (input: never) => void>();
    const context: V2Context = {
      app: { version: "2.4.1" },
      event: {
        subscribe: () => ({
          [Symbol.asyncIterator]: () => ({
            next: () => Promise.resolve({ done: true, value: undefined }),
          }),
        }),
      },
      session: {
        get: () => Promise.resolve(null),
        context: () => Promise.resolve([]),
        hook: (name, callback) => {
          registered.set(`session.${name}`, callback);
          return Promise.resolve({});
        },
      },
      tool: {
        hook: (name, callback) => {
          registered.set(`tool.${name}`, callback);
          return Promise.resolve({});
        },
      },
    };
    await v2Setup(
      context,
      new Recorder(
        () => Promise.resolve(null),
        () => "/nonexistent",
        sendEvent,
        Date.now,
        new Map(),
      ),
    );
    expect([...registered.keys()].sort()).toEqual([
      "session.context",
      "session.prompt",
      "tool.execute.after",
      "tool.execute.before",
    ]);
    const parts: { type: "text"; text: string }[] = [];
    const contextHook = registered.get("session.context") as
      | ((input: { sessionID: string; system: typeof parts }) => void)
      | undefined;
    contextHook?.({ sessionID: "s1", system: parts });
    expect(parts).toEqual([{ type: "text", text: agentInstructions }]);
  });

  // @req R-HRN-09
  it("does not hold up opencode 1.x: its hooks return before the session is read", async () => {
    let release: () => void = () => undefined;
    const pending = new Promise<{ data?: unknown }>((resolve) => {
      release = () => {
        resolve({});
      };
    });
    const hooks = v1Hooks({
      client: { session: { get: () => pending, messages: () => pending } },
    });
    let returned = false;
    await hooks["chat.message"]({ sessionID: "s1" }).then(() => {
      returned = true;
    });
    expect(returned).toBe(true);
    release();
  });

  // @req R-HRN-09
  it("ends at shutdown only the sessions active in the last half hour", async () => {
    const directory = installation();
    let now = 0;
    const sent: Sent[] = [];
    const instance = new Recorder(
      (id) => Promise.resolve(session(id, [])),
      () => directory,
      (_directory, payload, wait) => sent.push({ payload, wait }),
      () => now,
      new Map(),
    );
    await instance.record("old", "idle");
    now = 31 * 60 * 1000;
    await instance.record("recent", "idle");
    sent.length = 0;
    instance.close();
    expect(sent.map(({ payload }) => payload.session_id)).toEqual(["recent"]);
  });

  // @req R-HRN-09
  it("never sends an empty working directory", async () => {
    const directory = installation();
    const read = session("s1", []);
    const { instance, sent } = recorder(directory, {
      s1: { ...read, session: { ...read.session, directory: null } },
    });
    await instance.record("s1", "idle");
    expect(sent[0]?.payload.cwd).toBe(process.cwd());
  });

  // @req R-HRN-09
  it("runs hook.js with its installation directory and the event on stdin", () => {
    const directory = installation();
    writeFileSync(
      join(directory, "config.json"),
      JSON.stringify({ node: process.execPath }),
    );
    writeFileSync(
      join(directory, "hook.js"),
      'require("node:fs").writeFileSync(process.env.AGENTCOMMONS_DIR + "/received.json", JSON.stringify({ dir: process.env.AGENTCOMMONS_DIR, argv: process.argv.slice(2), input: require("node:fs").readFileSync(0, "utf8") }));',
    );
    vi.stubEnv("AGENTCOMMONS_DIR", "/elsewhere");
    sendEvent(directory, { hook_event_name: "session.end" }, true);
    expect(
      JSON.parse(
        readFileSync(join(directory, "received.json"), "utf8"),
      ) as unknown,
    ).toEqual({
      dir: directory,
      argv: ["opencode"],
      input: JSON.stringify({ hook_event_name: "session.end" }),
    });
  });

  // @req R-HRN-09
  it("carries on across a plugin reload in the same process: no second start", async () => {
    const directory = installation();
    const reads = {
      s1: session("s1", [{ id: "m1", type: "user", text: "hi" }]),
    };
    const sessions = new Map<
      string,
      { parent: string | null; active: number }
    >();
    const before = recorder(directory, reads, sessions);
    await before.instance.record("s1", "idle");
    // opencode 2.x reloaded the plugin: a new copy, the same process.
    const after = recorder(directory, reads, sessions);
    await after.instance.record("s1", "tool");
    expect(after.sent.map(({ payload }) => payload.hook_event_name)).toEqual([
      "tool.after",
    ]);
    after.instance.close();
    expect(after.sent.at(-1)?.payload.hook_event_name).toBe("session.end");
  });
});
