import * as LabelPrimitive from "@radix-ui/react-label";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { Check } from "lucide-react";
import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "../../lib/utils";

export function Label({
  className,
  ...props
}: ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      className={cn("text-[13px] font-medium text-fg", className)}
      {...props}
    />
  );
}
/** Label, control, hint and error wired together with ids. */
export function Field({
  label,
  hint,
  error,
  className,
  optional,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  optional?: ReactNode;
  children: (props: {
    id: string;
    "aria-describedby"?: string;
    "aria-invalid"?: boolean;
  }) => ReactNode;
}) {
  const id = useId();
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id} className="flex items-baseline gap-2">
        {label}
        {optional && (
          <span className="text-xs font-normal text-subtle">{optional}</span>
        )}
      </Label>
      {children({
        id,
        ...(describedBy ? { "aria-describedby": describedBy } : {}),
        ...(error ? { "aria-invalid": true } : {}),
      })}
      {hint && (
        <p id={`${id}-hint`} className="text-xs leading-relaxed text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
export function Checkbox({
  className,
  ...props
}: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        "peer flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-line bg-surface text-primary-fg transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator>
        <Check size={12} strokeWidth={3} aria-hidden />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
/** A checkbox with an inline label; the whole row is the click target. */
export function CheckboxField({
  label,
  hint,
  className,
  ...props
}: ComponentProps<typeof CheckboxPrimitive.Root> & {
  label: ReactNode;
  hint?: ReactNode;
}) {
  const id = useId();
  return (
    <div className={cn("flex items-start gap-2.5", className)}>
      <Checkbox id={id} className="mt-0.5" {...props} />
      <div className="flex flex-col gap-0.5">
        <Label htmlFor={id} className="cursor-pointer font-normal">
          {label}
        </Label>
        {hint && <p className="text-xs text-muted">{hint}</p>}
      </div>
    </div>
  );
}
export function Switch({
  className,
  ...props
}: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-line transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-4 rounded-full bg-surface shadow transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0.5" />
    </SwitchPrimitive.Root>
  );
}
