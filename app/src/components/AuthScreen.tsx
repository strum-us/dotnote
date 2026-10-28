import { useEffect, useState, type FormEvent } from "react";
import { observer } from "mobx-react-lite";
import { authStore } from "@/stores/auth-store";
import { DotnoteMark } from "@/components/DotnoteMark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AUTH_CREATE_PATH, AUTH_LOGIN_PATH, isAuthCreatePath } from "@/lib/auth-route";
import { FieldCheck } from "@/components/ui/field-check";

function resetHref(installerOrigin: string): string | null {
  try {
    const url = new URL(installerOrigin);
    url.pathname = "/reset";
    url.searchParams.set("instance", window.location.origin);
    return url.toString();
  } catch {
    return null;
  }
}

export const AuthScreen = observer(function AuthScreen() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [diagnosticsConsent, setDiagnosticsConsent] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [authPath, setAuthPath] = useState(() =>
    typeof window !== "undefined" ? window.location.pathname : "/",
  );

  useEffect(() => {
    void authStore.loadSetup();
  }, []);

  useEffect(() => {
    const sync = () => setAuthPath(window.location.pathname);
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const setup = authStore.setup;
  const creating = isAuthCreatePath(authPath);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (creating) {
      if (password !== confirmPassword) {
        setFormError("Those passwords do not match.");
        return;
      }
      await authStore.createAccount(fullName.trim(), email.trim(), password, diagnosticsConsent);
      return;
    }
    await authStore.login(email.trim(), password);
  }

  const errorMessage = formError ?? authStore.error;

  const recovery = setup?.installerOrigin ? resetHref(setup.installerOrigin) : null;

  return (
    <div className="flex min-h-full items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-sm border border-divider bg-well p-6">
        <DotnoteMark className="size-10" />
        <h1 className="mt-3 text-lg font-semibold text-ink">Dotnote</h1>
        {setup ? (
          <p className="mt-1 text-sm text-dim">
            {creating
              ? "Create the owner account for this Dotnote."
              : "Log in to this Dotnote."}
          </p>
        ) : (
          <p className="mt-1 text-sm text-dim">
            {authStore.setupError ?? "Checking this Dotnote…"}
          </p>
        )}
        {setup ? (
          <form className="mt-6 space-y-3" onSubmit={submit}>
            {creating ? (
              <div className="space-y-1">
                <Label htmlFor="full-name">Full name</Label>
                <Input
                  id="full-name"
                  value={fullName}
                  autoComplete="name"
                  autoFocus
                  onChange={(event) => setFullName(event.target.value)}
                />
              </div>
            ) : null}
            <div className="space-y-1">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                autoComplete="email"
                autoFocus={!creating}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                autoComplete={creating ? "new-password" : "current-password"}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setFormError(null);
                }}
              />
            </div>
            {creating ? (
              <div className="space-y-1">
                <Label htmlFor="confirm-password">Confirm password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  autoComplete="new-password"
                  onChange={(event) => {
                    setConfirmPassword(event.target.value);
                    setFormError(null);
                  }}
                />
              </div>
            ) : null}
            {creating && setup.diagnosticsAvailable ? (
              <div className="space-y-2 pt-1">
                <FieldCheck
                  id="diagnostics-consent"
                  checked={diagnosticsConsent}
                  onCheckedChange={setDiagnosticsConsent}
                  label={
                    setup.diagnosticsHost
                      ? `Register this Dotnote with ${setup.diagnosticsHost}`
                      : "Register this Dotnote with Dotnote Cloud"
                  }
                  description="Optional. Notes and your password stay on this Dotnote. You can turn this off later in Settings."
                />
                <button
                  type="button"
                  className="text-xs text-accent-color hover:underline"
                  onClick={() => setShowDiagnostics((open) => !open)}
                >
                  {showDiagnostics ? "Hide what is sent" : "What is sent?"}
                </button>
                {showDiagnostics ? (
                  <div className="space-y-1 text-xs text-dim">
                    <p>Sent: your email, Cloudflare account id, Worker name, this Dotnote's address, a random instance id, and the app version.</p>
                    <p>Not sent: your password, notes, titles, folders, or workspace names.</p>
                  </div>
                ) : null}
              </div>
            ) : null}
            {errorMessage ? <p className="text-xs text-danger">{errorMessage}</p> : null}
            <Button type="submit" className="w-full" disabled={authStore.loading}>
              {creating ? "Create account" : "Log in"}
            </Button>
          </form>
        ) : authStore.setupError ? (
          <Button type="button" className="mt-6 w-full" onClick={() => void authStore.loadSetup()}>
            Try again
          </Button>
        ) : null}
        {setup && !creating ? (
          <div className="mt-4 space-y-2 text-center text-xs">
            <a href={AUTH_CREATE_PATH} className="block w-full text-accent-color hover:underline">
              Create account
            </a>
            {recovery ? (
              <a href={recovery} className="block w-full text-accent-color hover:underline">
                Forgot password?
              </a>
            ) : null}
          </div>
        ) : null}
        {setup && creating ? (
          <div className="mt-4 space-y-2 text-center">
            <a href={AUTH_LOGIN_PATH} className="block w-full text-xs text-accent-color hover:underline">
              Log in instead
            </a>
            <p className="text-xs text-dim">Your name, email, and password are stored on this Dotnote, in your Cloudflare account.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
});
