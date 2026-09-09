import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Native SDK lifecycle shared by contract capture and the installed-extension canary.
export async function piLifecycle({
  packageDirectory,
  directory,
  extension,
  prompt,
  provider = "google",
  model: modelId = "gemini-2.5-flash",
  // null enables pi's defaults plus every extension tool (the AgentCommons bridge).
  tools = ["read"],
  modelsJson,
  // "lifecycle" runs the fork/resume script; "prompt" runs one prompt and disposes.
  mode = "lifecycle",
}) {
  const pi = await import(
    pathToFileURL(join(resolve(packageDirectory), "dist/index.js")).href
  );
  const cwd = process.cwd();
  const agentDir = join(directory, "config");
  const sessionDir = join(directory, "sessions");
  mkdirSync(sessionDir, { recursive: true });
  if (modelsJson) {
    // Custom providers (a local mock, a proxy) come from the private agent directory.
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, "models.json"), JSON.stringify(modelsJson), {
      mode: 0o600,
    });
  }
  const createRuntime = async (options) => {
    const services = await pi.createAgentSessionServices({
      cwd: options.cwd,
      agentDir: options.agentDir,
      resourceLoaderOptions: {
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        extensionFactories: [extension],
        agentsFilesOverride: () => ({ agentsFiles: [] }),
      },
    });
    const model = services.modelRegistry.find(provider, modelId);
    if (!model) throw new Error(`${provider}/${modelId} is unavailable`);
    const created = await pi.createAgentSessionFromServices({
      services,
      sessionManager: options.sessionManager,
      sessionStartEvent: options.sessionStartEvent,
      model,
      ...(tools === null ? {} : { tools }),
    });
    await created.session.bindExtensions({});
    return { ...created, services, diagnostics: services.diagnostics };
  };
  const runtime = await pi.createAgentSessionRuntime(createRuntime, {
    cwd,
    agentDir,
    sessionManager: pi.SessionManager.create(cwd, sessionDir),
  });
  try {
    await runtime.session.prompt(prompt);
    const originalPath = runtime.session.sessionManager.getSessionFile();
    const originalId = runtime.session.sessionManager.getSessionId();
    const originalLeaf = runtime.session.sessionManager.getLeafId();
    if (!originalPath || !originalLeaf)
      throw new Error("Live session did not persist");
    if (mode === "prompt") return { originalId, forkId: null };
    await runtime.session.prompt("Reply with exactly: second branch point.");
    await runtime.session.navigateTree(originalLeaf, { summarize: false });
    await runtime.session.prompt("Reply with exactly: alternate branch.");
    const forkPoint = runtime.session.getUserMessagesForForking().at(-1);
    if (!forkPoint) throw new Error("No user message exists to fork");
    await runtime.fork(forkPoint.entryId, { position: "at" });
    const forkId = runtime.session.sessionManager.getSessionId();
    await runtime.session.prompt("Reply with exactly: fork confirmed.");
    await runtime.switchSession(originalPath);
    await runtime.session.prompt("Reply with exactly: resume confirmed.");
    return { originalId, forkId };
  } finally {
    await runtime.dispose();
  }
}
