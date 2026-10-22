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
import { btn, btnPrimary, card, field } from "./ui";
import { plural } from "@/lib/format";

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
      <div role="status" className={`${card} space-y-3`}>
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
        <button type="button" onClick={reset} className={btn}>
          Import another file
        </button>
      </div>
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
        <label htmlFor="csv-file" className="mb-1 block text-sm font-medium">
          CSV file
        </label>
        <input
          id="csv-file"
          ref={input}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/plain"
          onChange={onFile}
          className={field}
          aria-describedby="csv-help"
        />
        <p id="csv-help" className="mt-1 text-sm text-muted">
          Columns for name, email, company and revenue are found automatically.
          We show you what we understood before anything is saved.
        </p>
      </div>

      {pending ? (
        <p role="status" className="text-muted">
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

          <fieldset className={`${card} space-y-3`}>
            <legend className="px-1 text-sm font-medium">
              What each column means
            </legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {FIELDS.map((f) => (
                <div key={f.key}>
                  <label
                    htmlFor={`map-${f.key}`}
                    className="mb-1 block text-sm font-medium"
                  >
                    {f.label}
                  </label>
                  <select
                    id={`map-${f.key}`}
                    value={mapping?.[f.key] ?? ""}
                    onChange={(e) => changeMapping(f.key, e.target.value)}
                    className={field}
                  >
                    <option value="">(none)</option>
                    {preview.headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                  {f.hint && !mapping?.[f.key] ? (
                    <p className="mt-1 text-xs text-muted">{f.hint}</p>
                  ) : null}
                </div>
              ))}
            </div>
          </fieldset>

          {preview.sample.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="mb-1 text-left text-sm font-medium">
                  First rows of the file
                </caption>
                <thead>
                  <tr>
                    {preview.headers.map((h) => (
                      <th
                        key={h}
                        scope="col"
                        className="border-b border-border px-2 py-1 font-medium"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.sample.map((row, i) => (
                    <tr key={i}>
                      {row.map((c, j) => (
                        <td
                          key={j}
                          className="border-b border-border px-2 py-1"
                        >
                          {c}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {preview.warnings.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
              {preview.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : null}

          {preview.errorCount > 0 ? (
            <div
              role="alert"
              className="space-y-2 rounded-md border border-danger p-3"
            >
              <p className="font-medium text-danger">
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
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={skip}
                  onChange={(e) => setSkip(e.target.checked)}
                  className="size-5"
                />
                Leave out the rows with problems and import the rest
              </label>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={confirm}
              disabled={pending || ready === 0}
              className={btnPrimary}
            >
              {pending ? "Importing…" : `Import ${plural(ready, "row")}`}
            </button>
            <button type="button" onClick={reset} className={btn}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
