import { copy } from "../../copy";
import { dateTime, metricValue, textValue } from "../../lib/display";
import type { AuditEvent } from "../../lib/types";
import { Badge } from "../../components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
} from "../../components/ui/dialog";
import { CodeBlock } from "../../components/app/markdown";
import { CopyButton, DefinitionList } from "../../components/app/states";

export function StatusCodeBadge({ code }: { code: number }) {
  const variant = code >= 500 ? "danger" : code >= 400 ? "warning" : "success";
  return (
    <Badge variant={variant} className="font-mono">
      {String(code)}
    </Badge>
  );
}
export function AuditRecordDialog({
  event,
  onClose,
}: {
  event: AuditEvent | null;
  onClose: () => void;
}) {
  const text = copy.admin.audit;
  const fields = copy.app.fields;
  const description = event
    ? [event.action, dateTime(event.ts)].join(copy.app.common.separator)
    : undefined;
  return (
    <Dialog
      open={event !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent size="lg">
        <DialogHeader title={text.record} description={description} />
        {event && (
          <div className="flex flex-col gap-5">
            <DefinitionList
              columns={2}
              items={[
                {
                  label: fields.status_code,
                  value: <StatusCodeBadge code={event.status_code} />,
                },
                {
                  label: fields.duration_ms,
                  value: metricValue(event.duration_ms, "milliseconds"),
                },
                { label: fields.transport, value: event.transport },
                { label: fields.auth_method, value: event.auth_method },
                { label: text.user, value: textValue(event.user_id) },
                {
                  label: fields.api_key_id,
                  value: textValue(event.api_key_id),
                },
                {
                  label: fields.installation_id,
                  value: textValue(event.installation_id),
                },
                { label: fields.ip, value: event.ip },
                {
                  label: fields.user_agent,
                  value: textValue(event.user_agent),
                  wide: true,
                },
                {
                  label: fields.request_id,
                  value: (
                    <>
                      <span className="font-mono text-xs break-all">
                        {event.request_id}
                      </span>
                      <CopyButton value={event.request_id} />
                    </>
                  ),
                  wide: true,
                },
                {
                  label: fields.resource_type,
                  value: textValue(event.resource_type),
                },
                {
                  label: fields.resource_ids,
                  value:
                    event.resource_ids.length === 0 ? (
                      copy.app.common.unavailable
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {event.resource_ids.map((id) => (
                          <Badge
                            key={id}
                            variant="outline"
                            className="font-mono"
                          >
                            {id}
                          </Badge>
                        ))}
                      </span>
                    ),
                  wide: true,
                },
                {
                  label: fields.id,
                  value: (
                    <span className="font-mono text-xs break-all">
                      {event.id}
                    </span>
                  ),
                  wide: true,
                },
              ]}
            />
            <div className="flex flex-col gap-1.5">
              <p className="text-xs text-muted">{text.detail}</p>
              {event.detail === null ? (
                <p className="text-sm text-muted">{text.noDetail}</p>
              ) : (
                <CodeBlock
                  content={JSON.stringify(event.detail, null, 2)}
                  language="json"
                  copyLabel={text.copyJson}
                  maxHeight="max-h-80"
                />
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
