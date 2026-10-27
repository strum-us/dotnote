import { useState, type FormEvent } from "react";
import { LogOut } from "lucide-react";
import { observer } from "mobx-react-lite";

import { SettingsField, SettingsSectionShell } from "@/components/settings/SettingsSectionShell";
import { Button } from "@/components/ui/button";
import { FieldSelect } from "@/components/ui/field-select";
import { Input } from "@/components/ui/input";
import { authStore } from "@/stores/auth-store";
import { noteStore } from "@/stores/note-store";
import { isThemePreference } from "@/lib/theme";
import { themeStore } from "@/stores/theme-store";

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
