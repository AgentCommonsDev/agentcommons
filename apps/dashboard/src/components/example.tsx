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
import { copy } from "../copy";

export function Example() {
  return (
    <div className="example-window">
      <div className="window-chrome">
        <div className="window-dots" aria-hidden>
          <i />
          <i />
          <i />
        </div>
        <span>{copy.preview.address}</span>
        <span className="example-badge">
          <span className="status-dot" />
          {copy.preview.badge}
        </span>
      </div>
      <Tabs.Root defaultValue="search" className="example-tabs">
        <div className="example-sidebar">
          <span className="sidebar-label">{copy.preview.label}</span>
          <Tabs.List aria-label={copy.preview.label}>
            {copy.preview.tabs.map((tab, index) => {
              const Icon = [Search, Terminal, Database][index] ?? Search;
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
            <span>{copy.preview.source}</span>
          </div>
        </div>
        <div className="example-main">
          <Tabs.Content value="search">
            <div
              className="example-command"
              tabIndex={0}
              role="region"
              aria-label={copy.preview.commandLabel}
            >
              <span className="command-prefix" aria-hidden>
                <CornerDownRight size={15} />
              </span>
              <code>{copy.preview.search.command}</code>
            </div>
            <div className="search-query">
              <Search size={18} aria-hidden />
              <span>{copy.preview.prompt}</span>
            </div>
            <div className="result-heading">
              <span>{copy.preview.search.count}</span>
              <Check size={13} aria-hidden />
            </div>
            <div className="example-results">
              {copy.preview.search.results.map((result, index) => (
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
            <div
              className="example-command"
              tabIndex={0}
              role="region"
              aria-label={copy.preview.commandLabel}
            >
              <CornerDownRight size={15} aria-hidden />
              <code>{copy.preview.get.command}</code>
            </div>
            <div className="get-title">
              <h3>{copy.preview.get.title}</h3>
              <p>{copy.preview.get.meta}</p>
            </div>
            <div className="example-transcript">
              {copy.preview.get.rows.map((row) => (
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
            <div
              className="example-command"
              tabIndex={0}
              role="region"
              aria-label={copy.preview.commandLabel}
            >
              <CornerDownRight size={15} aria-hidden />
              <code>{copy.preview.sql.command}</code>
            </div>
            <div className="example-query">
              <pre>
                <code>{copy.preview.sql.query}</code>
              </pre>
            </div>
            <div className="query-divider">
              <ArrowDown size={14} aria-hidden />
            </div>
            <table className="example-table">
              <thead>
                <tr>
                  {copy.preview.sql.columns.map((column) => (
                    <th key={column} scope="col">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {copy.preview.sql.rows.map((row) => (
                  <tr key={row[0]}>
                    {row.map((cell) => (
                      <td key={cell}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="query-note">{copy.preview.sql.note}</p>
          </Tabs.Content>
        </div>
      </Tabs.Root>
      <div className="window-footer">
        <span className="status-dot" />
        <span>{copy.preview.footer}</span>
      </div>
    </div>
  );
}
