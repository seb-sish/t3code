import {
  type EnvironmentId,
  type UsageLimitSourceConfig,
  UsageLimitSourceId,
} from "@t3tools/contracts";
import { useState } from "react";

import { useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { SecretInput } from "./SecretInput";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

function sourceIdFromUrl(url: string, kind: UsageLimitSourceConfig["kind"]): UsageLimitSourceId {
  let host = url;
  try {
    host = new URL(url).host;
  } catch {}
  const slug = host
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return UsageLimitSourceId.make(`${kind}-${slug || "hub"}`);
}

/** Send the management key once to server secret storage; settings retain only a redaction marker. */
export function AddUsageLimitSourceDialog({
  open,
  onOpenChange,
  environmentId,
  environmentLabel,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
}) {
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const [kind, setKind] = useState<UsageLimitSourceConfig["kind"]>("cliproxy");
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [managementKey, setManagementKey] = useState("");
  const isMinimax = kind === "minimax";
  const trimmedUrl = isMinimax ? "https://www.minimax.io" : url.trim();
  const canSave = trimmedUrl.length > 0 && managementKey.trim().length > 0;

  const reset = () => {
    setKind("cliproxy");
    setLabel("");
    setUrl("");
    setManagementKey("");
  };

  const save = () => {
    if (!canSave) return;
    const id = sourceIdFromUrl(trimmedUrl, kind);
    updateSettings({
      usageLimitSources: {
        [id]: {
          kind,
          ...(label.trim()
            ? { label: label.trim() }
            : isMinimax
              ? { label: "MiniMax M Plan" }
              : {}),
          url: trimmedUrl,
          managementKey: managementKey.trim(),
          enabled: true,
        },
      },
    });
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add a quota source</DialogTitle>
          <DialogDescription>
            Show subscription quotas on {environmentLabel}. The key stays on that server.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="usage-source-kind">Source</Label>
              <Select
                value={kind}
                onValueChange={(value) => {
                  if (value === "cliproxy" || value === "minimax") {
                    setKind(value);
                    setManagementKey("");
                  }
                }}
              >
                <SelectTrigger id="usage-source-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="cliproxy">CLIProxyAPI hub</SelectItem>
                  <SelectItem value="minimax">MiniMax M Plan</SelectItem>
                </SelectPopup>
              </Select>
            </div>
            {!isMinimax ? (
              <div className="grid gap-1.5">
                <Label htmlFor="usage-source-url">Hub URL</Label>
                <Input
                  id="usage-source-url"
                  placeholder="https://hub.example.ts.net:8318"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  autoFocus
                />
              </div>
            ) : null}
            <div className="grid gap-1.5">
              <Label htmlFor="usage-source-key">
                {isMinimax ? "Subscription Key" : "Management key"}
              </Label>
              <SecretInput
                id="usage-source-key"
                value={managementKey}
                onChange={(event) => setManagementKey(event.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="usage-source-label">Label (optional)</Label>
              <Input
                id="usage-source-label"
                placeholder={isMinimax ? "MiniMax M Plan" : "Defaults to the hub's host name"}
                value={label}
                onChange={(event) => setLabel(event.target.value)}
              />
            </div>
          </form>
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button
            variant="outline"
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button onClick={save} disabled={!canSave}>
            Add source
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
