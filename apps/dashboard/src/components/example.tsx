import * as Tabs from "@radix-ui/react-tabs";
import {
  ArrowDown,
  Braces,
  Check,
  CornerDownRight,
  Database,
  GitBranch,
  Search,
  Terminal,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { copy } from "../copy";

const preview = copy.site.preview;
/** Each example tab's icon, by the tool it shows. */
const tabIcons: Record<(typeof preview.tabs)[number]["id"], LucideIcon> = {
  search: Search,
  get: Terminal,
  sql: Database,
};
/** The MCP request line that opens every example tab. */
function ExampleCommand({ command }: { command: string }) {
  return (
    <div
      className="example-command"
      tabIndex={0}
      role="region"
      aria-label={preview.commandLabel}
    >
      <span className="command-prefix" aria-hidden>
        <CornerDownRight size={15} />
      </span>
      <code>{command}</code>
    </div>
  );
}
export function Example() {
  return (
    <div className="example-window">
      <div className="window-chrome">
        <div className="window-dots" aria-hidden>
          <i />
          <i />
          <i />
        </div>
        <span>{preview.address}</span>
        <span className="example-badge">
          <span className="status-dot" />
          {preview.badge}
        </span>
      </div>
      <Tabs.Root defaultValue="search" className="example-tabs">
        <div className="example-sidebar">
          <span className="sidebar-label">{preview.label}</span>
          <Tabs.List aria-label={preview.label}>
            {preview.tabs.map((tab) => {
              const Icon = tabIcons[tab.id];
              return (
                <Tabs.Trigger value={tab.id} key={tab.id}>
                  <Icon size={17} aria-hidden />
                  <span>
                    <strong>{tab.label}</strong>
                    <small>{tab.caption}</small>
                  </span>
                  <CornerDownRight
                    className="tab-arrow"
                    size={14}
                    aria-hidden
                  />
                </Tabs.Trigger>
              );
            })}
          </Tabs.List>
          <div className="sidebar-foot">
            <Braces size={15} aria-hidden />
            <span>{preview.source}</span>
          </div>
        </div>
        <div className="example-main">
          <Tabs.Content value="search">
            <ExampleCommand command={preview.search.command} />
            <div className="search-query">
              <Search size={18} aria-hidden />
              <span>{preview.prompt}</span>
            </div>
            <div className="result-heading">
              <span>{preview.search.count}</span>
              <Check size={13} aria-hidden />
            </div>
            <div className="example-results">
              {preview.search.results.map((result, index) => (
                <article className="example-result" key={result.title}>
                  <div className="result-top">
                    <span
                      className={
                        index === 0
                          ? "tool-dot tool-dot-claude"
                          : "tool-dot tool-dot-codex"
                      }
                    />
                    <span>{result.tool}</span>
                    <span className="result-tag">{result.tag}</span>
                  </div>
                  <h3>{result.title}</h3>
                  <p>{result.line}</p>
                  <div className="result-meta">
                    <span>
                      <GitBranch size={11} aria-hidden />
                      {result.branch}
                    </span>
                    <span>{result.meta}</span>
                  </div>
                </article>
              ))}
            </div>
          </Tabs.Content>
          <Tabs.Content value="get">
            <ExampleCommand command={preview.get.command} />
            <div className="get-title">
              <h3>{preview.get.title}</h3>
              <p>{preview.get.meta}</p>
            </div>
            <div className="example-transcript">
              {preview.get.rows.map((row) => (
                <div className="transcript-row" key={row.number}>
                  <span>{row.number}</span>
                  <div>
                    <strong>{row.role}</strong>
                    <p>{row.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </Tabs.Content>
          <Tabs.Content value="sql">
            <ExampleCommand command={preview.sql.command} />
            <div className="example-query">
              <pre>
                <code>{preview.sql.query}</code>
              </pre>
            </div>
            <div className="query-divider">
              <ArrowDown size={14} aria-hidden />
            </div>
            <table className="example-table">
              <thead>
                <tr>
                  {preview.sql.columns.map((column) => (
                    <th key={column} scope="col">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.sql.rows.map((row) => (
                  <tr key={row[0]}>
                    {row.map((cell) => (
                      <td key={cell}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="query-note">{preview.sql.note}</p>
          </Tabs.Content>
        </div>
      </Tabs.Root>
      <div className="window-footer">
        <span className="status-dot" />
        <span>{preview.footer}</span>
      </div>
    </div>
  );
}
