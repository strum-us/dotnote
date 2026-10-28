import { useEffect, useState, type FormEvent } from "react";
import { LogOut } from "lucide-react";
import { observer } from "mobx-react-lite";

import { SettingsField, SettingsSectionShell } from "@/components/settings/SettingsSectionShell";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { FieldCheck } from "@/components/ui/field-check";
import { FieldSelect } from "@/components/ui/field-select";
import { Input } from "@/components/ui/input";
import { authStore } from "@/stores/auth-store";
import { noteStore } from "@/stores/note-store";
import { isThemePreference } from "@/lib/theme";
import { themeStore } from "@/stores/theme-store";

const DiagnosticsSettings = observer(function DiagnosticsSettings({
  showPayload,
  onTogglePayload,
  withdrawOpen,
  onWithdrawOpen,
}: {
  showPayload: boolean;
  onTogglePayload: () => void;
  withdrawOpen: boolean;
  onWithdrawOpen: (open: boolean) => void;
}) {
  const diagnostics = authStore.diagnostics;
  const granted = diagnostics?.consent === "granted";
  const host = diagnostics?.endpointHost;

  function onConsentChange(next: boolean) {
    if (!diagnostics || authStore.diagnosticsSaving) return;
    if (next) {
      if (!diagnostics.available) return;
      void authStore.setDiagnosticsConsent(true, false);
      return;
    }
    if (diagnostics.lastReportedAt) {
      onWithdrawOpen(true);
      return;
    }
    void authStore.setDiagnosticsConsent(false, false);
  }

  const unavailable =
    diagnostics?.unavailableReason === "disabled"
      ? "Diagnostics are switched off for this deployment (DOTNOTE_DIAGNOSTICS_ENABLED)."
      : diagnostics?.unavailableReason === "unconfigured"
        ? "This Dotnote has no diagnostics credentials, so nothing is sent."
        : null;

  return (
    <div className="flex flex-col gap-2">
      <FieldCheck
        id="diagnostics-registration"
        checked={Boolean(granted)}
        disabled={!diagnostics || authStore.diagnosticsSaving || (!diagnostics.available && !granted)}
        onCheckedChange={onConsentChange}
        label={host ? `Register this Dotnote with ${host}` : "Register this Dotnote with Dotnote Cloud"}
        description="Optional. Sends your email, Cloudflare account id, Worker name, and this Dotnote's address. Notes and your password stay here."
      />
      {unavailable ? <p className="text-xs text-dim">{unavailable}</p> : null}
      {diagnostics?.lastReportedAt ? (
        <p className="text-xs text-dim">
          Last registered {new Date(diagnostics.lastReportedAt).toLocaleString()}.
          {granted ? null : " Sending is off. The registration is still on Dotnote Cloud until you delete it."}
        </p>
      ) : granted && diagnostics?.available ? (
        <p className="text-xs text-dim">Registration is on. A pending send finishes when this page loads.</p>
      ) : null}
      {diagnostics && !granted && diagnostics.lastReportedAt ? (
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={authStore.diagnosticsSaving}
            onClick={() => void authStore.setDiagnosticsConsent(false, true)}
          >
            Delete registration
          </Button>
        </div>
      ) : null}
      {authStore.diagnosticsError ? <p className="text-xs text-danger">{authStore.diagnosticsError}</p> : null}
      {diagnostics ? (
        <div>
          <Button type="button" variant="outline" size="sm" onClick={onTogglePayload}>
            {showPayload ? "Hide exact payload" : "View exact payload"}
          </Button>
          {showPayload ? (
            <pre className="mt-2 overflow-auto rounded-sm border border-divider bg-well p-2 text-xs text-ink">
              {JSON.stringify(diagnostics.payload, null, 2)}
            </pre>
          ) : null}
        </div>
      ) : authStore.diagnosticsError ? null : (
        <p className="text-xs text-dim">Loading diagnostics settings…</p>
      )}
      <AlertDialog open={withdrawOpen} onOpenChange={onWithdrawOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop sending diagnostics?</AlertDialogTitle>
            <AlertDialogDescription>
              Sending stops either way. Deleting also removes the registration from Dotnote Cloud.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep sending</AlertDialogCancel>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                onWithdrawOpen(false);
                void authStore.setDiagnosticsConsent(false, false);
              }}
            >
              Stop sending
            </Button>
            <AlertDialogAction
              onClick={() => {
                void authStore.setDiagnosticsConsent(false, true);
              }}
            >
              Delete registration
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
});

export const AccountSettings = observer(function AccountSettings({
  onSignOut,
}: {
  onSignOut?: () => void;
}) {
  const fullName = authStore.user?.fullName ?? "";
  const email = authStore.user?.email ?? "";
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordPending, setPasswordPending] = useState(false);
  const [showPayload, setShowPayload] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  useEffect(() => {
    void authStore.loadDiagnostics();
  }, []);

  async function updatePassword(event: FormEvent) {
    event.preventDefault();
    setPasswordPending(true);
    setPasswordMessage(null);
    setPasswordError(null);
    const error = await authStore.changePassword(currentPassword, newPassword);
    setPasswordPending(false);
    if (error) {
      setPasswordError(error);
      return;
    }
    setCurrentPassword("");
    setNewPassword("");
    setPasswordMessage("Password updated.");
  }

  return (
    <SettingsSectionShell title="Account" description="Your profile, appearance, and session.">
      <SettingsField label="Theme">
        <FieldSelect
          value={themeStore.preference}
          onValueChange={(value) => {
            if (isThemePreference(value)) themeStore.setPreference(value);
          }}
          options={[
            { value: "system", label: "System" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
          aria-label="Color theme"
        />
      </SettingsField>
      <SettingsField label="Full name">
        <p className="text-sm text-ink">{fullName || "—"}</p>
      </SettingsField>
      <SettingsField label="Email">
        <p className="text-sm text-ink">{email || "—"}</p>
      </SettingsField>
      <DiagnosticsSettings
        showPayload={showPayload}
        onTogglePayload={() => setShowPayload((open) => !open)}
        withdrawOpen={withdrawOpen}
        onWithdrawOpen={setWithdrawOpen}
      />
      <form className="flex flex-col gap-3" onSubmit={updatePassword}>
        <SettingsField label="Current password">
          <Input
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
        </SettingsField>
        <SettingsField label="New password">
          <Input
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
        </SettingsField>
        {passwordError ? <p className="text-xs text-danger">{passwordError}</p> : null}
        {passwordMessage ? <p className="text-xs text-dim">{passwordMessage}</p> : null}
        <div>
          <Button type="submit" size="sm" disabled={passwordPending || !currentPassword || !newPassword}>
            Update password
          </Button>
        </div>
      </form>
      <div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            noteStore.checkpoint();
            onSignOut?.();
            void authStore.logout();
          }}
        >
          <LogOut className="size-3.5" />
          Sign out
        </Button>
      </div>
    </SettingsSectionShell>
  );
});
