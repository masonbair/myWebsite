"use client";

import type { ComponentProps } from "react";
import { useFormStatus } from "react-dom";

/** A form's submit button that disables itself while the server action runs. */
export function SubmitButton(props: Omit<ComponentProps<"button">, "type">) {
  const { pending } = useFormStatus();
  return <button {...props} type="submit" disabled={pending || props.disabled} aria-busy={pending || undefined} />;
}
