import { getEncoding } from "js-tiktoken";

const tokenizer = getEncoding("cl100k_base");
export interface TokenizedInput {
  content: string;
  tokens: number[];
}
export function tokenize(content: string): TokenizedInput {
  return { content, tokens: tokenizer.encode(content, [], []) };
}

/** Keep Unicode characters intact while measuring every boundary with the model tokenizer. */
export function tokenPrefix(content: string, maximum: number): TokenizedInput {
  const whole = tokenize(content);
  if (whole.tokens.length <= maximum) return whole;
  const points = Array.from(content);
  let low = 0;
  let high = points.length;
  while (low < high) {
    const end = Math.ceil((low + high) / 2);
    if (tokenize(points.slice(0, end).join("")).tokens.length <= maximum)
      low = end;
    else high = end - 1;
  }
  return tokenize(points.slice(0, low).join(""));
}
export function chunks(
  content: string,
  maximum = 512,
  overlap = 64,
): TokenizedInput[] {
  if (maximum <= overlap || overlap < 0)
    throw new Error("Chunk size must exceed its overlap.");
  const output: TokenizedInput[] = [];
  const points = Array.from(content);
  let start = 0;
  while (start < points.length) {
    let high = Math.min(points.length, start + maximum * 4);
    while (
      high < points.length &&
      tokenize(points.slice(start, high).join("")).tokens.length <= maximum
    )
      high = Math.min(points.length, start + (high - start) * 2);
    const chunk = tokenPrefix(points.slice(start, high).join(""), maximum);
    const length = Array.from(chunk.content).length;
    if (!length)
      throw new Error("A Unicode character exceeds the chunk token limit.");
    output.push(chunk);
    const end = start + length;
    if (end === points.length) break;
    let low = 0;
    let upper = length - 1;
    while (low < upper) {
      const size = Math.ceil((low + upper) / 2);
      if (
        tokenize(points.slice(end - size, end).join("")).tokens.length <=
        overlap
      )
        low = size;
      else upper = size - 1;
    }
    start = end - low;
  }
  return output;
}
export function sessionInput(input: {
  title: string | null;
  firstPrompt: string | null;
  lastReply: string;
  files: readonly string[];
}): TokenizedInput {
  return tokenPrefix(
    [
      `Title: ${input.title ?? ""}`,
      `First prompt: ${tokenPrefix(input.firstPrompt ?? "", 2048).content}`,
      `Last reply: ${tokenPrefix(input.lastReply, 4096).content}`,
      `Files: ${tokenPrefix(input.files.join("\n"), 2048).content}`,
    ].join("\n"),
    8191,
  );
}
