import type { ReactNode } from "react";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { FormError } from "@/components/form-message";

/** One labelled control in a form: label, the control, optional help, and the error, in that order. */
export function FormField({
  id,
  label,
  hint,
  error,
  children,
  className,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Field
      data-invalid={error ? true : undefined}
      className={className}
      orientation="vertical"
    >
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {children}
      {hint ? <FieldDescription>{hint}</FieldDescription> : null}
      <FormError message={error} />
    </Field>
  );
}
