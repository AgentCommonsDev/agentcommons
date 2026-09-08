import {
  formatSessionHeader,
  repositoryLinks,
} from "@agentcommons/core/format";
import { ChevronDown, GitFork } from "lucide-react";
import { copy } from "../../copy";
import { dateTime, number, textValue, harnessLabel } from "../../lib/display";
import type { SessionHeader } from "../../lib/types";
import {
  CopyButton,
  PageHeading,
  StatusBadge,
  ShortenedFields,
} from "./primitives";
import "./session-navigation.css";

const labels: Record<keyof SessionHeader, string> = {
  ...copy.workspace.fields,
};
const dates = new Set(["started_at", "ended_at"]);
const numeric = new Set([
  "message_count",
  "tool_call_count",
  "input_tokens",
  "output_tokens",
  "file_count",
  "observed_commit_count",
  "child_count",
  "reuse_count",
]);
export function SessionSummary({ header }: { header: SessionHeader }) {
  const links = repositoryLinks(header.repo_url);
  const git = [
    {
      label: copy.workspace.fields.repo_name,
      value: header.repo_name ?? header.repo_url,
      href: links?.repository,
    },
    {
      label: copy.workspace.fields.branch,
      value: header.branch,
      href: links?.branch(header.branch),
    },
    {
      label: copy.workspace.detail.startRevision,
      value: header.start_commit,
      href: links?.commit(header.start_commit),
    },
    {
      label: copy.workspace.detail.endRevision,
      value: header.end_commit,
      href: links?.commit(header.end_commit),
    },
  ];
  return (
    <>
      <PageHeading
        title={header.title ?? copy.workspace.sessions.untitled}
        description={header.user_email}
        actions={
          <>
            <StatusBadge value={header.status} />
            <CopyButton
              value={formatSessionHeader(header)}
              label={copy.workspace.detail.copyHeader}
            />
          </>
        }
      />
      <div className="session-affiliation">
        <GitFork size={16} aria-hidden />
        {header.parent_relation ? (
          <StatusBadge value={header.parent_relation} />
        ) : (
          <span>{copy.workspace.detail.rootSession}</span>
        )}
        {header.agent_type && <span>{header.agent_type}</span>}
        {header.parent && (
          <>
            <span>{copy.workspace.detail.parentSession}</span>
            <a href={`/s/${header.parent.session_id}`}>
              {header.parent.title ?? copy.workspace.sessions.untitled}
            </a>
          </>
        )}
      </div>
      <dl className="session-git" aria-label={copy.workspace.detail.gitContext}>
        {git.map(({ label, value, href }) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              {value ? (
                <>
                  {href ? (
                    <a href={href} target="_blank" rel="noreferrer">
                      {value}
                    </a>
                  ) : (
                    <span>{value}</span>
                  )}
                  <CopyButton
                    value={value}
                    label={`${copy.workspace.common.copy} ${label}`}
                  />
                </>
              ) : (
                <span>{copy.workspace.common.unavailable}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      <div className="session-facts">
        <span>
          {harnessLabel(header.harness)}
          {header.harness_version ? ` ${header.harness_version}` : ""}
        </span>
        <span>{header.model ?? copy.workspace.common.unavailable}</span>
        <span>{header.installation_hostname}</span>
        <time dateTime={header.started_at}>{dateTime(header.started_at)}</time>
        <span>
          {number(header.message_count)}
          {copy.workspace.common.separator}
          {copy.workspace.fields.message_count}
        </span>
      </div>
      <details className="session-details">
        <summary>
          <ChevronDown size={16} aria-hidden />
          {copy.workspace.detail.details}
        </summary>
        <ShortenedFields fields={header.truncated_fields} />
        <dl>
          {(Object.keys(header) as (keyof SessionHeader)[])
            .filter((key) => key !== "parent" && key !== "children")
            .map((key) => {
              const value = header[key];
              const text =
                key === "harness"
                  ? harnessLabel(header.harness)
                  : dates.has(key) &&
                      (typeof value === "string" || value === null)
                    ? dateTime(value)
                    : numeric.has(key) &&
                        (typeof value === "string" ||
                          typeof value === "number" ||
                          value === null)
                      ? number(value)
                      : Array.isArray(value)
                        ? value
                            .map(textValue)
                            .join(copy.workspace.common.separator) ||
                          copy.workspace.common.unavailable
                        : typeof value === "boolean"
                          ? value
                            ? copy.workspace.common.yes
                            : copy.workspace.common.no
                          : textValue(value);
              return (
                <div key={key}>
                  <dt>{labels[key]}</dt>
                  <dd>
                    {text}
                    {typeof value === "string" && key.endsWith("_id") && (
                      <CopyButton value={value} />
                    )}
                  </dd>
                </div>
              );
            })}
        </dl>
      </details>
      {(header.parent || header.children.length > 0) && (
        <section
          className="session-relations"
          aria-label={copy.workspace.detail.tree}
        >
          <GitFork size={16} aria-hidden />
          {header.parent && (
            <div>
              <span>{copy.workspace.fields.parent}</span>
              <a href={`/s/${header.parent.session_id}`}>
                {header.parent.title ?? copy.workspace.sessions.untitled}
              </a>
              {header.parent_relation && (
                <StatusBadge value={header.parent_relation} />
              )}
            </div>
          )}
          {header.children.length > 0 && (
            <div>
              <span>{copy.workspace.fields.children}</span>
              {header.children_truncated && (
                <p>{copy.workspace.detail.childrenTruncated}</p>
              )}
              {header.children.map((child) => (
                <a href={`/s/${child.session_id}`} key={child.session_id}>
                  {child.title ?? copy.workspace.sessions.untitled}
                  {child.parent_relation && (
                    <StatusBadge value={child.parent_relation} />
                  )}
                </a>
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}
