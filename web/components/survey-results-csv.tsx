"use client";

import { Download } from "lucide-react";
import { toast } from "sonner";
import type { components } from "@/lib/api/schema.gen";
import { buildSurveyCsv, surveyCsvName } from "@/lib/survey-csv";
import { Button } from "@/components/ui/button";

/** Saves every figure and written answer as a spreadsheet-friendly CSV. */
export function SurveyResultsCsv({
  title,
  questions,
  results,
}: {
  title: string;
  questions: components["schemas"]["SurveyQuestion"][];
  results: components["schemas"]["SurveyResults"];
}) {
  function download() {
    try {
      const url = URL.createObjectURL(
        new Blob([buildSurveyCsv(questions, results)], {
          type: "text/csv;charset=utf-8",
        }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = surveyCsvName(title);
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Your browser wouldn't let us save the file.");
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={download}
      className="border-on-brand/30 bg-on-brand/10 text-on-brand hover:bg-on-brand/20 hover:text-on-brand"
    >
      <Download aria-hidden="true" className="size-4" />
      Download CSV
    </Button>
  );
}
