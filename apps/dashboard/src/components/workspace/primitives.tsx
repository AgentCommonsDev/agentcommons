import {
  Check,
  Copy,
  LoaderCircle,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { useId, useState } from "react";
import type { ReactNode } from "react";
import { copy } from "../../copy";
import { errorMessage } from "../../lib/display";
import { Button } from "../ui/button";
export function PageHeading({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="workspace-page-heading">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="workspace-page-actions">{actions}</div>}
    </div>
  );
}
export function RequestError({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  return (
    <div className="request-error" role="alert">
      <TriangleAlert size={20} aria-hidden />
      <div>
        <strong>{copy.workspace.common.requestFailed}</strong>
        <p>{errorMessage(error)}</p>
      </div>
      {retry && (
        <Button variant="secondary" onClick={retry}>
          <RefreshCw size={15} aria-hidden />
          {copy.workspace.common.retry}
        </Button>
      )}
    </div>
  );
}
export function LoadingState() {
  return (
    <div className="loading-state" role="status">
      <span className="loading-label">
        <LoaderCircle size={19} className="spin" aria-hidden />
        {copy.workspace.common.loading}
      </span>
      <div className="loading-skeleton" aria-hidden>
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
export function EmptyState({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {children}
    </div>
  );
}
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: (props: { id: string; "aria-describedby"?: string }) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="form-field">
      <label htmlFor={id}>{label}</label>
      {children({ id, ...(hint ? { "aria-describedby": `${id}-hint` } : {}) })}
      {hint && <p id={`${id}-hint`}>{hint}</p>}
    </div>
  );
}
export function CopyButton({
  value,
  label = copy.workspace.common.copy,
}: {
  value: string;
  label?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");
  const perform = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("error");
    }
  };
  return (
    <span className="copy-control">
      <Button
        variant="ghost"
        size="icon"
        aria-label={state === "copied" ? copy.workspace.common.copied : label}
        onClick={() => {
          void perform();
        }}
      >
        {state === "copied" ? (
          <Check size={14} aria-hidden />
        ) : (
          <Copy size={14} aria-hidden />
        )}
      </Button>
      <span
        className={state === "error" ? "copy-error" : "sr-only"}
        role="status"
      >
        {state === "copied"
          ? copy.workspace.common.copied
          : state === "error"
            ? copy.workspace.common.copyFailed
            : ""}
      </span>
    </span>
  );
}
export function StatusBadge({ value }: { value: string }) {
  const labels: Record<string, string> = copy.workspace.statuses;
  return (
    <span className={`status-badge status-${value.toLowerCase()}`}>
      {labels[value] ?? value}
    </span>
  );
}

export function ShortenedFields({ fields }: { fields: string[] }) {
  if (fields.length === 0) return null;
  return (
    <p className="panel-description shortened-fields">
      {copy.workspace.detail.metadataTruncated}{" "}
      {fields
        .map(
          (field) =>
            (copy.workspace.fields as Record<string, string>)[field] ?? field,
        )
        .join(copy.workspace.common.separator)}{" "}
      {copy.workspace.detail.metadataFull}
    </p>
  );
}
