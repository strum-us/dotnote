import { makeAutoObservable, runInAction } from "mobx";
import type { AuthSetup, User } from "@shared/types";
import { ApiError, authApi } from "@/lib/api";

const USER_KEY = "dotnote-user-v2";

const AUTH_COPY: Record<string, string> = {
  invalid_credentials: "That email or password is wrong.",
  invalid_input: "Check the name, email, and password. Passwords need at least 8 characters.",
  account_exists: "This Dotnote already has an owner. Log in instead.",
  email_taken: "That email is already used.",
  password_mismatch: "The current password is wrong.",
  password_hasher_failed: "This Dotnote could not protect the password. Reload the page and try again.",
  account_failed: "This Dotnote could not save the account. Try again.",
  no_cloudflare_account: "This Dotnote has no Cloudflare account on file, so the password cannot be reset from here.",
  cf_unproven: "That Cloudflare login does not own this Dotnote.",
  account_missing: "Create the owner account before resetting the password.",
};

function readCachedUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

function writeCachedUser(user: User | null): void {
  try {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_KEY);
  } catch {
    /* storage unavailable */
  }
}

function authMessage(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) return fallback;
  const mapped = AUTH_COPY[error.message];
  if (mapped) return mapped;
  if (error.status >= 500) return "This Dotnote hit an error. Try again.";
  return fallback;
}

class AuthStore {
  user: User | null = null;
  booted = false;
  loading = false;
  error: string | null = null;
  setup: AuthSetup | null = null;
  setupError: string | null = null;

  private bootPromise: Promise<void> | null = null;
  private setupPromise: Promise<void> | null = null;

  constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }

  bootstrap(): Promise<void> {
    if (this.bootPromise) return this.bootPromise;
    this.bootPromise = this.loadMe();
    return this.bootPromise;
  }

  /** Boot from the remembered user so notes paint offline; the server check runs behind it. */
  private async loadMe(): Promise<void> {
    const cached = readCachedUser();
    if (cached) {
      this.user = cached;
      this.booted = true;
    }
    try {
      const { user } = await authApi.me();
      writeCachedUser(user);
      runInAction(() => {
        const same =
          user?.id === this.user?.id &&
          user?.fullName === this.user?.fullName &&
          user?.email === this.user?.email;
        if (!same) this.user = user;
        this.booted = true;
      });
    } catch {
      // Offline or a server error keeps the remembered user; only `{ user: null }` signs out.
      runInAction(() => {
        this.booted = true;
      });
    }
  }

  loadSetup(): Promise<void> {
    if (this.setupPromise) return this.setupPromise;
    this.setupPromise = this.fetchSetup();
    return this.setupPromise;
  }

  private async fetchSetup(): Promise<void> {
    try {
      const setup = await authApi.setup();
      runInAction(() => {
        this.setup = setup;
        this.setupError = null;
      });
    } catch (error) {
      runInAction(() => {
        this.setupError = authMessage(error, "Could not reach this Dotnote.");
        this.setupPromise = null;
      });
    }
  }

  async createAccount(fullName: string, email: string, password: string): Promise<boolean> {
    this.loading = true;
    this.error = null;
    try {
      const { user } = await authApi.createAccount(fullName, email, password);
      writeCachedUser(user);
      runInAction(() => {
        this.user = user;
        this.setup = this.setup ? { ...this.setup, needsAccount: false } : this.setup;
        this.loading = false;
      });
      return true;
    } catch (error) {
      runInAction(() => {
        this.error = authMessage(error, "This Dotnote could not save the account. Try again.");
        this.loading = false;
      });
      return false;
    }
  }

  async login(email: string, password: string): Promise<boolean> {
    this.loading = true;
    this.error = null;
    try {
      const { user } = await authApi.login(email, password);
      writeCachedUser(user);
      runInAction(() => {
        this.user = user;
        this.loading = false;
      });
      return true;
    } catch (error) {
      runInAction(() => {
        this.error = authMessage(error, "That email or password is wrong.");
        this.loading = false;
      });
      return false;
    }
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<string | null> {
    try {
      const { user } = await authApi.changePassword(currentPassword, newPassword);
      writeCachedUser(user);
      runInAction(() => {
        this.user = user;
      });
      return null;
    } catch (error) {
      return authMessage(error, "Could not update the password.");
    }
  }

  async logout(): Promise<void> {
    writeCachedUser(null);
    this.user = null;
    await authApi.logout().catch(() => {});
  }
}

export const authStore = new AuthStore();
