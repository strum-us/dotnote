const card = document.querySelector("#card");
const fine = document.querySelector("#fine");
const stepList = document.querySelector("#step-list");

const WIZARD = ["Connect", "Account", "Name", "Address", "Review", "Deploy", "Open"];
const API_TIMEOUT_MS = 20_000;

let deployLogLabels = [];

let config = null;
let account = null;
let zones = [];
let zone = null;
let addressMode = "workers";
let hostPrefix = "dotnote";
let workerName = "dotnote";
let checkResult = null;

function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value != null && value !== false) node.setAttribute(key, String(value));
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function sessionGet(key) {
  return sessionStorage.getItem(key);
}
function sessionSet(key, value) {
  sessionStorage.setItem(key, value);
}
function sessionDel(key) {
  sessionStorage.removeItem(key);
}

function installs() {
  try {
    return JSON.parse(sessionGet("dotnote.installs") || "{}");
  } catch {
    return {};
  }
}
function saveInstall(id, value) {
  const all = installs();
  all[id] = value;
  sessionSet("dotnote.installs", JSON.stringify(all));
}

function bytesToB64Url(bytes) {
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256b64url(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return bytesToB64Url(new Uint8Array(digest));
}

function randomHex(bytes = 32) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function paintStepList(stepIndex) {
  if (!stepList) return;
  stepList.replaceChildren(
    ...WIZARD.map((label, index) =>
      h("li", { class: index < stepIndex ? "is-done" : index === stepIndex ? "is-current" : "" },
        h("span", { class: "step-num" }, String(index + 1).padStart(2, "0")),
        label,
      ),
    ),
  );
}

function shell(stepIndex, title, ...body) {
  paintStepList(stepIndex);
  const badge = `${String(stepIndex + 1).padStart(2, "0")} · ${WIZARD[stepIndex]}`;
  card.replaceChildren(
    h("p", { class: "panel-badge" }, badge),
    h("h2", { class: "panel-title" }, title),
    h("div", { class: "panel-body" }, ...body),
  );
}

function setFine() {
  if (!fine) return;
  fine.textContent = config?.releaseVersion
    ? `Release ${config.releaseVersion}. This page uses a short-lived Cloudflare access token and does not keep it. Your refresh token is sent only to your new Dotnote after it proves it is live.`
    : "This page uses a short-lived Cloudflare access token and does not keep it. Your refresh token is sent only to your new Dotnote after it proves it is live.";
}

function initStepList() {
  paintStepList(0);
}

async function api(path, body) {
  const access = await ensureAccess();
  let res;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { authorization: `Bearer ${access}`, "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new Error("That request took too long. Check your connection and try again.");
    }
    throw err;
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = json.error?.message || json.message || "Cloudflare or the installer rejected that request.";
    throw new Error(message);
  }
  return json;
}

async function ensureAccess() {
  const exp = Number(sessionGet("dotnote.oauth.exp") || 0);
  const current = sessionGet("dotnote.oauth.access");
  if (current && Date.now() < exp - 60_000) return current;
  const refresh = sessionGet("dotnote.oauth.refresh");
  if (!refresh) throw new Error("Connect Cloudflare again.");
  const res = await fetch("https://dash.cloudflare.com/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refresh,
      client_id: config.clientId,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description || "The Cloudflare session expired. Connect again.");
  }
  rememberToken(json);
  return json.access_token;
}

function rememberToken(json) {
  sessionSet("dotnote.oauth.access", json.access_token);
  if (json.refresh_token) sessionSet("dotnote.oauth.refresh", json.refresh_token);
  if (json.scope) sessionSet("dotnote.oauth.scope", json.scope);
  sessionSet("dotnote.oauth.exp", String(Date.now() + (json.expires_in || 3600) * 1000));
}

function forgetToken() {
  sessionDel("dotnote.oauth.access");
  sessionDel("dotnote.oauth.refresh");
  sessionDel("dotnote.oauth.exp");
}

function connected() {
  return !!sessionGet("dotnote.oauth.access") || !!sessionGet("dotnote.oauth.refresh");
}

function captureEntry() {
  const query = new URLSearchParams(location.search);
  const mode = query.get("mode");
  if (mode === "reconnect") {
    sessionSet("dotnote.reconnect.instance", query.get("instance") || "");
    sessionSet("dotnote.reconnect.code", query.get("code") || "");
    sessionSet("dotnote.reconnect.accountId", query.get("accountId") || "");
    sessionDel("dotnote.reset.instance");
    return;
  }
  if (mode === "reset") {
    sessionSet("dotnote.reset.instance", query.get("instance") || "");
    sessionDel("dotnote.reconnect.instance");
    sessionDel("dotnote.reconnect.code");
    sessionDel("dotnote.reconnect.accountId");
    forgetToken();
    return;
  }
  if (location.pathname === "/") {
    sessionDel("dotnote.reconnect.instance");
    sessionDel("dotnote.reconnect.code");
    sessionDel("dotnote.reconnect.accountId");
    sessionDel("dotnote.reset.instance");
  }
}

function reconnecting() {
  return !!sessionGet("dotnote.reconnect.instance") && !!sessionGet("dotnote.reconnect.code");
}

function recovering() {
  return !!sessionGet("dotnote.reset.instance");
}

function resetOrigin(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function recoverMessage(code) {
  if (code === "cf_unproven") return "This Cloudflare login cannot open that Dotnote’s account.";
  if (code === "no_cloudflare_account") return "That Dotnote has no Cloudflare account to prove.";
  if (code === "account_missing") return "Create the owner account on that Dotnote first.";
  if (code === "invalid_input") return "Use a password of 8 to 128 characters.";
  if (code === "password_hasher_failed") return "This Dotnote could not protect the password. Reload and try again.";
  if (code === "account_failed") return "This Dotnote could not save the password. Try again.";
  return "The password was not updated.";
}

async function connect() {
  if (!config.clientId) {
    showConnect();
    return;
  }
  const verifier = bytesToB64Url(crypto.getRandomValues(new Uint8Array(32)));
  const state = bytesToB64Url(crypto.getRandomValues(new Uint8Array(16)));
  sessionSet("dotnote.oauth.verifier", verifier);
  sessionSet("dotnote.oauth.state", state);
  const redirect = `${location.origin}/oauth/callback`;
  const url = new URL("https://dash.cloudflare.com/oauth2/auth");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirect);
  url.searchParams.set("scope", config.scopes.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", await sha256b64url(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  location.href = url.toString();
}

async function finishCallback() {
  const query = new URLSearchParams(location.search);
  const code = query.get("code");
  const state = query.get("state");
  if (query.get("error")) {
    history.replaceState({}, "", "/");
    shell(0, "Sign in to Cloudflare", h("p", { class: "error" }, query.get("error_description") || query.get("error")));
    return;
  }
  if (!code) return false;
  if (!state || state !== sessionGet("dotnote.oauth.state")) {
    history.replaceState({}, "", "/");
    shell(0, "Sign in to Cloudflare", h("p", { class: "error" }, "The Cloudflare return did not match this tab."));
    return true;
  }
  const redirect = `${location.origin}/oauth/callback`;
  const res = await fetch("https://dash.cloudflare.com/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirect,
      client_id: config.clientId,
      code_verifier: sessionGet("dotnote.oauth.verifier") || "",
    }),
  });
  const json = await res.json().catch(() => ({}));
  history.replaceState({}, "", "/");
  if (!res.ok || !json.access_token) {
    shell(
      0,
      "Sign in to Cloudflare",
      h("p", { class: "error" }, json.error_description || "Cloudflare did not return a token. Allow this site on the OAuth client, then connect again."),
      h("button", { onclick: () => void connect() }, "Connect Cloudflare"),
    );
    return true;
  }
  rememberToken(json);
  sessionDel("dotnote.oauth.verifier");
  sessionDel("dotnote.oauth.state");
  return false;
}

function showConnect() {
  shell(
    0,
    "Sign in to Cloudflare",
    h("p", { class: "lead" }, "Authorize Dotnote once. Your instance keeps the grant and renews it when Cloudflare management is needed."),
    config.clientId
      ? h("p", { class: "status-line" }, "You will see Cloudflare’s consent screen for Workers, D1, R2, and DNS-related scopes.")
      : h("p", { class: "status-line is-warn" }, "This installer is not linked to an OAuth client yet. Set OAUTH_CLIENT_ID on the installer Worker, then reload."),
    h("button", { onclick: () => void connect(), disabled: !config.clientId }, "Connect Cloudflare"),
  );
}

function showConnectForReset() {
  const origin = resetOrigin(sessionGet("dotnote.reset.instance") || "");
  shell(
    6,
    "Reset password",
    h(
      "p",
      { class: "lead" },
      "Sign in to the Cloudflare account that owns this Dotnote. A short-lived token proves you control the account; it is not stored on the installer.",
    ),
    origin ? h("p", { class: "hint" }, origin) : null,
    config.clientId
      ? h("p", { class: "status-line" }, "After Cloudflare sign-in, you can set a new owner password.")
      : h("p", { class: "status-line is-warn" }, "This installer is not linked to an OAuth client yet. Set OAUTH_CLIENT_ID on the installer Worker, then reload."),
    h("button", { onclick: () => void connect(), disabled: !config.clientId }, "Sign in to Cloudflare"),
  );
}

async function showAccount() {
  shell(1, "Choose the account", h("p", { class: "hint" }, "Loading accounts…"));
  const { accounts } = await api("/api/accounts");
  const unfinished = [];
  if (accounts.length === 1) {
    const found = await api("/api/installations/find", { accountId: accounts[0].id });
    unfinished.push(...found.installations.map((row) => ({ ...row, accountId: accounts[0].id })));
  }
  const buttons = accounts.map((item) =>
    h("button", { class: "choice", onclick: () => void pickAccount(item) }, item.name),
  );
  const resume = unfinished.map((row) => {
    const known = installs()[row.id];
    return h("div", { class: "row" },
      h("span", {}, `${row.workerName} · ${row.address}`),
      known
        ? h("button", { class: "ghost", onclick: () => void resumeInstall(row.id) }, "Continue")
        : h("span", { class: "hint" }, "Started in another browser"),
      h("button", { class: "ghost", onclick: () => void removeInstall(row) }, "Remove"),
    );
  });
  shell(
    1,
    "Choose the account",
    h("p", { class: "lead" }, "Dotnote is created in this account. Nothing is created until you deploy."),
    h("div", { class: "stack" }, ...buttons),
    resume.length ? h("div", { class: "stack" }, h("p", { class: "hint" }, "Unfinished"), ...resume) : null,
  );
}

async function pickAccount(item) {
  const detail = await api("/api/account", { accountId: item.id });
  account = detail;
  sessionSet("dotnote.oauth.accountId", detail.id);
  workerName = "dotnote";
  hostPrefix = "dotnote";
  addressMode = detail.workersDevSubdomain ? "workers" : "domain";
  zone = null;
  zones = [];
  showName();
}

function showName() {
  const input = h("input", { type: "text", value: workerName, id: "worker-name" });
  input.addEventListener("input", () => {
    workerName = input.value.trim().toLowerCase();
    hostPrefix = workerName || "dotnote";
  });
  shell(
    2,
    "Name it",
    h("p", { class: "lead" }, "The Worker, D1 database, and R2 bucket use this name."),
    h("label", { for: "worker-name" }, "Name"),
    input,
    h("p", { class: "hint" }, "Lowercase letters, digits, and dashes. An existing Dotnote can be updated on the review step."),
    h("button", { onclick: () => void showAddress() }, "Continue"),
  );
}

async function showAddress() {
  if (!/^[a-z][a-z0-9-]{0,40}$/.test(workerName) || workerName.endsWith("-")) {
    shell(2, "Name it", h("p", { class: "error" }, "Use a short lowercase name."), h("button", { onclick: showName }, "Back"));
    return;
  }
  shell(3, "Choose the address", h("p", { class: "hint" }, "Loading domains…"));
  zones = (await api("/api/zones", { accountId: account.id })).zones;
  renderAddress();
}

function renderAddress(message) {
  const workers = account.workersDevSubdomain
    ? h("button", {
        class: `choice${addressMode === "workers" ? " picked" : ""}`,
        onclick: () => { addressMode = "workers"; renderAddress(); },
      }, `https://${workerName}.${account.workersDevSubdomain}.workers.dev`)
    : h("p", { class: "hint" }, "This account has no workers.dev subdomain yet. Open Workers & Pages in the dashboard once, then check again.");
  const prefix = h("input", { type: "text", value: hostPrefix, id: "prefix" });
  prefix.addEventListener("input", () => { hostPrefix = prefix.value.trim().toLowerCase(); });
  const filter = h("input", { type: "text", placeholder: "Filter domains", id: "zone-filter" });
  const zoneBox = h("div", { class: "zones stack" });
  const paintZones = () => {
    const q = filter.value.trim().toLowerCase();
    const shown = zones.filter((item) => item.name.includes(q)).slice(0, 30);
    zoneBox.replaceChildren(...shown.map((item) =>
      h("button", {
        class: `choice${zone?.id === item.id ? " picked" : ""}`,
        onclick: () => { zone = item; addressMode = "domain"; paintZones(); },
      }, item.name),
    ));
  };
  filter.addEventListener("input", paintZones);
  paintZones();
  shell(
    3,
    "Choose the address",
    h("p", { class: "lead" }, "You open Dotnote at this address."),
    workers,
    zones.length
      ? h("div", {},
          h("button", {
            class: `choice${addressMode === "domain" ? " picked" : ""}`,
            onclick: () => { addressMode = "domain"; renderAddress(); },
          }, "On your domain"),
          addressMode === "domain" ? h("label", { for: "prefix" }, "Name in front of the domain") : null,
          addressMode === "domain" ? prefix : null,
          addressMode === "domain" ? filter : null,
          addressMode === "domain" ? zoneBox : null,
        )
      : null,
    message ? h("p", { class: "error" }, message) : null,
    h("div", { class: "row" },
      h("button", { class: "ghost", onclick: showName }, "Back"),
      h("button", { onclick: () => void showReview() }, "Continue"),
    ),
  );
}

function chosenHostname() {
  if (addressMode !== "domain") return null;
  if (!zone || !/^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/.test(hostPrefix)) return null;
  return `${hostPrefix}.${zone.name}`;
}

function resourceStatusLabel(kind) {
  if (kind === "free") return "available";
  if (kind === "dotnote") return "your Dotnote";
  if (kind === "foreign") return "in use by something else";
  if (kind === "unknown") return "could not verify";
  return kind;
}

function renderReview(address, hostname) {
  const blocked = checkResult.suggestedMode === "blocked";
  const mode = checkResult.suggestedMode;
  const releaseLine = config.releaseVersion ? `Release ${config.releaseVersion}` : "Release";
  const installed = checkResult.installedVersion ? `Installed ${checkResult.installedVersion}` : null;
  let actionHint = "Nothing already in the account is changed.";
  if (mode === "update") {
    actionHint = "Update replaces the Worker and static files. Your D1 index and R2 notes stay in place.";
  } else if (mode === "repair") {
    actionHint = "Repair reuses your data and fills in anything missing.";
  }

  const primaryLabel =
    mode === "update" ? "Update Dotnote" : mode === "repair" ? "Repair Dotnote" : "Deploy Dotnote";

  const danger = h("details", { class: "danger-zone" },
    h("summary", {}, "Danger: delete all Dotnote data and reinstall"),
    h("p", { class: "hint" }, "This removes the Worker, D1 database, and every object in the R2 bucket. It cannot be undone."),
    h("label", { for: "wipe-confirm-name" }, `Type ${workerName} to confirm`),
    h("input", { type: "text", id: "wipe-confirm-name", autocomplete: "off" }),
    h("button", {
      class: "danger",
      onclick: () => void confirmWipe(address, hostname, document.getElementById("wipe-confirm-name")?.value ?? ""),
    }, "Delete data and reinstall"),
  );

  shell(
    4,
    mode === "update" ? "Update your Dotnote" : "Check before you deploy",
    h("p", { class: "lead" }, `${account.name}`),
    h("ul", { class: "list" },
      h("li", {}, `Worker ${workerName} · ${resourceStatusLabel(checkResult.worker)}`),
      h("li", {}, `D1 ${workerName}-index · ${resourceStatusLabel(checkResult.database)}`),
      h("li", {}, `R2 ${workerName}-data · ${resourceStatusLabel(checkResult.bucket)}`),
      h("li", {}, address),
      h("li", {}, installed ? `${releaseLine} (from ${installed})` : releaseLine),
    ),
    blocked
      ? h("p", { class: "error" }, checkResult.blockReason || "This install cannot continue.")
      : h("p", { class: "hint" }, actionHint),
    h("div", { class: "row" },
      h("button", { class: "ghost", onclick: () => renderAddress() }, "Back"),
      h("button", {
        disabled: blocked,
        onclick: () => void (mode === "update" || mode === "repair"
          ? showUpdateConsent(address, hostname, mode)
          : startDeploy(address, hostname, "fresh")),
      }, primaryLabel),
    ),
    !blocked && (mode === "update" || mode === "repair" || checkResult.worker === "dotnote") ? danger : null,
  );
}

function showUpdateConsent(address, hostname, mode) {
  const releaseLine = config.releaseVersion ? `Release ${config.releaseVersion}` : "the new release";
  shell(
    4,
    mode === "update" ? "Confirm update" : "Confirm repair",
    h("p", { class: "lead" }, `Replace Worker ${workerName} with ${releaseLine}.`),
    h("p", { class: "hint" }, "Your notes in R2 and account data in D1 are kept. The site may be unavailable for up to a minute."),
    h("div", { class: "row" },
      h("button", { class: "ghost", onclick: () => renderReview(address, hostname) }, "Back"),
      h("button", { onclick: () => void startDeploy(address, hostname, mode) }, mode === "update" ? "Update Worker" : "Repair Dotnote"),
    ),
  );
}

async function confirmWipe(address, hostname, typed) {
  if (typed.trim() !== workerName) {
    shell(
      4,
      "Check before you deploy",
      h("p", { class: "error" }, `Type ${workerName} exactly to confirm data deletion.`),
      h("button", { class: "ghost", onclick: () => renderReview(address, hostname) }, "Back"),
    );
    return;
  }
  shell(
    4,
    "Delete all Dotnote data?",
    h("p", { class: "error" }, "This permanently deletes notes in R2 and accounts in D1 for this name."),
    h("div", { class: "row" },
      h("button", { class: "ghost", onclick: () => renderReview(address, hostname) }, "Cancel"),
      h("button", { class: "danger", onclick: () => void startDeploy(address, hostname, "wipe", true, typed.trim()) }, "Delete everything and reinstall"),
    ),
  );
}

async function showReview() {
  const hostname = chosenHostname();
  if (addressMode === "domain" && !hostname) {
    renderAddress("Choose a domain and a short name in front of it.");
    return;
  }
  if (addressMode === "workers" && !account.workersDevSubdomain) {
    renderAddress("This account has no workers.dev address yet.");
    return;
  }
  shell(4, "Check before you deploy", h("p", { class: "hint" }, "Checking names…"));
  try {
    checkResult = await api("/api/check", {
      accountId: account.id,
      workerName,
      hostname: hostname || "",
      zoneId: hostname ? zone.id : "",
      zoneName: hostname ? zone.name : "",
    });
  } catch (err) {
    shell(
      4,
      "Check before you deploy",
      h("p", { class: "error" }, err instanceof Error ? err.message : "Could not check this account."),
      h("div", { class: "row" },
        h("button", { class: "ghost", onclick: () => renderAddress() }, "Back"),
        h("button", { onclick: () => void showReview() }, "Try again"),
      ),
    );
    return;
  }
  const address = hostname ? `https://${hostname}` : `https://${workerName}.${account.workersDevSubdomain}.workers.dev`;
  renderReview(address, hostname);
}

async function startDeploy(address, hostname, mode = "fresh", confirmWipe = false, workerNameConfirm = "") {
  const code = randomHex(32);
  const handoffHash = await sha256Hex(code);
  let created;
  try {
    created = await api("/api/installations", {
      accountId: account.id,
      workerName,
      hostname: hostname || "",
      zoneId: hostname ? zone.id : "",
      zoneName: hostname ? zone.name : "",
      handoffHash,
      mode,
      confirmWipe: confirmWipe || undefined,
      workerNameConfirm: workerNameConfirm || undefined,
    });
  } catch (err) {
    shell(
      4,
      "Check before you deploy",
      h("p", { class: "error" }, err instanceof Error ? err.message : "Could not start the install."),
      h("button", { onclick: () => void showReview() }, "Back to review"),
    );
    return;
  }
  saveInstall(created.installationId, { key: created.key, code, address: created.address || address, accountId: account.id });
  sessionSet("dotnote.install.current", created.installationId);
  await runDeploy(created.installationId);
}

async function resumeInstall(id) {
  sessionSet("dotnote.install.current", id);
  await runDeploy(id);
}

async function removeInstall(row) {
  await api(`/api/installations/${row.id}/cleanup`, {});
  await showAccount();
}

function deployProgressView(address, view) {
  const label = view.step.label;
  if (deployLogLabels.at(-1) !== label) deployLogLabels.push(label);
  const done = deployLogLabels.slice(0, -1);
  const active = deployLogLabels.at(-1) ?? label;
  return shell(
    5,
    "Deploying Dotnote",
    h("p", { class: "lead" }, address),
    h("div", { class: "deploy-log" },
      ...done.map((item) => h("p", { class: "log-line is-done" }, item)),
      h("p", { class: "log-line is-active" }, active),
    ),
    view.message ? h("p", { class: "hint" }, view.message) : null,
    h("p", { class: "hint" }, `Step ${Math.min(view.step.index + 1, view.step.total)} of ${view.step.total}`),
  );
}

async function runDeploy(id) {
  const saved = installs()[id];
  if (!saved) {
    shell(5, "Deploy", h("p", { class: "error" }, "This browser does not have the key for that installation."));
    return;
  }
  deployLogLabels = [];
  for (let attempt = 0; attempt < 200; attempt++) {
    const view = await api(`/api/installations/${id}/step`, { key: saved.key });
    deployProgressView(view.address || saved.address, view);
    if (view.status === "failed") {
      shell(
        5,
        "Deploying Dotnote",
        h("p", { class: "error" }, view.message || "The deployment stopped."),
        h("button", { onclick: () => void runDeploy(id) }, "Try again"),
        h("button", { class: "ghost", onclick: () => void removeInstall({ id }) }, "Remove this installation"),
      );
      return;
    }
    if (view.status === "ready") {
      await handoffTo(view.address || saved.address, saved.code, saved.accountId, id);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, view.retryAfterMs || 400));
  }
  shell(5, "Deploying Dotnote", h("p", { class: "hint" }, "Still working."), h("button", { onclick: () => void runDeploy(id) }, "Continue"));
}

async function hmacHex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(sig)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function installUrl(address) {
  return address.replace(/\/$/, "");
}

function installUrlBlock(address, lead) {
  const url = installUrl(address);
  return [
    lead ? h("p", { class: "lead" }, lead) : null,
    h("p", { class: "install-url" },
      h("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, url),
    ),
  ];
}

function handoffPanel(title, address, { hint, error, onRetry, extraButtons = [] } = {}) {
  shell(
    6,
    title,
    ...installUrlBlock(address, "Your Dotnote address"),
    hint ? h("p", { class: "hint" }, hint) : null,
    error ? h("p", { class: "error" }, error) : null,
    onRetry
      ? h("button", { onclick: () => void onRetry() }, "Try again")
      : null,
    ...extraButtons,
  );
}

async function waitUntilDotnote(address, code, accountId, installationId) {
  const url = installUrl(address);
  const hash = await sha256Hex(code);
  const retry = () => handoffTo(address, code, accountId, installationId);
  for (let attempt = 0; attempt < 40; attempt++) {
    shell(
      6,
      "Waiting for Dotnote",
      ...installUrlBlock(address, "Checking that Dotnote answers at"),
      h("p", { class: "hint" }, `This often takes 30–90 seconds on a new workers.dev address. (${attempt + 1} of 40)`),
      h("button", { onclick: () => void retry() }, "Try again"),
    );
    const nonce = randomHex(16);
    try {
      const res = await fetch(`${url}/api/install/prove`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nonce }),
      });
      if (res.ok) {
        const json = await res.json();
        const expected = await hmacHex(hash, nonce);
        if (json.mac && json.mac === expected) return;
      }
    } catch {
      /* The address is not answering yet. */
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("Dotnote is not answering at that address yet.");
}

async function handoffTo(address, code, accountId, installationId) {
  const url = installUrl(address);
  const retry = () => handoffTo(address, code, accountId, installationId);

  try {
    await waitUntilDotnote(address, code, accountId, installationId);
  } catch (err) {
    handoffPanel("Waiting for Dotnote", address, {
      hint: "When Dotnote responds, handoff continues automatically on Try again.",
      error: err instanceof Error ? err.message : "Dotnote is not answering yet.",
      onRetry: retry,
    });
    return false;
  }

  handoffPanel("Handing over access", address, {
    hint: "Sending Cloudflare access to your Dotnote. This step is quick once Dotnote is live.",
    onRetry: retry,
  });

  let access = sessionGet("dotnote.oauth.access");
  try {
    access = await ensureAccess();
  } catch {
    /* Refresh may still be missing; handled below. */
  }
  const refresh = sessionGet("dotnote.oauth.refresh");
  if (!refresh) {
    handoffPanel("Handing over access", address, {
      hint: "Dotnote is ready at the address above. Sign in to Cloudflare again, then try handoff.",
      error: "This browser no longer has a Cloudflare refresh token.",
      onRetry: retry,
      extraButtons: [h("button", { class: "ghost", onclick: () => void connect() }, "Connect Cloudflare again")],
    });
    return false;
  }

  const res = await fetch(`${url}/api/install/handoff`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code,
      refreshToken: refresh,
      accountId: accountId || sessionGet("dotnote.oauth.accountId"),
      scopes: sessionGet("dotnote.oauth.scope") || config.scopes.join(" "),
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    handoffPanel("Handing over access", address, {
      error: json.error || "Dotnote did not accept the permission.",
      onRetry: retry,
      extraButtons: [h("button", { class: "ghost", onclick: () => void connect() }, "Connect Cloudflare again")],
    });
    return false;
  }
  if (installationId && access) {
    const saved = installs()[installationId];
    if (saved) {
      await fetch(`/api/installations/${installationId}/complete`, {
        method: "POST",
        headers: { authorization: `Bearer ${access}`, "content-type": "application/json" },
        body: JSON.stringify({ key: saved.key }),
      }).catch(() => undefined);
    }
  }
  sessionDel("dotnote.install.current");
  forgetToken();
  shell(
    6,
    "Dotnote is ready",
    ...installUrlBlock(address, "Opening your Dotnote…"),
    h("p", { class: "hint" }, "Create your account there. Notes stay in this Cloudflare account."),
  );
  location.assign(url);
  return true;
}

async function submitReset(origin, password, confirm, errorEl) {
  errorEl.hidden = true;
  if (password.length < 8 || password.length > 128) {
    errorEl.hidden = false;
    errorEl.textContent = "Use a password of 8 to 128 characters.";
    return;
  }
  if (password !== confirm) {
    errorEl.hidden = false;
    errorEl.textContent = "Those passwords do not match.";
    return;
  }
  let access;
  try {
    access = await ensureAccess();
  } catch (err) {
    errorEl.hidden = false;
    errorEl.textContent = err instanceof Error ? err.message : "Connect Cloudflare again.";
    return;
  }
  const res = await fetch(`${origin}/api/auth/recover`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accessToken: access, password }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    errorEl.hidden = false;
    errorEl.textContent = recoverMessage(json.error);
    return;
  }
  sessionDel("dotnote.reset.instance");
  forgetToken();
  shell(
    6,
    "Password updated",
    h("p", { class: "lead" }, "Sign in on your Dotnote with the new password."),
    h("a", { class: "button", href: origin }, "Open Dotnote"),
  );
  location.assign(origin);
}

function showReset() {
  const origin = resetOrigin(sessionGet("dotnote.reset.instance") || "");
  if (!origin) {
    sessionDel("dotnote.reset.instance");
    shell(6, "Reset password", h("p", { class: "error" }, "That Dotnote address is not valid."));
    return;
  }
  const password = h("input", { type: "password", id: "reset-password", autocomplete: "new-password" });
  const confirm = h("input", { type: "password", id: "reset-confirm", autocomplete: "new-password" });
  const error = h("p", { class: "error" });
  error.hidden = true;
  const form = h(
    "form",
    { class: "stack" },
    h("p", { class: "lead" }, "Set a new password for the owner. This sends a short-lived Cloudflare token to that Dotnote so it can check the account, then discards the token."),
    h("p", { class: "hint" }, origin),
    h("label", { for: "reset-password" }, "New password"),
    password,
    h("label", { for: "reset-confirm" }, "Confirm password"),
    confirm,
    error,
    h("button", { type: "submit" }, "Update password"),
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitReset(origin, password.value, confirm.value, error);
  });
  shell(6, "Reset password", form);
}

async function showReconnect() {
  const instance = sessionGet("dotnote.reconnect.instance");
  const code = sessionGet("dotnote.reconnect.code");
  const accountId = sessionGet("dotnote.reconnect.accountId") || sessionGet("dotnote.oauth.accountId");
  shell(6, "Reconnect Cloudflare", h("p", { class: "hint" }, instance));
  const handed = await handoffTo(instance, code, accountId, null);
  if (!handed) return;
  sessionDel("dotnote.reconnect.instance");
  sessionDel("dotnote.reconnect.code");
  sessionDel("dotnote.reconnect.accountId");
}

async function boot() {
  captureEntry();
  initStepList();
  config = await fetch("/api/config").then((res) => res.json());
  setFine();
  try {
    const handled = await finishCallback();
    if (handled) return;
  } catch (err) {
    shell(0, "Sign in to Cloudflare", h("p", { class: "error" }, err instanceof Error ? err.message : "Could not finish sign-in."));
    return;
  }
  if (recovering()) {
    if (!connected()) {
      showConnectForReset();
      return;
    }
    showReset();
    return;
  }
  if (!connected()) {
    showConnect();
    return;
  }
  if (reconnecting()) {
    try {
      await showReconnect();
    } catch (err) {
      shell(6, "Reconnect Cloudflare", h("p", { class: "error" }, err instanceof Error ? err.message : "Reconnect failed."));
    }
    return;
  }
  const current = sessionGet("dotnote.install.current");
  if (current && installs()[current]) {
    shell(
      5,
      "Continue installing",
      h("p", { class: "lead" }, "This browser still has an unfinished Dotnote install."),
      h("button", { onclick: () => void resumeInstall(current) }, "Continue"),
      h("button", { class: "ghost", onclick: () => void showAccount() }, "Start another"),
    );
    return;
  }
  try {
    await showAccount();
  } catch (err) {
    shell(1, "Choose the account", h("p", { class: "error" }, err instanceof Error ? err.message : "Could not load accounts."));
  }
}

boot().catch((err) => {
  if (card) {
    shell(0, "Install Dotnote", h("p", { class: "error" }, err instanceof Error ? err.message : "The page failed to start."));
  }
});
