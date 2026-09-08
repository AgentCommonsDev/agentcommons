import { readdir, readFile, writeFile } from "node:fs/promises";
import matter from "gray-matter";
import { z } from "zod";
const metadata = z.strictObject({
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().trim().min(1).max(160),
  summary: z.string().trim().min(1).max(320),
  date: z.iso.date(),
});
const directory = new URL("../content/blog/", import.meta.url);
const posts = [];
for (const file of (await readdir(directory))
  .filter((file) => file.endsWith(".md"))
  .sort()) {
  const parsed = matter(await readFile(new URL(file, directory), "utf8"));
  const data = metadata.parse(parsed.data);
  if (data.slug !== file.slice(0, -3))
    throw new Error(`Blog filename must match slug: ${file}`);
  posts.push({ ...data, body: z.string().trim().min(1).parse(parsed.content) });
}
posts.sort(
  (a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug),
);
await writeFile(
  new URL("../src/lib/blog.generated.json", import.meta.url),
  `${JSON.stringify(posts, null, 2)}\n`,
);
