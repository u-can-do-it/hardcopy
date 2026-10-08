/**
 * "I have a key" (project.md §6.1). Shared by the Pro dialog and the options
 * page, so there is one implementation of activation to get right.
 *
 * No account, no login - a key pasted once, stored in storage.sync so it
 * follows the profile and survives reinstalls.
 */

import { useEffect, useState } from "preact/hooks";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LICENSE_RECOVERY_URL } from "@/lib/constants";
import {
  activateKey,
  deactivateKey,
  licenseBusy,
  licenseError,
  licenseNotice,
  licenseState,
  refreshLicense,
} from "@/stores/license";

export interface LicenseFormProps {
  /** Tighter spacing for the popup dialog. */
  compact?: boolean;
}

export function LicenseForm({ compact = false }: LicenseFormProps) {
  const [key, setKey] = useState("");

  useEffect(() => {
    void refreshLicense();
  }, []);

  const state = licenseState.value;
  const busy = licenseBusy.value;

  if (state?.pro) {
    return (
      <div className="grid gap-2">
        <p className="text-sm font-medium">Pro key active</p>
        {state.graceExpired ? (
          <p className="text-muted-foreground text-xs">
            This key has not been re-checked in a while. Connect once to confirm it.
          </p>
        ) : null}
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void deactivateKey()}>
            {busy ? "Removing..." : "Remove key"}
          </Button>
          <span className="text-muted-foreground text-xs">Frees an activation slot.</span>
        </div>
        {licenseNotice.value ? (
          <p className="text-muted-foreground text-xs">{licenseNotice.value}</p>
        ) : null}
      </div>
    );
  }

  const submit = (): void => {
    void activateKey(key).then((ok) => {
      if (ok) setKey("");
    });
  };

  return (
    <div className={compact ? "grid gap-2" : "grid gap-2.5"}>
      <Label htmlFor="licenseKey" className="text-sm">
        I have a key
      </Label>
      <div className="flex items-start gap-2">
        <Input
          id="licenseKey"
          value={key}
          spellcheck={false}
          autocomplete="off"
          placeholder="XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"
          className="font-mono text-xs"
          disabled={busy}
          onInput={(event) => setKey((event.target as HTMLInputElement).value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
        />
        <Button size="sm" className="shrink-0" disabled={busy || !key.trim()} onClick={submit}>
          {busy ? "Checking..." : "Activate"}
        </Button>
      </div>

      {licenseError.value ? (
        <p className="text-destructive text-xs">{licenseError.value}</p>
      ) : (
        <p className="text-muted-foreground text-xs">
          Pasted once, then it follows your Chrome profile.{" "}
          <a
            href={LICENSE_RECOVERY_URL}
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            Lost my key?
          </a>
        </p>
      )}
    </div>
  );
}
