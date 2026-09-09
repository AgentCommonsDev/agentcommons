import { readFile, stat } from "node:fs/promises";
import { parseArgs } from "node:util";
import { z } from "zod";
import { operatorContext, runOperatorCommand } from "./auth/bootstrap.js";
import { enrollDomain, domainEnrollmentInputSchema } from "./auth/domain.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    organization: { type: "string" },
    domain: { type: "string" },
    "cookie-file": { type: "string" },
  },
});
if (positionals.length !== 0)
  throw new Error("Pass --organization, --domain and --cookie-file only.");
const input = domainEnrollmentInputSchema.parse({
  organization: values.organization,
  domain: values.domain,
});
const path = z.string().min(1).parse(values["cookie-file"]);
const file = await stat(path);
if (
  !file.isFile() ||
  file.size > 16384 ||
  (file.mode & 0o077) !== 0 ||
  (process.getuid && file.uid !== process.getuid())
)
  throw new Error(
    "Use a private cookie file owned by the current user (chmod 600).",
  );
const cookie = (await readFile(path, "utf8")).trim();
if (!cookie || /[\r\n]/.test(cookie))
  throw new Error("The cookie file must contain one Cookie header value.");
await runOperatorCommand((prisma, auth) =>
  enrollDomain(
    prisma,
    auth,
    { ...operatorContext(), headers: new Headers({ cookie }) },
    input,
  ),
);
