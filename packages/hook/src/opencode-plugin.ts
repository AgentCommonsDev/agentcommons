// Replaced with the bundled plugin text at build time (build.ts, vitest.config.ts); an
// unbundled run (tsx) leaves it undefined.
declare const AGENTCOMMONS_OPENCODE_PLUGIN: string | undefined;

/** The string the bundled plugin carries where the installer writes its directory. */
const DIRECTORY_PLACEHOLDER = JSON.stringify(
  "__AGENTCOMMONS_INSTALL_DIRECTORY__",
);
/**
 * The opencode plugin module the installer writes (SPEC §6.1), bound to the installation
 * directory: the desktop app's service starts without `AGENTCOMMONS_DIR`, so the plugin
 * cannot learn a non-default directory from its environment.
 */
export function opencodePlugin(directory: string): string {
  if (typeof AGENTCOMMONS_OPENCODE_PLUGIN !== "string")
    throw new Error(
      "This hook.js was not built with packages/hook/build.ts and carries no opencode plugin.",
    );
  if (!AGENTCOMMONS_OPENCODE_PLUGIN.includes(DIRECTORY_PLACEHOLDER))
    throw new Error("The opencode plugin bundle has no directory placeholder.");
  return AGENTCOMMONS_OPENCODE_PLUGIN.replaceAll(
    DIRECTORY_PLACEHOLDER,
    JSON.stringify(directory),
  );
}
