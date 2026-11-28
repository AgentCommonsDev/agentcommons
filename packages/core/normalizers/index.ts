import { claudeCode } from "./claude-code.js";
import { codex } from "./codex.js";
import { geminiCli } from "./gemini-cli.js";
import { opencode } from "./opencode.js";
import { pi } from "./pi.js";
import type { Harness, Normalizer } from "./types.js";

export const NORMALIZERS: Readonly<Record<Harness, Normalizer>> = {
  CLAUDE_CODE: claudeCode,
  CODEX: codex,
  GEMINI_CLI: geminiCli,
  PI: pi,
  OPENCODE: opencode,
};
export { claudeCode, codex, geminiCli, pi, opencode };
export type {
  Harness,
  JsonValue,
  SourceRecord,
  NormalizedMessage,
  Normalizer,
  NormalizerContext,
  SessionDelta,
  NativeLink,
  NativeSpawn,
  ResultSource,
} from "./types.js";

export { SourceNotReadyError } from "./errors.js";
