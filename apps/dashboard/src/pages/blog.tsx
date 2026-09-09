import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import posts from "../lib/blog.generated.json";
import { copy } from "../copy";
import { useBillingConfig } from "../lib/billing-config";
import { paths } from "../lib/routes";
import { NotFoundPage } from "./not-found";
export function BlogPage({ slug }: { slug?: string }) {
  const config = useBillingConfig();
  const post = slug ? posts.find((item) => item.slug === slug) : undefined;
  if (config.mode === "customer" || (slug && !post)) return <NotFoundPage />;
  return (
    <main id="main" className="blog-page container">
      {post ? (
        <article>
          <a href={paths.blog} className="text-link">
            {copy.site.blog.back}
          </a>
          <header>
            <h1>{post.title}</h1>
            <p className="blog-summary">{post.summary}</p>
            <p className="blog-date">
              {copy.site.blog.published}{" "}
              <time dateTime={post.date}>{post.date}</time>
            </p>
          </header>
          <div className="blog-prose">
            <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
              {post.body}
            </ReactMarkdown>
          </div>
        </article>
      ) : (
        <>
          <header>
            <h1>{copy.site.blog.title}</h1>
            <p className="blog-summary">{copy.site.blog.description}</p>
          </header>
          <div className="blog-posts">
            {posts.map((item) => (
              <article key={item.slug}>
                <time dateTime={item.date}>{item.date}</time>
                <h2>
                  <a href={paths.blogPost(item.slug)}>{item.title}</a>
                </h2>
                <p>{item.summary}</p>
              </article>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
