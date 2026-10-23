"use client";

import { startTransition, type FormEvent } from "react";

/**
 * Submits a form to a server action without React resetting the form afterwards. A failed save
 * must leave what the person typed in place. (Without script the browser would send the form
 * itself, so these forms use method="post": nothing typed ever ends up in the address.)
 */
export function keepForm(action: (data: FormData) => void) {
  return (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter;
    const data = new FormData(
      e.currentTarget,
      submitter instanceof HTMLElement ? submitter : null,
    );
    startTransition(() => action(data));
  };
}
