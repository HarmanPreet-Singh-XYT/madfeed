"use client";

import { Route } from "lucide-react";
import { Button } from "@/components/ui/button";
import { START_TOUR_EVENT } from "./product-tour";

/** Starts the product tour from anywhere on a page (the Help menu has the same entry). */
export function TakeTourButton({ label = "Take the 1-minute tour" }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="gap-1.5"
      onClick={() => window.dispatchEvent(new Event(START_TOUR_EVENT))}
    >
      <Route aria-hidden="true" className="size-3.5" />
      {label}
    </Button>
  );
}
