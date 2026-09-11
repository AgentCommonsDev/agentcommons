import { Link } from "@tanstack/react-router";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  Clock,
  Download,
  GitBranch,
  Radio,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  formatSessionHeader,
  repositoryLinks,
} from "@agentcommons/core/format";
import { copy } from "../../copy";
import {
  dateTime,
  duration,
  fieldLabel,
  harnessLabel,
  number,
  statusLabel,
  textValue,
  timeOnly,
} from "../../lib/display";
import type { SessionHeader, TreeNode } from "../../lib/types";
import { cn } from "../../lib/utils";
import {
  CopyButton,
  DefinitionList,
  StatusBadge,
} from "../../components/app/states";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Alert, Spinner } from "../../components/ui/feedback";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../components/ui/menu";

const labels = copy.sessions.detail;
const fields = copy.app.fields;
const dateKeys = new Set(["started_at", "ended_at", "purged_at"]);
const numberKeys = new Set([
  "message_count",
  "tool_call_count",
  "input_tokens",
  "output_tokens",
  "file_count",
  "observed_commit_count",
  "reuse_count",
  "agentcommons_search_calls",
  "reuses_made",
  "child_count",
]);
const badgeKeys = new Set(["visibility", "parent_relation"]);
/** The event stream's state as the page sees it; absent once a session is no longer live. */
export type StreamState = "connecting" | "streaming" | "reconnecting";
type SessionRef = SessionHeader["children"][number];
type RelatedNodes = ReadonlyMap<string, TreeNode>;

/** ACTIVE reads as a pulsing Live mark; every other status keeps the shared badge. */
export function SessionStatusBadge({
  status,
  purged = false,
  className,
}: {
  status: SessionHeader["status"];
  purged?: boolean | undefined;
  className?: string | undefined;
}) {
  if (purged) return <StatusBadge value="PURGED" className={className} />;
  if (status !== "ACTIVE")
    return <StatusBadge value={status} className={className} />;
  return (
    <Badge
      variant="success"
      data-testid="session-live"
      className={cn("gap-1.5", className)}
    >
      <span aria-hidden className="relative flex size-2">
        <span className="absolute inline-flex size-full rounded-full bg-success opacity-60 motion-safe:animate-ping" />
        <span className="relative inline-flex size-2 rounded-full bg-success" />
      </span>
      {labels.live.badge}
    </Badge>
  );
}
function StreamIndicator({ state }: { state: StreamState }) {
  return (
    <span
      role="status"
      data-testid="session-stream"
      className="flex items-center gap-1.5 text-xs text-muted"
    >
      {state === "streaming" ? (
        <Radio size={13} aria-hidden className="text-success" />
      ) : (
        <Spinner size={13} />
      )}
      {labels.live[state]}
      {state === "reconnecting" && (
        <span className="text-subtle">
          {copy.app.common.separator}
          {labels.live.polling}
        </span>
      )}
    </span>
  );
}
function External({
  href,
  children,
  className,
}: {
  href: string | null;
  children: ReactNode;
  className?: string | undefined;
}) {
  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "min-w-0 max-w-full truncate hover:text-accent hover:underline",
        className,
      )}
    >
      {children}
    </a>
  ) : (
    <span className={cn("min-w-0 max-w-full truncate", className)}>
      {children}
    </span>
  );
}
/** One labelled fact in the header strip; the label is a definition term so it reads in order. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 max-w-full items-center gap-1.5">
      <dt className="shrink-0 text-[11px] font-medium tracking-wide text-subtle uppercase">
        {label}
      </dt>
      <dd className="flex min-w-0 items-center gap-1 text-fg">{children}</dd>
    </div>
  );
}
/** A related session as one compact row: type, relation, one-line title, counts, open link. */
function RelatedSession({
  session,
  node,
}: {
  session: SessionRef;
  node: TreeNode | undefined;
}) {
  const title = session.title ?? copy.app.common.untitledSession;
  // Phones put the badges and count on one line and the title below; wider
  // screens read badges, title, count on a single line.
  return (
    <li className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-2.5 py-1.5">
      {session.agent_type && (
        <Badge variant="outline" className="font-mono">
          {session.agent_type}
        </Badge>
      )}
      {session.parent_relation && (
        <StatusBadge value={session.parent_relation} />
      )}
      {node?.status === "ACTIVE" && <SessionStatusBadge status="ACTIVE" />}
      {node && (
        <span className="ml-auto shrink-0 text-xs text-muted tabular-nums sm:order-last">
          {number(node.message_count)} {labels.subagents.messages}
        </span>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            to="/app/sessions/$id"
            params={{ id: session.session_id }}
            className="flex min-w-0 basis-full items-center gap-1 text-accent hover:underline sm:flex-1 sm:basis-0"
          >
            <span className="truncate">{title}</span>
            <ArrowUpRight size={13} aria-hidden className="shrink-0" />
          </Link>
        </TooltipTrigger>
        <TooltipContent side="top" align="start">
          {title}
        </TooltipContent>
      </Tooltip>
    </li>
  );
}
function RelatedList({
  refs,
  nodes,
}: {
  refs: readonly SessionRef[];
  nodes: RelatedNodes;
}) {
  return (
    <ul className="flex w-full min-w-0 flex-col divide-y divide-line-soft rounded-md border border-line">
      {refs.map((session) => (
        <RelatedSession
          key={session.session_id}
          session={session}
          node={nodes.get(session.session_id)}
        />
      ))}
    </ul>
  );
}
/** Every header field with a human label; ids copy, links open, related sessions link. */
function detailValue(
  header: SessionHeader,
  key: keyof SessionHeader,
  nodes: RelatedNodes,
): ReactNode {
  const value = header[key];
  if (key === "harness") return harnessLabel(header.harness);
  if (key === "status")
    return (
      <SessionStatusBadge
        status={header.status}
        purged={header.purged_at !== null}
      />
    );
  if (key === "parent")
    return header.parent ? (
      <RelatedList refs={[header.parent]} nodes={nodes} />
    ) : (
      copy.app.common.unavailable
    );
  if (key === "children")
    return header.children.length === 0 ? (
      copy.app.common.unavailable
    ) : (
      <RelatedList refs={header.children} nodes={nodes} />
    );
  if (key === "repo_url" && typeof value === "string") {
    const links = repositoryLinks(value);
    return (
      <>
        <External href={links?.repository ?? null}>{value}</External>
        <CopyButton value={value} />
      </>
    );
  }
  if (
    (key === "start_commit" || key === "end_commit") &&
    typeof value === "string"
  ) {
    const links = repositoryLinks(header.repo_url ?? header.repo_name);
    return (
      <>
        <External href={links?.commit(value) ?? null}>
          <span className="font-mono text-xs">{value}</span>
        </External>
        <CopyButton value={value} />
      </>
    );
  }
  if (badgeKeys.has(key) && typeof value === "string")
    return <StatusBadge value={value} />;
  if (dateKeys.has(key) && (typeof value === "string" || value === null))
    return dateTime(value);
  if (
    numberKeys.has(key) &&
    (typeof value === "number" || typeof value === "string" || value === null)
  )
    return number(value);
  if (Array.isArray(value))
    return value.length
      ? value.map(textValue).join(copy.app.common.separator)
      : copy.app.common.unavailable;
  if (typeof value === "boolean")
    return value ? copy.app.common.yes : copy.app.common.no;
  if (typeof value === "string" && key.endsWith("_id"))
    return (
      <>
        <span className="truncate font-mono text-xs">{value}</span>
        <CopyButton value={value} />
      </>
    );
  return textValue(value);
}
function Stat({ value, label }: { value: string; label: string }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="font-medium text-fg tabular-nums">{value}</span>
      <span className="text-muted">{label}</span>
    </span>
  );
}
/** Today's sessions show the clock time; older ones keep the date so the day is never lost. */
function startedLabel(value: string, now: number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return dateTime(value);
  return date.toDateString() === new Date(now).toDateString()
    ? timeOnly(date)
    : dateTime(value);
}
/** A live session's duration counts up once a second; anything else renders once. */
function useNow(live: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [live]);
  return now;
}
export function SessionHeaderView({
  header,
  stream,
  related = [],
  actions,
}: {
  header: SessionHeader;
  /** Event stream state while the session is live; the page owns the connection. */
  stream?: StreamState | undefined;
  /** Tree nodes already loaded by the page, used to show counts on related sessions. */
  related?: readonly TreeNode[] | undefined;
  /** Controls the page adds beside the header's own, such as moderation for admins. */
  actions?: ReactNode | undefined;
}) {
  const [open, setOpen] = useState(false);
  const live = header.status === "ACTIVE" && header.ended_at === null;
  const now = useNow(live);
  const links = repositoryLinks(header.repo_url ?? header.repo_name);
  const started = new Date(header.started_at).getTime();
  const elapsed = header.ended_at
    ? (new Date(header.ended_at).getTime() - started) / 1000
    : live
      ? (now - started) / 1000
      : null;
  const tokens =
    header.input_tokens !== null || header.output_tokens !== null
      ? `${number(header.input_tokens)} ${labels.tokensIn}${copy.app.common.fractionSeparator}${number(header.output_tokens)} ${labels.tokensOut}`
      : null;
  const nodes = useMemo<RelatedNodes>(
    () => new Map(related.map((node) => [node.session_id, node])),
    [related],
  );
  const keys = Object.keys(header) as (keyof SessionHeader)[];
  const initial = header.user_email.slice(0, 1).toUpperCase();
  return (
    <header data-testid="session-header" className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl leading-tight font-semibold tracking-tight sm:text-2xl">
              {header.title ?? copy.app.common.untitledSession}
            </h1>
            <SessionStatusBadge
              status={header.status}
              purged={header.purged_at !== null}
            />
            {header.visibility === "PRIVATE" && (
              <StatusBadge value={header.visibility} />
            )}
            {header.parent_relation && (
              <StatusBadge value={header.parent_relation} />
            )}
            {header.agent_type && (
              <Badge variant="outline" className="font-mono">
                {header.agent_type}
              </Badge>
            )}
            {stream && <StreamIndicator state={stream} />}
          </div>
          <dl className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            <Fact label={fields.harness}>
              <Badge variant="outline" className="gap-1.5 text-xs">
                {harnessLabel(header.harness)}
                {header.harness_version && (
                  <span className="font-normal text-muted">
                    {header.harness_version}
                  </span>
                )}
              </Badge>
            </Fact>
            {header.model && (
              <Fact label={fields.model}>
                <Badge
                  variant="outline"
                  className="min-w-0 max-w-full shrink font-mono text-xs"
                >
                  <span className="truncate">{header.model}</span>
                </Badge>
              </Fact>
            )}
            <Fact label={fields.user_email}>
              <span
                aria-hidden
                className="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent-bg text-[10px] font-semibold text-accent"
              >
                {initial}
              </span>
              <span className="min-w-0 max-w-full truncate">
                {header.user_email}
              </span>
            </Fact>
            {(header.repo_name || header.branch) && (
              <Fact label={fields.repo_name}>
                <GitBranch size={13} aria-hidden className="text-muted" />
                {header.repo_name && (
                  <External href={links?.repository ?? null}>
                    {header.repo_name}
                  </External>
                )}
                {header.repo_name && header.branch && (
                  <span aria-hidden className="text-subtle">
                    {copy.app.common.fractionSeparator.trim()}
                  </span>
                )}
                {header.branch && (
                  <External
                    href={links?.branch(header.branch) ?? null}
                    className="font-mono text-xs"
                  >
                    {header.branch}
                  </External>
                )}
              </Fact>
            )}
            <Fact label={fields.started_at}>
              <Clock size={13} aria-hidden className="text-muted" />
              <time
                dateTime={header.started_at}
                title={dateTime(header.started_at)}
                className="whitespace-nowrap"
              >
                {startedLabel(header.started_at, now)}
              </time>
              <span aria-hidden className="text-subtle">
                {copy.app.common.separator.trim()}
              </span>
              <span className="whitespace-nowrap tabular-nums">
                {duration(elapsed)}
              </span>
            </Fact>
          </dl>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            aria-expanded={open}
            aria-controls="session-details"
            onClick={() => {
              setOpen((prior) => !prior);
            }}
          >
            {open ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
            {open ? labels.hideDetails : labels.details}
          </Button>
          <CopyButton
            value={formatSessionHeader(header)}
            label={labels.copyHeader}
            showLabel
            size="sm"
            variant="secondary"
          />
          <Button asChild variant="secondary" size="sm">
            <a
              href={`/api/v1/sessions/${header.session_id}?format=csv`}
              download={`${labels.csvPrefix}${header.session_id}.csv`}
              data-testid="session-export"
            >
              <Download aria-hidden />
              {labels.downloadCsv}
            </a>
          </Button>
          {actions}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <Stat value={number(header.message_count)} label={labels.messages} />
        <Stat value={number(header.tool_call_count)} label={labels.toolCalls} />
        {tokens && <Stat value={tokens} label={labels.tokens} />}
        {header.child_count > 0 && (
          <Stat
            value={number(header.child_count)}
            label={labels.subagentRuns}
          />
        )}
      </div>
      {header.truncated_fields.length > 0 && (
        <Alert variant="warning" title={labels.truncatedFields}>
          {header.truncated_fields
            .map(fieldLabel)
            .join(copy.app.common.separator)}
          {copy.app.common.separator}
          {labels.truncatedFieldsHint}
        </Alert>
      )}
      {open && (
        <div
          id="session-details"
          className="rounded-lg border border-line bg-surface p-4"
        >
          <DefinitionList
            columns={3}
            items={keys.map((key) => ({
              label:
                key === "parent_relation"
                  ? labels.subagents.relation
                  : fieldLabel(key),
              value: detailValue(header, key, nodes),
              wide: key === "children" || key === "parent",
            }))}
          />
          {header.children_truncated && (
            <p className="mt-3 text-xs text-muted">
              {labels.childrenTruncated}
            </p>
          )}
          <p className="sr-only">{statusLabel(header.status)}</p>
        </div>
      )}
    </header>
  );
}
