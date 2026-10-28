"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  previewImport,
  runImport,
  type ImportMapping,
  type ImportSummary,
  type Preview,
} from "@/app/(app)/w/[workspaceId]/people/actions";
import { FormError } from "./form-message";
import { plural } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/** A Radix Select cannot use an empty string as a value; this stands in for "none". */
const ANY = "__any";

const FIELDS: { key: keyof ImportMapping; label: string; hint?: string }[] = [
  { key: "name", label: "Person's name" },
  { key: "email", label: "Email" },
  { key: "account", label: "Company" },
  {
    key: "revenue",
    label: "Revenue",
    hint: "weights requests by the value of the companies asking",
  },
  { key: "plan", label: "Plan" },
  { key: "renewal", label: "Renewal date" },
  { key: "domain", label: "Website" },
];

export function ImportWizard({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [csv, setCsv] = useState<string>();
  const [fileName, setFileName] = useState<string>();
  const [preview, setPreview] = useState<Preview>();
  const [mapping, setMapping] = useState<ImportMapping>();
  const [skip, setSkip] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<ImportSummary>();
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  function reset() {
    setCsv(undefined);
    setFileName(undefined);
    setPreview(undefined);
    setMapping(undefined);
    setSkip(false);
    setError(undefined);
    setDone(undefined);
    if (input.current) input.current.value = "";
  }

  function check(text: string, m?: ImportMapping) {
    setError(undefined);
    start(async () => {
      const res = await previewImport(workspaceId, text, m);
      if (!res.ok) {
        setPreview(undefined);
        setError(res.error);
        return;
      }
      setPreview(res.data);
      setMapping(res.data.mapping);
    });
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setDone(undefined);
    if (file.size > 5 * 1024 * 1024) {
      setError(
        "That file is larger than 5 MB. Split it into smaller files and import them one at a time.",
      );
      return;
    }
    const text = await file.text();
    setCsv(text);
    setFileName(file.name);
    check(text);
  }

  function changeMapping(key: keyof ImportMapping, header: string) {
    if (!csv) return;
    const next = { ...mapping };
    if (header) next[key] = header;
    else delete next[key];
    setMapping(next);
    check(csv, next);
  }

  function confirm() {
    if (!csv) return;
    setError(undefined);
    start(async () => {
      const res = await runImport(workspaceId, csv, mapping, skip);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone(res.data);
      setPreview(undefined);
      router.refresh();
    });
  }

  if (done) {
    return (
      <Card role="status" className="[--card-spacing:0px] space-y-3 p-5">
        <p className="font-medium">Import finished</p>
        <ul className="list-disc pl-5 text-sm">
          <li>
            {plural(done.peopleCreated, "person", "people")} added,{" "}
            {done.peopleUpdated} updated
          </li>
          <li>
            {plural(done.accountsCreated, "company", "companies")} added,{" "}
            {done.accountsUpdated} updated
          </li>
          {done.skipped > 0 ? (
            <li>{plural(done.skipped, "row")} left out because of problems</li>
          ) : null}
        </ul>
        <Button type="button" variant="outline" onClick={reset}>
          Import another file
        </Button>
      </Card>
    );
  }

  const ready = preview
    ? skip
      ? preview.validRows
      : preview.errorCount === 0
        ? preview.validRows
        : 0
    : 0;

  return (
    <div className="space-y-4">
      <div>
        <Label
          id="csv-file-label"
          htmlFor="csv-file"
          className="mb-1 block text-sm font-medium"
        >
          CSV file
        </Label>
        <Input
          id="csv-file"
          ref={input}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/plain"
          onChange={onFile}
          aria-describedby="csv-help"
        />
        <p id="csv-help" className="mt-1 text-sm text-muted-foreground">
          Columns for name, email, company and revenue are found automatically.
          We show you what we understood before anything is saved.
        </p>
      </div>

      {pending ? (
        <p role="status" className="text-muted-foreground">
          Reading the file…
        </p>
      ) : null}
      <FormError message={error} />

      {preview ? (
        <div className="space-y-4">
          <p role="status" className="font-medium">
            {fileName}: {plural(preview.validRows, "row")} ready
            {preview.errorCount > 0
              ? `, ${plural(preview.errorCount, "problem")} to fix`
              : ""}{" "}
            (of {preview.totalRows}).
          </p>

          <Card asChild className="[--card-spacing:0px] space-y-3 p-5">
            <fieldset>
              <legend className="px-1 text-sm font-medium">
                What each column means
              </legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {FIELDS.map((f) => (
                  <div key={f.key}>
                    <Label
                      htmlFor={`map-${f.key}`}
                      className="mb-1 block text-sm font-medium"
                    >
                      {f.label}
                    </Label>
                    <Select
                      value={mapping?.[f.key] ?? ANY}
                      onValueChange={(value) =>
                        changeMapping(f.key, value === ANY ? "" : value)
                      }
                    >
                      <SelectTrigger id={`map-${f.key}`}>
                        <SelectValue placeholder="(none)" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ANY}>(none)</SelectItem>
                        {preview.headers.map((h) => (
                          <SelectItem key={h} value={h}>
                            {h}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {f.hint && !mapping?.[f.key] ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {f.hint}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            </fieldset>
          </Card>

          {preview.sample.length > 0 ? (
            <Card className="[--card-spacing:0px] p-0">
              <div
                role="region"
                aria-label="First rows of the file"
                tabIndex={0}
                className="overflow-x-auto"
              >
                <Table containerClassName="overflow-visible">
                  <TableCaption className="mb-1 px-2 text-left font-medium text-foreground">
                    First rows of the file
                  </TableCaption>
                  <TableHeader>
                    <TableRow>
                      {preview.headers.map((h) => (
                        <TableHead key={h} scope="col">
                          {h}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.sample.map((row, i) => (
                      <TableRow key={i}>
                        {row.map((c, j) => (
                          <TableCell key={j}>{c}</TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Card>
          ) : null}

          {preview.warnings.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {preview.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : null}

          {preview.errorCount > 0 ? (
            <div
              role="alert"
              className="space-y-2 rounded-xl border border-destructive p-3"
            >
              <p className="font-medium text-destructive">
                {plural(preview.errorCount, "problem")} found
                {preview.errors.length < preview.errorCount
                  ? ` (showing the first ${preview.errors.length})`
                  : ""}
              </p>
              <ul className="space-y-1 text-sm">
                {preview.errors.map((e, i) => (
                  <li key={i}>
                    Row {e.row}
                    {e.column ? `, “${e.column}”` : ""}: {e.message}
                  </li>
                ))}
              </ul>
              <div className="flex min-h-11 items-center gap-2 text-sm">
                <Checkbox
                  id="import-skip"
                  checked={skip}
                  onCheckedChange={(checked) => setSkip(checked === true)}
                />
                <Label
                  id="import-skip-label"
                  htmlFor="import-skip"
                  className="text-sm font-normal"
                >
                  Leave out the rows with problems and import the rest
                </Label>
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              onClick={confirm}
              disabled={pending || ready === 0}
            >
              {pending ? "Importing…" : `Import ${plural(ready, "row")}`}
            </Button>
            <Button type="button" variant="outline" onClick={reset}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
