import { claudeCode } from "./claude-code.js";
import { codex } from "./codex.js";
import { geminiCli } from "./gemini-cli.js";
import { pi } from "./pi.js";
import type { Harness, Normalizer } from "./types.js";

export const NORMALIZERS: Readonly<Record<Harness, Normalizer>> = {
  CLAUDE_CODE: claudeCode,
  CODEX: codex,
  GEMINI_CLI: geminiCli,
  PI: pi,
};
export { claudeCode, codex, geminiCli, pi };
export type {
  Harness,
  JsonValue,
  SourceRecord,
  NormalizedMessage,
  Normalizer,
  NormalizerContext,
  SessionDelta,
  NativeLink,
  ResultSource,
} from "./types.js";

export { SourceNotReadyError } from "./errors.js";
