"use client";

import { useRouter } from "next/navigation";
import { FileText, Mic } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PasteForm } from "./paste-form";
import { RecordingUpload } from "./recording-upload";
import type { PersonOption } from "./person-combobox";
import { Card } from "@/components/ui/card";

const TRIGGER =
  "h-9 flex-none gap-2 rounded-lg px-3.5 text-sm font-medium text-muted-foreground data-active:bg-card data-active:text-foreground data-active:shadow-xs";

/**
 * One door for adding feedback. Pasting text and uploading a recording are two
 * ways to the same thing; they share a page instead of living in two menus.
 */
export function AddFeedback({
  workspaceId,
  people,
  recordingPeople,
}: {
  workspaceId: string;
  people: PersonOption[];
  recordingPeople: { id: string; name: string }[];
}) {
  const router = useRouter();
  return (
    <Tabs defaultValue="paste" className="gap-5">
      <TabsList
        aria-label="How to add feedback"
        className="h-auto w-fit gap-1 rounded-xl border border-border bg-muted p-1"
      >
        <TabsTrigger value="paste" className={TRIGGER}>
          <FileText className="size-4" aria-hidden="true" />
          Paste text
        </TabsTrigger>
        <TabsTrigger value="upload" className={TRIGGER}>
          <Mic className="size-4" aria-hidden="true" />
          Upload a recording
        </TabsTrigger>
      </TabsList>

      <TabsContent value="paste">
        <PasteForm workspaceId={workspaceId} people={people} />
      </TabsContent>

      <TabsContent value="upload">
        <Card className="[--card-spacing:0px] overflow-hidden">
          <div className="border-b border-border px-4 py-3.5 sm:px-5">
            <h2 className="text-sm font-semibold">Upload a recording</h2>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
              We write out what was said, with who said it, then find requests
              in the same way as a pasted conversation. The audio is sent to the
              transcription service; nothing else about your workspace is.
            </p>
          </div>
          <div className="px-4 py-4 sm:px-5">
            <RecordingUpload
              workspaceId={workspaceId}
              people={recordingPeople}
              onDone={() => router.refresh()}
            />
          </div>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
