"use client";

import { useState, useTransition } from "react";
import { saveInboxSettingsAction } from "@/app/(app)/w/[workspaceId]/inbox/actions";
import { FormError } from "./form-message";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function InboxSettings({
  workspaceId,
  initial,
  webUrl,
  apiUrl,
}: {
  workspaceId: string;
  initial: {
    chatEnabled: boolean;
    emailEnabled: boolean;
    origins: string[];
    greeting: string;
    widgetToken?: string;
    inboundKey?: string;
  };
  webUrl: string;
  apiUrl: string;
}) {
  const [chat, setChat] = useState(initial.chatEnabled);
  const [mail, setMail] = useState(initial.emailEnabled);
  const [origins, setOrigins] = useState(initial.origins.join("\n"));
  const [greeting, setGreeting] = useState(initial.greeting);
  const [newWidget, setNewWidget] = useState(false);
  const [newKey, setNewKey] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Customers can reach you by the chat button on your website or by email.
        Both land in the Inbox.
      </p>
      <form
        method="post"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await saveInboxSettingsAction(workspaceId, {
              chatEnabled: chat,
              emailEnabled: mail,
              origins: origins.split(/[\s,]+/).filter(Boolean),
              greeting,
              rotateWidget: newWidget,
              rotateInbound: newKey,
            });
            setError(r?.error);
            setSaved(!r?.error);
            if (!r?.error) {
              setNewWidget(false);
              setNewKey(false);
            }
          });
        }}
      >
        <div className="flex items-center gap-2">
          <Checkbox
            id="inbox-chat"
            checked={chat}
            onCheckedChange={(checked) => setChat(checked === true)}
          />
          <Label
            id="inbox-chat-label"
            htmlFor="inbox-chat"
            className="text-sm font-medium"
          >
            Website chat
          </Label>
        </div>
        <div>
          <Label
            id="inbox-origins-label"
            htmlFor="inbox-origins"
            className="mb-1 block text-sm font-medium"
          >
            Sites that may show the chat (one per line, like
            https://www.example.com)
          </Label>
          <Textarea
            id="inbox-origins"
            rows={3}
            value={origins}
            onChange={(e) => setOrigins(e.target.value)}
          />
          <p className="mt-1 text-sm text-muted-foreground">
            This keeps the chat from showing up on other sites by accident. It
            is not a lock: the chat address is visible in your page, so anyone
            who has it could send messages. If someone abuses it, make a new
            chat address below.
          </p>
        </div>
        <div>
          <Label
            id="inbox-greeting-label"
            htmlFor="inbox-greeting"
            className="mb-1 block text-sm font-medium"
          >
            First thing visitors see in the chat
          </Label>
          <Input
            id="inbox-greeting"
            value={greeting}
            maxLength={300}
            onChange={(e) => setGreeting(e.target.value)}
            placeholder="Hi! How can we help?"
          />
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="inbox-mail"
            checked={mail}
            onCheckedChange={(checked) => setMail(checked === true)}
          />
          <Label
            id="inbox-mail-label"
            htmlFor="inbox-mail"
            className="text-sm font-medium"
          >
            Email
          </Label>
        </div>
        {initial.widgetToken ? (
          <div className="flex items-center gap-2">
            <Checkbox
              id="inbox-new-widget"
              checked={newWidget}
              onCheckedChange={(checked) => setNewWidget(checked === true)}
            />
            <Label
              id="inbox-new-widget-label"
              htmlFor="inbox-new-widget"
              className="text-sm"
            >
              Make a new chat address (the old snippet stops working)
            </Label>
          </div>
        ) : null}
        {initial.inboundKey ? (
          <div className="flex items-center gap-2">
            <Checkbox
              id="inbox-new-key"
              checked={newKey}
              onCheckedChange={(checked) => setNewKey(checked === true)}
            />
            <Label
              id="inbox-new-key-label"
              htmlFor="inbox-new-key"
              className="text-sm"
            >
              Make a new email signing key (the old one stops working)
            </Label>
          </div>
        ) : null}
        <FormError message={error} />
        {saved ? (
          <p role="status" className="text-sm text-muted-foreground">
            Saved.
          </p>
        ) : null}
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save the inbox settings"}
        </Button>
      </form>
      {initial.widgetToken ? (
        <div className="space-y-1">
          <Label
            id="chat-snippet-label"
            htmlFor="chat-snippet"
            className="block text-sm font-medium"
          >
            Paste this into your website, just before the closing body tag
          </Label>
          <Textarea
            id="chat-snippet"
            readOnly
            rows={2}
            className="font-mono text-xs"
            value={`<script src="${webUrl}/chat.js" data-widget="${initial.widgetToken}" async></script>`}
          />
        </div>
      ) : null}
      {initial.inboundKey ? (
        <div className="space-y-2">
          <p className="text-sm">
            Point your mail service&apos;s incoming-email hook at this address.
            It must send the message as JSON (<code>from</code>,{" "}
            <code>fromName</code>, <code>subject</code>, <code>text</code>,{" "}
            <code>messageId</code>) with an <code>X-Timestamp</code> header
            (seconds) and an <code>X-Signature</code> header:{" "}
            <code>sha256=</code> and the hex HMAC-SHA256 of the timestamp, a dot
            and the body, using the key below.
          </p>
          <Label
            id="inbound-url-label"
            htmlFor="inbound-url"
            className="block text-sm font-medium"
          >
            Address for incoming email
          </Label>
          <Input
            id="inbound-url"
            readOnly
            className="font-mono text-xs"
            value={`${apiUrl}/v1/integrations/email/${workspaceId}/inbound`}
          />
          <Label
            id="inbound-key-label"
            htmlFor="inbound-key"
            className="block text-sm font-medium"
          >
            Signing key (keep it private)
          </Label>
          <Input
            id="inbound-key"
            readOnly
            className="font-mono text-xs"
            value={initial.inboundKey}
          />
        </div>
      ) : null}
    </div>
  );
}
