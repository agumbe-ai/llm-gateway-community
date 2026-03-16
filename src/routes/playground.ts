import type { FastifyInstance } from "fastify";
import type { Env, ModelPricing } from "../config/env";

type PlaygroundConfig = {
  authBaseUrl: string;
  pricing: ModelPricing;
};

function iconSvg(name: string) {
  const common = 'xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon"';

  const icons: Record<string, string> = {
    eye: `<svg ${common}><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"></path><circle cx="12" cy="12" r="3"></circle></svg>`,
    eyeOff: `<svg ${common}><path d="M10.733 5.076A10.744 10.744 0 0 1 12 5c4.596 0 8.51 2.957 9.938 7a10.717 10.717 0 0 1-1.271 2.592"></path><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"></path><path d="M17.479 17.499A10.75 10.75 0 0 1 12 19c-4.596 0-8.51-2.957-9.938-7a10.75 10.75 0 0 1 4.421-5.29"></path><path d="m2 2 20 20"></path></svg>`,
    copy: `<svg ${common}><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`,
    history: `<svg ${common}><path d="M3 3v5h5"></path><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"></path><path d="M12 7v5l4 2"></path></svg>`,
    arrowLeft: `<svg ${common}><path d="m12 19-7-7 7-7"></path><path d="M19 12H5"></path></svg>`,
    logOut: `<svg ${common}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" x2="9" y1="12" y2="12"></line></svg>`,
    user: `<svg ${common}><path d="M19 21a7 7 0 0 0-14 0"></path><circle cx="12" cy="8" r="4"></circle></svg>`,
    keyRound: `<svg ${common}><path d="M2.5 21a5.5 5.5 0 1 1 5.5-5.5L18 5.5a2.12 2.12 0 1 1 3 3L11 18.5V21H8.5v-2.5H6V16H3.5v-2.5l1.2-1.2"></path></svg>`,
    chevronDown: `<svg ${common}><path d="m6 9 6 6 6-6"></path></svg>`,
    appWindow: `<svg ${common}><rect x="2" y="4" width="20" height="16" rx="2"></rect><path d="M10 4v16"></path><path d="M2 8h20"></path></svg>`,
  };

  return icons[name] || "";
}

function createSessionCookie(token: string) {
  return `session=${Buffer.from(JSON.stringify({ jwt: token })).toString("base64")}`;
}

function getSetCookieHeaders(response: Response): string[] {
  const responseHeaders = response.headers as Headers & {
    getSetCookie?: () => string[];
  };

  if (typeof responseHeaders.getSetCookie === "function") {
    return responseHeaders.getSetCookie();
  }

  const setCookie = response.headers.get("set-cookie");
  return setCookie ? [setCookie] : [];
}

function extractJwtFromSetCookie(cookies: string[]) {
  for (const cookie of cookies) {
    const match = cookie.match(/(?:^|,\s*)session=([^;]+)/);
    if (!match) {
      continue;
    }

    try {
      const decoded = Buffer.from(decodeURIComponent(match[1]), "base64").toString("utf8");
      const session = JSON.parse(decoded) as { jwt?: unknown };
      if (typeof session.jwt === "string" && session.jwt) {
        return session.jwt;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function decodeJwtPayload(token: string) {
  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }

  try {
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function parseJsonResponse(response: Response) {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function getErrorMessage(data: any, fallback: string) {
  if (typeof data?.error?.message === "string" && data.error.message) {
    return data.error.message;
  }

  if (typeof data?.msg === "string" && data.msg) {
    return data.msg;
  }

  if (Array.isArray(data?.errors) && typeof data.errors[0]?.msg === "string") {
    return data.errors[0].msg;
  }

  return fallback;
}

function sanitizeAppForPlayground(app: Record<string, unknown> | null | undefined) {
  if (!app) {
    return null;
  }

  return {
    id: app.id ?? app._id ?? null,
    app_name: app.app_name ?? null,
    owner_user: app.owner_user ?? null,
    scope: app.scope ?? null,
    purpose: app.purpose ?? null,
    status: app.status ?? null,
    tenant_id: app.tenant_id ?? null,
  };
}

function sanitizeTokenForPlayground(token: Record<string, unknown> | null | undefined) {
  if (!token) {
    return null;
  }

  return {
    access_token: token.access_token ?? null,
    token_type: token.token_type ?? "bearer",
    expires_in: token.expires_in ?? null,
  };
}

async function callAuth(
  authBaseUrl: string,
  path: string,
  options: {
    method?: "GET" | "POST";
    body?: Record<string, unknown>;
    bearerToken?: string;
  },
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (options.bearerToken) {
    headers.Cookie = createSessionCookie(options.bearerToken);
  }

  const response = await fetch(`${authBaseUrl}${path}`, {
    method: options.method || "POST",
    headers,
    body: options.method === "GET" ? undefined : JSON.stringify(options.body || {}),
    redirect: "manual",
  });

  const data = await parseJsonResponse(response);

  if (!response.ok) {
    return {
      ok: false as const,
      status: response.status,
      data,
      cookies: getSetCookieHeaders(response),
    };
  }

  return {
    ok: true as const,
    status: response.status,
    data,
    cookies: getSetCookieHeaders(response),
  };
}

function createPlaygroundHtml(config: PlaygroundConfig) {
  const bootstrap = JSON.stringify(config).replace(/</g, "\\u003c");
  const eyeIcon = iconSvg("eye");
  const eyeOffIcon = iconSvg("eyeOff");
  const copyIcon = iconSvg("copy");
  const historyIcon = iconSvg("history");
  const keyIcon = iconSvg("keyRound");
  const logoutIcon = iconSvg("logOut");
  const chevronDownIcon = iconSvg("chevronDown");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Agumbe LLM Playground</title>
    <style>
      :root {
        --ink: #000000;
        --muted: #6f839b;
        --paper: #ffffff;
        --sky: #d9e7f5;
        --panel: rgba(255, 255, 255, 0.9);
        --line: rgba(129, 69, 255, 0.14);
        --orange: #ff6d3f;
        --purple: #8145ff;
        --blue: #00a3ff;
        --white: #ffffff;
        --shadow: 0 24px 60px rgba(129, 69, 255, 0.12);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        font-family: "Roboto", "Segoe UI", sans-serif;
        color: var(--ink);
        background:
          radial-gradient(circle at 18% 12%, rgba(255, 109, 63, 0.24), transparent 18rem),
          radial-gradient(circle at 86% 18%, rgba(0, 163, 255, 0.18), transparent 20rem),
          radial-gradient(circle at 55% 85%, rgba(129, 69, 255, 0.16), transparent 22rem),
          linear-gradient(180deg, #cfdceb 0%, #dce8f6 22%, #f7f8fc 100%);
      }

      main {
        width: min(1280px, calc(100vw - 32px));
        margin: 28px auto;
      }

      .hero {
        display: grid;
        gap: 14px;
        margin-bottom: 18px;
        padding: 18px 8px 6px;
      }

      .hero-top {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
      }

      .hero-actions {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }

      .eyebrow {
        display: inline-flex;
        width: fit-content;
        padding: 6px 12px;
        border-radius: 999px;
        background: rgba(129, 69, 255, 0.08);
        color: var(--purple);
        font-size: 12px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        border: 1px solid rgba(129, 69, 255, 0.16);
      }

      h1 {
        margin: 0;
        font-family: Georgia, "Times New Roman", serif;
        font-size: clamp(2.4rem, 4vw, 4.2rem);
        line-height: 0.95;
        max-width: 12ch;
        color: #8ea7c3;
      }

      .hero p {
        margin: 0;
        max-width: 64ch;
        color: var(--muted);
        font-size: 1rem;
      }

      .layout {
        display: grid;
        grid-template-columns: 1.05fr 0.95fr;
        gap: 18px;
      }

      .card {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 24px;
        box-shadow: var(--shadow);
        backdrop-filter: blur(16px);
      }

      .controls,
      .output {
        padding: 22px;
      }

      .output {
        display: grid;
        gap: 18px;
      }

      .section {
        margin-bottom: 18px;
      }

      .section:last-child {
        margin-bottom: 0;
      }

      .section-title {
        margin: 0 0 10px;
        font-size: 0.88rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
      }

      .grid {
        display: grid;
        gap: 12px;
      }

      .grid.cols-2 {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .grid.cols-3 {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .toolbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
      }

      .toolbar .section-title {
        margin-bottom: 0;
      }

      label {
        display: grid;
        gap: 6px;
        font-size: 0.95rem;
        color: var(--muted);
      }

      input:not([type="checkbox"]),
      select,
      textarea,
      button,
      .button-link {
        font: inherit;
      }

      input:not([type="checkbox"]),
      select,
      textarea {
        width: 100%;
        border: 1px solid rgba(129, 69, 255, 0.16);
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.92);
        padding: 12px 14px;
        color: var(--ink);
        outline: none;
        transition: border-color 140ms ease, box-shadow 140ms ease;
      }

      input:focus,
      select:focus,
      textarea:focus {
        border-color: rgba(0, 163, 255, 0.65);
        box-shadow: 0 0 0 4px rgba(0, 163, 255, 0.12);
      }

      textarea {
        min-height: 130px;
        resize: vertical;
      }

      .token {
        min-height: 92px;
      }

      .compact {
        min-height: 90px;
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }

      .menu-shell {
        position: relative;
      }

      .menu-panel {
        position: absolute;
        top: calc(100% + 10px);
        right: 0;
        width: min(320px, calc(100vw - 40px));
        padding: 12px;
        border-radius: 22px;
        border: 1px solid rgba(129, 69, 255, 0.14);
        background: rgba(255, 255, 255, 0.96);
        box-shadow: var(--shadow);
        display: grid;
        gap: 10px;
        z-index: 20;
      }

      .menu-card {
        display: grid;
        gap: 8px;
        padding: 12px 14px;
        border-radius: 18px;
        background: rgba(217, 231, 245, 0.36);
      }

      .menu-meta {
        display: grid;
        gap: 4px;
      }

      .menu-item {
        width: 100%;
      }

      .field-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
      }

      .auth-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 12px;
      }

      .preset-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
      }

      button,
      .button-link {
        border: 1px solid rgba(129, 69, 255, 0.14);
        border-radius: 999px;
        padding: 12px 18px;
        cursor: pointer;
        transition: transform 120ms ease, opacity 120ms ease, box-shadow 120ms ease;
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
      }

      .icon {
        flex: 0 0 auto;
      }

      .button-text {
        display: inline-flex;
        align-items: center;
      }

      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        border: 0;
      }

      button:hover,
      .button-link:hover {
        transform: translateY(-1px);
      }

      button:disabled {
        cursor: wait;
        opacity: 0.65;
      }

      .primary {
        background: var(--orange);
        color: var(--white);
        box-shadow: 0 14px 24px rgba(255, 109, 63, 0.18);
      }

      .secondary {
        background: rgba(0, 163, 255, 0.08);
        color: var(--ink);
      }

      .ghost {
        background: rgba(255, 255, 255, 0.85);
        color: var(--purple);
      }

      .accent {
        background: rgba(129, 69, 255, 0.1);
        color: var(--purple);
      }

      .identity,
      .token-result,
      .usage-card,
      .recent-item {
        border-radius: 20px;
        border: 1px solid rgba(129, 69, 255, 0.14);
        background: rgba(255, 255, 255, 0.78);
        padding: 16px;
      }

      .identity strong,
      .token-result strong,
      .usage-card strong {
        display: block;
        margin-bottom: 6px;
      }

      .identity-meta,
      .usage-grid,
      .recent-meta {
        display: grid;
        gap: 8px;
      }

      .usage-grid,
      .recent-meta {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .usage-stat,
      .recent-stat {
        display: grid;
        gap: 4px;
        padding: 10px 12px;
        border-radius: 16px;
        background: rgba(217, 231, 245, 0.44);
      }

      .stat-label {
        color: var(--muted);
        font-size: 0.83rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }

      .stat-value {
        font-size: 1rem;
      }

      .hint,
      .mini-hint {
        color: var(--muted);
      }

      .hint {
        font-size: 0.9rem;
      }

      .mini-hint {
        font-size: 0.82rem;
      }

      .icon-button {
        min-width: 44px;
        min-height: 44px;
        padding: 10px 14px;
      }

      .token.masked {
        -webkit-text-security: disc;
      }

      .assistant {
        border-radius: 20px;
        padding: 18px;
        background: rgba(255, 255, 255, 0.86);
        border: 1px solid rgba(129, 69, 255, 0.14);
        min-height: 148px;
        white-space: pre-wrap;
        line-height: 1.55;
      }

      .assistant.empty {
        color: var(--muted);
      }

      pre {
        margin: 0;
        padding: 18px;
        border-radius: 20px;
        background: linear-gradient(180deg, rgba(0, 0, 0, 0.96), rgba(16, 18, 28, 0.98));
        color: #f4f7ff;
        overflow: auto;
        min-height: 260px;
        font-size: 0.92rem;
        line-height: 1.5;
        border: 1px solid rgba(255, 255, 255, 0.08);
      }

      .status {
        min-height: 24px;
        font-size: 0.95rem;
        color: var(--muted);
      }

      .pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 6px 10px;
        border-radius: 999px;
        font-size: 0.82rem;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        background: rgba(0, 163, 255, 0.1);
        color: var(--blue);
      }

      .recent-list {
        display: grid;
        gap: 12px;
      }

      .recent-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
        margin-bottom: 10px;
      }

      .recent-item-title {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 12px;
        margin-bottom: 10px;
      }

      .recent-item-title strong {
        margin: 0;
      }

      .recent-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 12px;
      }

      .toast-stack {
        position: fixed;
        top: 18px;
        right: 18px;
        display: grid;
        gap: 10px;
        z-index: 50;
      }

      .toast {
        min-width: 240px;
        max-width: min(420px, calc(100vw - 36px));
        padding: 14px 16px;
        border-radius: 18px;
        border: 1px solid rgba(129, 69, 255, 0.16);
        background: rgba(255, 255, 255, 0.96);
        box-shadow: var(--shadow);
      }

      .toast.success {
        border-color: rgba(0, 163, 255, 0.24);
      }

      .toast.error {
        border-color: rgba(255, 109, 63, 0.28);
      }

      @media (max-width: 920px) {
        .layout,
        .grid.cols-2,
        .grid.cols-3,
        .preset-grid,
        .usage-grid,
        .recent-meta {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <div id="toastStack" class="toast-stack" aria-live="polite" aria-atomic="true"></div>
    <main>
      <section class="hero">
        <div class="hero-top">
          <span class="eyebrow">Agumbe Playground</span>
          <div class="hero-actions">
            <a class="ghost button-link" href="/playground/auth">${keyIcon}<span class="button-text">Open Sign In & Tokens</span></a>
            <div id="accountMenuShell" class="menu-shell hidden">
              <button id="accountMenuButton" class="secondary" type="button"><span class="button-text">Account</span>${chevronDownIcon}</button>
              <div id="accountMenuPanel" class="menu-panel hidden">
                <div id="accountMenuCard" class="menu-card"></div>
                <button id="logoutButton" class="secondary menu-item" type="button">${logoutIcon}<span class="button-text">Log Out</span></button>
              </div>
            </div>
          </div>
        </div>
        <h1>Sits between applications and AI models.</h1>
        <p>
          Sits between applications and AI models (OpenAI, Anthropic, Gemini, etc.), providing a unified
          interface for routing, authentication, governance and cost management.
        </p>
      </section>

      <section class="layout">
        <section class="card controls">
          <div class="section">
            <p class="section-title">Example Presets</p>
            <div class="preset-grid">
              <button class="ghost" type="button" data-preset="quick-chat">Quick Chat</button>
              <button class="ghost" type="button" data-preset="reasoning-chat">Reasoning</button>
              <button class="ghost" type="button" data-preset="embeddings">Embeddings</button>
              <button class="ghost" type="button" data-preset="anthropic-chat">Anthropic</button>
            </div>
          </div>

          <div class="section">
            <p class="section-title">Connection</p>
            <div id="identity" class="identity" style="margin-bottom: 12px;">
              <strong>No active session yet.</strong>
              <div class="identity-meta">
                <span class="mini-hint">Open Sign In & Tokens to sign in, use Google OAuth, or mint an app token. The active token will appear here automatically.</span>
              </div>
            </div>
            <div class="grid">
              <label>
                <span class="field-header">
                  <span>Active Bearer Token</span>
                  <button id="toggleTokenVisibility" class="ghost icon-button" type="button" aria-label="Show token" title="Show token">${eyeIcon}<span class="sr-only">Show token</span></button>
                </span>
                <textarea id="token" class="token masked" placeholder="Paste a JWT or generated app token here"></textarea>
              </label>
              <p class="hint">Session JWTs and app tokens are stored only in this browser session. Recent requests are stored locally without credentials.</p>
            </div>
          </div>

          <div class="section">
            <p class="section-title">Request</p>
            <div class="grid cols-2">
              <label>
                Mode
                <select id="mode">
                  <option value="chat">Chat Completions</option>
                  <option value="embeddings">Embeddings</option>
                </select>
              </label>
              <label>
                Model
                <select id="model">
                  <option value="cheap-fast">cheap-fast</option>
                </select>
              </label>
            </div>
          </div>

          <div class="section" id="chat-section">
            <p class="section-title">Chat Prompt</p>
            <div class="grid">
              <label>
                System Message
                <textarea id="systemPrompt" placeholder="You are helpful.">You are helpful.</textarea>
              </label>
              <label>
                User Message
                <textarea id="userPrompt" placeholder="Say hello in one short sentence.">Say hello in one short sentence.</textarea>
              </label>
            </div>
          </div>

          <div class="section" id="embeddings-section" hidden>
            <p class="section-title">Embeddings Input</p>
            <div class="grid">
              <label>
                One item per line
                <textarea id="embeddingInput" placeholder="What is GitOps?&#10;How does Argo CD work?">What is GitOps?
How does Argo CD work?</textarea>
              </label>
            </div>
          </div>

          <div class="section">
            <p class="section-title">Actions</p>
            <div class="actions">
              <button id="loadModels" class="secondary" type="button">Load Models</button>
              <button id="runRequest" class="primary" type="button">Send Request</button>
              <button id="clearOutput" class="secondary" type="button">Clear Output</button>
            </div>
          </div>
        </section>

        <section class="card output">
          <div>
            <div class="toolbar">
              <p class="section-title">Assistant Preview</p>
              <button id="copyAssistant" class="ghost" type="button">${copyIcon}<span class="button-text">Copy Response</span></button>
            </div>
            <div id="assistant" class="assistant empty">Run a chat request to see the assistant response here.</div>
          </div>

          <div>
            <div class="recent-header">
              <p class="section-title">Run Summary</p>
              <span class="pill" id="usageMode">No request yet</span>
            </div>
            <div id="usageCard" class="usage-card">
              <strong>Usage and cost will appear here after a request.</strong>
              <div class="mini-hint">Costs are estimated from the deployed price map, not final billing.</div>
            </div>
          </div>

          <div>
            <p class="section-title">Status</p>
            <div id="status" class="status">Ready.</div>
          </div>

          <div>
            <div class="recent-header">
              <p class="section-title">Recent Requests</p>
              <button id="clearHistory" class="ghost" type="button">${historyIcon}<span class="button-text">Clear History</span></button>
            </div>
            <div id="recentRequests" class="recent-list">
              <div class="recent-item">
                <strong>No recent requests yet.</strong>
                <div class="mini-hint">Successful and failed runs will be stored locally so you can restore the request shape.</div>
              </div>
            </div>
          </div>

          <div>
            <p class="section-title">Raw JSON</p>
            <pre id="jsonOutput">{}</pre>
          </div>
        </section>
      </section>
    </main>

    <script>
      const config = ${bootstrap};
      const icons = {
        eye: ${JSON.stringify(eyeIcon)},
        eyeOff: ${JSON.stringify(eyeOffIcon)}
      };
      const storageKeys = {
        activeToken: "agumbe-llm-playground-token",
        sessionJwt: "agumbe-llm-playground-session-jwt",
        recentRequests: "agumbe-llm-playground-recent-requests",
        latestAppToken: "agumbe-llm-playground-app-token",
        latestAppBundle: "agumbe-llm-playground-app-bundle"
      };

      const tokenInput = document.getElementById("token");
      const toggleTokenVisibilityButton = document.getElementById("toggleTokenVisibility");
      const modeInput = document.getElementById("mode");
      const modelInput = document.getElementById("model");
      const systemPromptInput = document.getElementById("systemPrompt");
      const userPromptInput = document.getElementById("userPrompt");
      const embeddingInput = document.getElementById("embeddingInput");
      const presetButtons = Array.from(document.querySelectorAll("[data-preset]"));
      const chatSection = document.getElementById("chat-section");
      const embeddingsSection = document.getElementById("embeddings-section");
      const assistant = document.getElementById("assistant");
      const status = document.getElementById("status");
      const jsonOutput = document.getElementById("jsonOutput");
      const identity = document.getElementById("identity");
      const usageCard = document.getElementById("usageCard");
      const usageMode = document.getElementById("usageMode");
      const recentRequests = document.getElementById("recentRequests");
      const copyAssistantButton = document.getElementById("copyAssistant");
      const loadModelsButton = document.getElementById("loadModels");
      const runRequestButton = document.getElementById("runRequest");
      const clearOutputButton = document.getElementById("clearOutput");
      const clearHistoryButton = document.getElementById("clearHistory");
      const accountMenuShell = document.getElementById("accountMenuShell");
      const accountMenuButton = document.getElementById("accountMenuButton");
      const accountMenuPanel = document.getElementById("accountMenuPanel");
      const accountMenuCard = document.getElementById("accountMenuCard");
      const logoutButton = document.getElementById("logoutButton");
      const toastStack = document.getElementById("toastStack");

      const state = {
        sessionJwt: sessionStorage.getItem(storageKeys.sessionJwt) || "",
        latestAppToken: sessionStorage.getItem(storageKeys.latestAppToken) || "",
        latestAppBundle: null,
        recentRequests: [],
      };

      try {
        state.latestAppBundle = JSON.parse(sessionStorage.getItem(storageKeys.latestAppBundle) || "null");
      } catch {
        state.latestAppBundle = null;
      }

      try {
        state.recentRequests = JSON.parse(localStorage.getItem(storageKeys.recentRequests) || "[]");
      } catch {
        state.recentRequests = [];
      }

      tokenInput.value = sessionStorage.getItem(storageKeys.activeToken) || state.sessionJwt || state.latestAppToken || "";

      function escapeHtml(value) {
        return String(value || "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");
      }

      function decodeJwt(token) {
        const parts = token.split(".");
        if (parts.length < 2) {
          return null;
        }

        try {
          const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
          const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
          return JSON.parse(atob(padded));
        } catch {
          return null;
        }
      }

      function setStatus(message) {
        status.textContent = message;
      }

      function showToast(message, tone) {
        const toast = document.createElement("div");
        toast.className = "toast " + (tone || "success");
        toast.textContent = message;
        toastStack.appendChild(toast);
        window.setTimeout(() => {
          toast.remove();
        }, 2600);
      }

      function sanitizeForDisplay(value) {
        if (Array.isArray(value)) {
          return value.map((entry) => sanitizeForDisplay(entry));
        }

        if (!value || typeof value !== "object") {
          return value;
        }

        const sensitiveKeys = new Set([
          "token",
          "access_token",
          "refresh_token",
          "secret_jwt",
          "client_secret",
          "authorization",
          "cookie",
          "set-cookie",
        ]);

        const result = {};
        Object.entries(value).forEach(([key, entry]) => {
          if (sensitiveKeys.has(key.toLowerCase())) {
            if (key.toLowerCase() === "token" && entry && typeof entry === "object" && !Array.isArray(entry)) {
              result[key] = sanitizeForDisplay(entry);
            } else {
              result[key] = "[redacted]";
            }
            return;
          }

          result[key] = sanitizeForDisplay(entry);
        });

        return result;
      }

      function setJson(value) {
        jsonOutput.textContent = JSON.stringify(sanitizeForDisplay(value), null, 2);
      }

      function setAssistantPreview(value) {
        assistant.textContent = value || "No assistant preview available for this response.";
        assistant.classList.toggle("empty", !value);
      }

      function persistActiveToken() {
        sessionStorage.setItem(storageKeys.activeToken, tokenInput.value.trim());
      }

      function initialsFromClaims(claims) {
        const first = typeof claims?.first_name === "string" ? claims.first_name.trim() : "";
        const last = typeof claims?.last_name === "string" ? claims.last_name.trim() : "";
        if (first || last) {
          return (first.slice(0, 1) + last.slice(0, 1)).toUpperCase() || "AG";
        }

        const email = typeof claims?.email === "string" ? claims.email.trim() : "";
        if (email) {
          return email.slice(0, 2).toUpperCase();
        }

        const id = typeof claims?.id === "string" ? claims.id : typeof claims?.sub === "string" ? claims.sub : "AG";
        return id.slice(0, 2).toUpperCase();
      }

      function closeAccountMenu() {
        accountMenuPanel.classList.add("hidden");
      }

      function clearCredentials() {
        sessionStorage.removeItem(storageKeys.activeToken);
        sessionStorage.removeItem(storageKeys.sessionJwt);
        sessionStorage.removeItem(storageKeys.latestAppToken);
        sessionStorage.removeItem(storageKeys.latestAppBundle);
        state.sessionJwt = "";
        state.latestAppToken = "";
        state.latestAppBundle = null;
        tokenInput.value = "";
        closeAccountMenu();
        renderIdentity(null, "");
      }

      function renderIdentity(claims, sourceLabel) {
        if (!claims) {
          accountMenuShell.classList.add("hidden");
          identity.innerHTML = '<strong>No active session yet.</strong><div class="identity-meta"><span class="mini-hint">Sign in, sign up, or use Google OAuth to mint a JWT through the existing auth service and reuse it in the playground.</span></div>';
          return;
        }

        accountMenuShell.classList.remove("hidden");
        accountMenuButton.innerHTML = '<span class="button-text">' + escapeHtml(initialsFromClaims(claims)) + '</span>' + ${JSON.stringify(chevronDownIcon)};
        accountMenuCard.innerHTML = [
          '<strong>' + escapeHtml(claims.email || claims.owner_user || claims.client_key || "Signed in") + '</strong>',
          '<div class="menu-meta">',
          '<span class="mini-hint">Source: ' + escapeHtml(sourceLabel) + '</span>',
          '<span class="mini-hint">Tenant: ' + escapeHtml(claims.tenant_id || claims.tenantId || "n/a") + '</span>',
          '</div>'
        ].join("");
        identity.innerHTML = [
          '<strong>' + escapeHtml(claims.email || claims.owner_user || claims.client_key || "Signed in") + '</strong>',
          '<div class="identity-meta">',
          '<span><span class="stat-label">Source</span><br />' + escapeHtml(sourceLabel) + '</span>',
          '<span><span class="stat-label">Tenant</span><br />' + escapeHtml(claims.tenant_id || claims.tenantId || "n/a") + '</span>',
          '<span><span class="stat-label">User ID / JWT Subject</span><br />' + escapeHtml(claims.id || claims.sub || claims.client_key || "n/a") + '</span>',
          '</div>'
        ].join("");
      }

      function formatUsd(amount) {
        if (!Number.isFinite(amount)) {
          return "$0.000000";
        }

        return "$" + Number(amount).toFixed(6);
      }

      function estimateCost(modelId, usage) {
        if (!usage || !modelId) {
          return 0;
        }

        const price = config.pricing[modelId];
        if (!price) {
          return 0;
        }

        const promptTokens = Number(usage.prompt_tokens || 0);
        const completionTokens = Number(usage.completion_tokens || 0);
        const estimated =
          (promptTokens / 1000) * Number(price.promptPer1kUsd || 0) +
          (completionTokens / 1000) * Number(price.completionPer1kUsd || 0);

        return Number(estimated.toFixed(8));
      }

      function renderUsage(summary) {
        if (!summary) {
          usageMode.textContent = "No request yet";
          usageCard.innerHTML = '<strong>Usage and cost will appear here after a request.</strong><div class="mini-hint">Costs are estimated from the deployed price map, not final billing.</div>';
          return;
        }

        usageMode.textContent = summary.status === "success" ? "Success" : "Error";
        usageCard.innerHTML = [
          '<strong>' + escapeHtml(summary.modelLabel) + '</strong>',
          '<div class="usage-grid">',
          '<div class="usage-stat"><span class="stat-label">Prompt Tokens</span><span class="stat-value">' + escapeHtml(summary.promptTokens) + '</span></div>',
          '<div class="usage-stat"><span class="stat-label">Completion Tokens</span><span class="stat-value">' + escapeHtml(summary.completionTokens) + '</span></div>',
          '<div class="usage-stat"><span class="stat-label">Total Tokens</span><span class="stat-value">' + escapeHtml(summary.totalTokens) + '</span></div>',
          '<div class="usage-stat"><span class="stat-label">Estimated Cost</span><span class="stat-value">' + escapeHtml(formatUsd(summary.estimatedCost)) + '</span></div>',
          '</div>',
          '<div class="mini-hint" style="margin-top: 10px;">' + escapeHtml(summary.message) + '</div>'
        ].join("");
      }

      function getRecentLabel(item) {
        return item.mode === "chat" ? (item.userPrompt || "Chat request") : "Embeddings request";
      }

      function renderRecentRequests() {
        if (!state.recentRequests.length) {
          recentRequests.innerHTML = '<div class="recent-item"><strong>No recent requests yet.</strong><div class="mini-hint">Successful and failed runs will be stored locally so you can restore the request shape.</div></div>';
          return;
        }

        recentRequests.innerHTML = state.recentRequests.map((item, index) => {
          return [
            '<div class="recent-item">',
            '<div class="recent-item-title">',
            '<strong>' + escapeHtml(getRecentLabel(item)) + '</strong>',
            '<span class="mini-hint">' + escapeHtml(new Date(item.timestamp).toLocaleString()) + '</span>',
            '</div>',
            '<div class="recent-meta">',
            '<div class="recent-stat"><span class="stat-label">Mode</span><span class="stat-value">' + escapeHtml(item.mode) + '</span></div>',
            '<div class="recent-stat"><span class="stat-label">Model</span><span class="stat-value">' + escapeHtml(item.model) + '</span></div>',
            '<div class="recent-stat"><span class="stat-label">Tokens</span><span class="stat-value">' + escapeHtml(item.totalTokens || 0) + '</span></div>',
            '<div class="recent-stat"><span class="stat-label">Cost</span><span class="stat-value">' + escapeHtml(formatUsd(item.estimatedCost || 0)) + '</span></div>',
            '</div>',
            '<div class="recent-actions">',
            '<button class="ghost" type="button" data-restore-index="' + index + '">Restore Request</button>',
            '</div>',
            '</div>'
          ].join("");
        }).join("");

        Array.from(document.querySelectorAll("[data-restore-index]")).forEach((button) => {
          button.addEventListener("click", () => {
            const index = Number(button.getAttribute("data-restore-index"));
            const item = state.recentRequests[index];
            if (!item) {
              return;
            }

            modeInput.value = item.mode;
            syncMode();
            modelInput.value = item.model;
            systemPromptInput.value = item.systemPrompt || "";
            userPromptInput.value = item.userPrompt || "";
            embeddingInput.value = item.embeddingInput || "";
            setStatus("Request restored from recent history.");
          });
        });
      }

      function saveRecentRequest(entry) {
        state.recentRequests = [entry].concat(state.recentRequests).slice(0, 8);
        localStorage.setItem(storageKeys.recentRequests, JSON.stringify(state.recentRequests));
        renderRecentRequests();
      }

      function replaceModelOptions(models, fallback) {
        const previous = modelInput.value;
        const options = Array.from(new Set(models));
        modelInput.innerHTML = "";

        options.forEach((model) => {
          const option = document.createElement("option");
          option.value = model;
          option.textContent = model;
          modelInput.appendChild(option);
        });

        const nextValue = options.includes(previous)
          ? previous
          : options.includes(fallback)
            ? fallback
            : options[0];

        if (nextValue) {
          modelInput.value = nextValue;
        }
      }

      function syncMode() {
        const mode = modeInput.value;
        const isChat = mode === "chat";
        chatSection.hidden = !isChat;
        embeddingsSection.hidden = isChat;
        const fallback = isChat ? "cheap-fast" : "embed-default";
        if (!Array.from(modelInput.options).some((option) => option.value === modelInput.value)) {
          modelInput.innerHTML = "";
          const option = document.createElement("option");
          option.value = fallback;
          option.textContent = fallback;
          modelInput.appendChild(option);
        }
        modelInput.value = fallback;
        setAssistantPreview(
          isChat
            ? "Run a chat request to see the assistant response here."
            : "Embeddings responses are shown in raw JSON."
        );
      }

      async function callApi(path, payload, requiresAuth, overrideToken) {
        const token = (overrideToken || tokenInput.value).trim();
        if (requiresAuth && !token) {
          throw new Error("Provide a Bearer token before sending a protected request.");
        }

        if (!overrideToken) {
          sessionStorage.setItem(storageKeys.activeToken, token);
        }

        const response = await fetch(path, {
          method: payload ? "POST" : "GET",
          headers: {
            ...(payload ? { "Content-Type": "application/json" } : {}),
            ...(token ? { Authorization: "Bearer " + token } : {}),
          },
          body: payload ? JSON.stringify(payload) : undefined,
        });

        const text = await response.text();
        let data = {};
        if (text) {
          try {
            data = JSON.parse(text);
          } catch {
            data = {
              error: {
                message: text.includes("<html") || text.includes("<!doctype")
                  ? "The gateway returned HTML instead of JSON. This usually means the ingress route is missing or the upstream returned a non-API error page."
                  : text,
              },
            };
          }
        }

        if (!response.ok) {
          const message = data && data.error && data.error.message
            ? data.error.message
            : "Request failed";
          throw new Error(message);
        }

        return data;
      }

      function applyPreset(name) {
        if (name === "quick-chat") {
          modeInput.value = "chat";
          syncMode();
          modelInput.value = "cheap-fast";
          systemPromptInput.value = "You are helpful.";
          userPromptInput.value = "Say hello in one short sentence.";
          return;
        }

        if (name === "reasoning-chat") {
          modeInput.value = "chat";
          syncMode();
          modelInput.value = "reasoning";
          systemPromptInput.value = "You are a precise technical assistant.";
          userPromptInput.value = "Compare Kubernetes namespaces and tenants in a short table.";
          return;
        }

        if (name === "anthropic-chat") {
          modeInput.value = "chat";
          syncMode();
          if (Array.from(modelInput.options).some((option) => option.value === "@anthropic/claude-sonnet-4")) {
            modelInput.value = "@anthropic/claude-sonnet-4";
          } else {
            modelInput.value = "reasoning";
          }
          systemPromptInput.value = "You are helpful.";
          userPromptInput.value = "Reply with exactly: anthro-ok";
          return;
        }

        modeInput.value = "embeddings";
        syncMode();
        modelInput.value = "embed-default";
        embeddingInput.value = "What is GitOps?\\nHow does Argo CD work?";
      }

      function buildRequestSnapshot() {
        return {
          mode: modeInput.value,
          model: modelInput.value.trim(),
          systemPrompt: systemPromptInput.value,
          userPrompt: userPromptInput.value,
          embeddingInput: embeddingInput.value,
        };
      }

      function summarizeRun(mode, requestModel, data, statusLabel, message) {
        const usage = data && data.usage ? data.usage : {};
        const modelLabel = data && data.model ? data.model : requestModel;
        return {
          status: statusLabel,
          modelLabel,
          promptTokens: Number(usage.prompt_tokens || 0),
          completionTokens: Number(usage.completion_tokens || 0),
          totalTokens: Number(usage.total_tokens || usage.prompt_tokens || 0),
          estimatedCost: estimateCost(modelLabel, usage),
          message,
        };
      }

      loadModelsButton.addEventListener("click", async () => {
        loadModelsButton.disabled = true;
        setStatus("Loading model catalog...");
        try {
          const data = await callApi("/api/v1/llm/models", null, false);
          const mode = modeInput.value;
          const models = (data.data || [])
            .filter((entry) => entry.kind === (mode === "chat" ? "chat" : "embeddings"))
            .map((entry) => entry.id);
          replaceModelOptions(models, mode === "chat" ? "cheap-fast" : "embed-default");
          setJson(data);
          setAssistantPreview("Model catalog loaded.");
          setStatus("Model catalog loaded.");
        } catch (error) {
          setStatus(error.message);
          setJson({ error: { message: error.message } });
        } finally {
          loadModelsButton.disabled = false;
        }
      });

      runRequestButton.addEventListener("click", async () => {
        runRequestButton.disabled = true;
        const snapshot = buildRequestSnapshot();
        setStatus("Sending request...");
        try {
          const mode = snapshot.mode;
          const model = snapshot.model;

          const data = mode === "chat"
            ? await callApi("/api/v1/llm/chat/completions", {
                model,
                messages: [
                  ...(snapshot.systemPrompt.trim()
                    ? [{ role: "system", content: snapshot.systemPrompt.trim() }]
                    : []),
                  { role: "user", content: snapshot.userPrompt.trim() },
                ],
                max_tokens: 300,
                temperature: 0.7,
              }, true)
            : await callApi("/api/v1/llm/embeddings", {
                model,
                input: snapshot.embeddingInput
                  .split("\\n")
                  .map((line) => line.trim())
                  .filter(Boolean),
              }, true);

          setJson(data);

          if (mode === "chat") {
            const content = data &&
              data.choices &&
              data.choices[0] &&
              data.choices[0].message &&
              data.choices[0].message.content;
            setAssistantPreview(content || "No assistant content returned.");
          } else {
            setAssistantPreview("Embeddings request completed. Inspect the raw JSON for vectors and usage.");
          }

          const summary = summarizeRun(mode, model, data, "success", "Request completed successfully.");
          renderUsage(summary);
          saveRecentRequest({
            timestamp: new Date().toISOString(),
            mode,
            model,
            systemPrompt: snapshot.systemPrompt,
            userPrompt: snapshot.userPrompt,
            embeddingInput: snapshot.embeddingInput,
            totalTokens: summary.totalTokens,
            estimatedCost: summary.estimatedCost,
          });
          setStatus("Request completed successfully.");
        } catch (error) {
          setAssistantPreview("Request failed.");
          const summary = summarizeRun(snapshot.mode, snapshot.model, {}, "error", error.message);
          renderUsage(summary);
          setStatus(error.message);
          setJson({ error: { message: error.message } });
          saveRecentRequest({
            timestamp: new Date().toISOString(),
            mode: snapshot.mode,
            model: snapshot.model,
            systemPrompt: snapshot.systemPrompt,
            userPrompt: snapshot.userPrompt,
            embeddingInput: snapshot.embeddingInput,
            totalTokens: 0,
            estimatedCost: 0,
          });
        } finally {
          runRequestButton.disabled = false;
        }
      });

      copyAssistantButton.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(assistant.textContent || "");
          setStatus("Assistant response copied to clipboard.");
          showToast("Assistant response copied.", "success");
        } catch {
          setStatus("Clipboard copy failed.");
          showToast("Clipboard copy failed.", "error");
        }
      });

      clearOutputButton.addEventListener("click", () => {
        setAssistantPreview(modeInput.value === "chat"
          ? "Run a chat request to see the assistant response here."
          : "Embeddings responses are shown in raw JSON.");
        renderUsage(null);
        setJson({});
        setStatus("Output cleared.");
      });

      clearHistoryButton.addEventListener("click", () => {
        state.recentRequests = [];
        localStorage.removeItem(storageKeys.recentRequests);
        renderRecentRequests();
        setStatus("Recent request history cleared.");
        showToast("Recent request history cleared.", "success");
      });

      presetButtons.forEach((button) => {
        button.addEventListener("click", () => applyPreset(button.dataset.preset));
      });

      modeInput.addEventListener("change", () => {
        syncMode();
      });

      tokenInput.addEventListener("input", () => {
        persistActiveToken();
      });

      logoutButton.addEventListener("click", () => {
        clearCredentials();
        setStatus("Logged out from this browser session.");
        showToast("Logged out from this browser session.", "success");
      });

      accountMenuButton.addEventListener("click", (event) => {
        event.stopPropagation();
        const isOpen = !accountMenuPanel.classList.contains("hidden");
        if (isOpen) {
          closeAccountMenu();
          return;
        }
        accountMenuPanel.classList.remove("hidden");
      });

      accountMenuPanel.addEventListener("click", (event) => {
        event.stopPropagation();
      });

      document.addEventListener("pointerdown", (event) => {
        if (!accountMenuPanel.classList.contains("hidden") && !accountMenuShell.contains(event.target)) {
          closeAccountMenu();
        }
      });

      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          closeAccountMenu();
        }
      });

      toggleTokenVisibilityButton.addEventListener("click", () => {
        const isMasked = tokenInput.classList.toggle("masked");
        toggleTokenVisibilityButton.innerHTML = (isMasked ? icons.eye : icons.eyeOff) + '<span class="sr-only">' + (isMasked ? "Show token" : "Hide token") + '</span>';
        toggleTokenVisibilityButton.setAttribute("aria-label", isMasked ? "Show token" : "Hide token");
        toggleTokenVisibilityButton.setAttribute("title", isMasked ? "Show token" : "Hide token");
      });

      if (state.sessionJwt) {
        renderIdentity(decodeJwt(state.sessionJwt), "Session JWT");
      }

      renderRecentRequests();
      renderUsage(null);
      syncMode();
    </script>
  </body>
</html>`;
}

function createPlaygroundAuthHtml(config: PlaygroundConfig) {
  const bootstrap = JSON.stringify(config).replace(/</g, "\\u003c");
  const arrowLeftIcon = iconSvg("arrowLeft");
  const logoutIcon = iconSvg("logOut");
  const userIcon = iconSvg("user");
  const keyIcon = iconSvg("keyRound");
  const chevronDownIcon = iconSvg("chevronDown");
  const appWindowIcon = iconSvg("appWindow");
  const checkIcon = iconSvg("check");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Agumbe Playground Auth</title>
    <style>
      :root {
        --ink: #000000;
        --muted: #6f839b;
        --panel: rgba(255, 255, 255, 0.9);
        --line: rgba(129, 69, 255, 0.14);
        --orange: #ff6d3f;
        --purple: #8145ff;
        --blue: #00a3ff;
        --white: #ffffff;
        --shadow: 0 24px 60px rgba(129, 69, 255, 0.12);
      }

      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: "Roboto", "Segoe UI", sans-serif;
        color: var(--ink);
        background:
          radial-gradient(circle at 18% 12%, rgba(255, 109, 63, 0.24), transparent 18rem),
          radial-gradient(circle at 86% 18%, rgba(0, 163, 255, 0.18), transparent 20rem),
          radial-gradient(circle at 55% 85%, rgba(129, 69, 255, 0.16), transparent 22rem),
          linear-gradient(180deg, #cfdceb 0%, #dce8f6 22%, #f7f8fc 100%);
      }
      main { width: min(980px, calc(100vw - 32px)); margin: 28px auto; }
      .hero { display: grid; gap: 14px; margin-bottom: 18px; padding: 18px 8px 6px; }
      .hero-top { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; }
      .hero-actions { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
      .eyebrow {
        display:inline-flex; padding:6px 12px; border-radius:999px; background:rgba(129,69,255,0.08);
        color:var(--purple); font-size:12px; letter-spacing:0.14em; text-transform:uppercase;
        border:1px solid rgba(129,69,255,0.16);
      }
      h1 { margin:0; font-family: Georgia, "Times New Roman", serif; font-size: clamp(2rem, 4vw, 3.2rem); line-height:1; color:#8ea7c3; max-width:14ch; }
      p { margin:0; color:var(--muted); }
      .card { background: var(--panel); border:1px solid var(--line); border-radius:24px; box-shadow: var(--shadow); backdrop-filter: blur(16px); padding:22px; }
      .section { margin-bottom:18px; }
      .section:last-child { margin-bottom:0; }
      .section-title { margin:0 0 10px; font-size:0.88rem; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:var(--muted); }
      .step-copy { margin: 0 0 12px; color: var(--muted); font-size: 0.95rem; }
      .grid { display:grid; gap:12px; }
      .grid.cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .grid.cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      label { display:grid; gap:6px; font-size:0.95rem; color:var(--muted); }
      input:not([type="checkbox"]), textarea, button, .button-link { font: inherit; }
      input:not([type="checkbox"]), textarea {
        width:100%; border:1px solid rgba(129,69,255,0.16); border-radius:16px; background:rgba(255,255,255,0.92);
        padding:12px 14px; color:var(--ink); outline:none;
      }
      input:focus, textarea:focus { border-color: rgba(0,163,255,0.65); box-shadow: 0 0 0 4px rgba(0,163,255,0.12); }
      button,
      .button-link {
        border:1px solid rgba(129,69,255,0.14); border-radius:999px; padding:12px 18px; cursor:pointer;
        transition: transform 120ms ease, opacity 120ms ease, box-shadow 120ms ease;
        text-decoration:none; display:inline-flex; align-items:center; justify-content:center; gap:8px;
      }
      .icon { flex: 0 0 auto; }
      .button-text { display:inline-flex; align-items:center; }
      .sr-only {
        position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); border:0;
      }
      button:hover, .button-link:hover { transform: translateY(-1px); }
      button:disabled { cursor:wait; opacity:0.65; }
      .primary { background: var(--orange); color: var(--white); box-shadow: 0 14px 24px rgba(255,109,63,0.18); }
      .secondary { background: rgba(0,163,255,0.08); color: var(--ink); }
      .ghost { background: rgba(255,255,255,0.85); color: var(--purple); }
      .accent { background: rgba(129,69,255,0.1); color: var(--purple); }
      .actions { display:flex; flex-wrap:wrap; gap:10px; margin-top:12px; }
      .menu-shell { position: relative; }
      .menu-panel {
        position: absolute;
        top: calc(100% + 10px);
        right: 0;
        width: min(320px, calc(100vw - 40px));
        padding: 12px;
        border-radius: 22px;
        border: 1px solid rgba(129,69,255,0.14);
        background: rgba(255,255,255,0.96);
        box-shadow: var(--shadow);
        display: grid;
        gap: 10px;
        z-index: 20;
      }
      .menu-card {
        display:grid;
        gap:8px;
        padding:12px 14px;
        border-radius:18px;
        background: rgba(217,231,245,0.36);
      }
      .menu-meta { display:grid; gap:4px; }
      .menu-item { width:100%; }
      .field-header {
        display:flex;
        justify-content:space-between;
        align-items:center;
        gap:10px;
      }
      .identity, .token-result {
        border-radius:20px; border:1px solid rgba(129,69,255,0.14); background:rgba(255,255,255,0.78); padding:16px;
      }
      .identity-meta { display:grid; gap:8px; }
      .identity-shell {
        display:grid;
        gap:14px;
      }
      .identity-top {
        display:flex;
        align-items:center;
        gap:14px;
      }
      .avatar {
        width:56px;
        height:56px;
        border-radius:999px;
        display:inline-flex;
        align-items:center;
        justify-content:center;
        background: rgba(129,69,255,0.12);
        color: var(--purple);
        border: 1px solid rgba(129,69,255,0.18);
        font-weight: 700;
        letter-spacing: 0.04em;
        flex: 0 0 auto;
      }
      .identity-name {
        display:grid;
        gap:4px;
      }
      .identity-name strong {
        margin:0;
      }
      .hidden {
        display:none !important;
      }
      .apps-list {
        display:grid;
        gap:10px;
        margin-top:12px;
      }
      .apps-picker {
        display: grid;
        gap: 10px;
      }
      .app-choice {
        width: 100%;
        border-radius: 18px;
        border: 1px solid rgba(129,69,255,0.14);
        background: rgba(255,255,255,0.88);
        padding: 14px 16px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        text-align: left;
        cursor: pointer;
        transition: border-color 140ms ease, box-shadow 140ms ease, background 140ms ease, transform 140ms ease;
      }
      .app-choice:hover {
        border-color: rgba(129,69,255,0.28);
        box-shadow: 0 14px 32px rgba(129,69,255,0.12);
        transform: translateY(-1px);
      }
      .app-choice strong {
        display: block;
        margin-bottom: 4px;
      }
      .app-choice.active {
        background: rgba(129,69,255,0.14);
        border-color: rgba(129,69,255,0.6);
        box-shadow: 0 18px 40px rgba(129,69,255,0.16), inset 0 0 0 1px rgba(129,69,255,0.16);
      }
      .app-choice-meta {
        display: grid;
        gap: 2px;
      }
      .app-choice-side {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        justify-content: flex-end;
      }
      .app-choice-selected {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 10px;
        border-radius: 999px;
        background: rgba(255,109,63,0.12);
        color: var(--orange);
        font-size: 0.75rem;
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
      }
      .app-choice-badge {
        padding: 6px 10px;
        border-radius: 999px;
        background: rgba(0,163,255,0.1);
        color: var(--blue);
        font-size: 0.78rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        white-space: nowrap;
      }
      .selection-card {
        margin-top: 12px;
        padding: 14px 16px;
        border-radius: 18px;
        border: 1px solid rgba(129,69,255,0.16);
        background: rgba(255,255,255,0.82);
        display: grid;
        gap: 8px;
      }
      .selection-active {
        background: rgba(129,69,255,0.12);
        color: var(--purple);
        border-color: rgba(129,69,255,0.28);
        box-shadow: inset 0 0 0 1px rgba(129,69,255,0.08);
      }
      .selection-grid {
        display: grid;
        gap: 8px;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .toast-stack {
        position: fixed;
        top: 18px;
        right: 18px;
        display: grid;
        gap: 10px;
        z-index: 50;
      }
      .toast {
        min-width: 240px;
        max-width: min(420px, calc(100vw - 36px));
        padding: 14px 16px;
        border-radius: 18px;
        border: 1px solid rgba(129,69,255,0.16);
        background: rgba(255,255,255,0.96);
        box-shadow: var(--shadow);
      }
      .toast.success { border-color: rgba(0,163,255,0.24); }
      .toast.error { border-color: rgba(255,109,63,0.28); }
      .mini-hint { color:var(--muted); font-size:0.82rem; }
      .icon-button { min-width:44px; min-height:44px; padding:10px 14px; }
      .token.masked { -webkit-text-security: disc; }
      pre {
        margin:0; padding:18px; border-radius:20px; background: linear-gradient(180deg, rgba(0,0,0,0.96), rgba(16,18,28,0.98));
        color:#f4f7ff; overflow:auto; min-height:220px; font-size:0.92rem; line-height:1.5; border:1px solid rgba(255,255,255,0.08);
      }
      .status { min-height:24px; font-size:0.95rem; color:var(--muted); }
      @media (max-width: 920px) { .grid.cols-2, .grid.cols-3 { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <div id="authToastStack" class="toast-stack" aria-live="polite" aria-atomic="true"></div>
    <main>
      <section class="hero">
        <div class="hero-top">
          <span class="eyebrow">Agumbe Playground Auth</span>
          <div class="hero-actions">
            <a class="secondary button-link" href="/playground">${arrowLeftIcon}<span class="button-text">Back to Playground</span></a>
            <div id="authAccountMenuShell" class="menu-shell hidden">
              <button id="authAccountMenuButton" class="secondary" type="button"><span class="button-text">Account</span>${chevronDownIcon}</button>
              <div id="authAccountMenuPanel" class="menu-panel hidden">
                <div id="authAccountMenuCard" class="menu-card"></div>
                <button id="switchAccountMenuButton" class="ghost menu-item" type="button">${userIcon}<span class="button-text">Switch Account</span></button>
                <button id="signOutMenuButton" class="secondary menu-item" type="button">${logoutIcon}<span class="button-text">Log Out</span></button>
              </div>
            </div>
          </div>
        </div>
        <h1>Sign in and manage tokens.</h1>
        <p>Complete the auth flow in order: sign in or sign up, create an app token if you want one, then send the active credential back to the main playground.</p>
      </section>

      <section class="card">
        <div class="section">
          <p class="section-title">Step 1 · Sign In Or Sign Up</p>
          <p class="step-copy">Use email/password or Google OAuth to mint a session JWT through the existing auth service.</p>
          <div id="authForm">
            <div class="grid cols-2">
              <label>
                First Name
                <input id="signupFirstName" type="text" placeholder="Jack" />
              </label>
              <label>
                Last Name
                <input id="signupLastName" type="text" placeholder="Smith" />
              </label>
              <label>
                Email
                <input id="signinEmail" type="email" placeholder="you@agumbe.ai" />
              </label>
              <label>
                Password
                <input id="signinPassword" type="password" placeholder="Password" />
              </label>
            </div>
            <div class="actions">
              <button id="signIn" class="primary" type="button">Sign In</button>
              <button id="signUp" class="accent" type="button">Sign Up</button>
              <button id="googleOauth" class="ghost" type="button">${userIcon}<span class="button-text">Continue with Google</span></button>
            </div>
          </div>
          <div id="identity" class="identity" style="margin-top:12px;">
            <strong>No active session yet.</strong>
            <div class="identity-meta">
              <span class="mini-hint">Sign in, sign up, or use Google OAuth to mint a JWT through the existing auth service and reuse it in the playground.</span>
            </div>
          </div>
        </div>

        <div class="section">
          <p class="section-title">Step 2 · Create App Token</p>
          <p class="step-copy">Optional for programmatic testing. This reuses the current auth app register + token flow.</p>
          <div class="grid cols-3">
            <label>
              App Name
              <input id="appName" type="text" value="Playground" />
            </label>
            <label>
              Scope
              <input id="appScope" type="text" value="llm:invoke" />
            </label>
            <label>
              Purpose
              <input id="appPurpose" type="text" value="Internal playground access" />
            </label>
          </div>
          <div class="actions">
            <button id="createAppToken" class="accent" type="button">${keyIcon}<span class="button-text">Create App Token</span></button>
          </div>
          <div id="appsList" class="apps-list"></div>
          <div id="tokenResult" class="token-result" style="margin-top:12px;">
            <strong>No app token created yet.</strong>
            <div class="mini-hint">This uses the existing auth service's app register + app token flow. It is an API token, not a separate LLM-native key yet.</div>
          </div>
        </div>

        <div class="section">
          <p class="section-title">Step 3 · Use In Playground</p>
          <p class="step-copy">Choose which credential should be active in the main playground, then go back and start testing requests.</p>
          <div class="actions">
            <button id="useSessionJwt" class="secondary" type="button">${userIcon}<span class="button-text">Use Session JWT</span></button>
            <button id="useAppToken" class="secondary" type="button">${keyIcon}<span class="button-text">Use App Token</span></button>
            <a class="ghost button-link" href="/playground">${arrowLeftIcon}<span class="button-text">Back to Playground</span></a>
          </div>
          <div class="mini-hint" style="margin-top: 10px;">The selected token is stored in this browser session and automatically picked up by the main playground page.</div>
          <div id="activeSelectionCard" class="selection-card">
            <strong>No active playground credential selected yet.</strong>
            <div class="mini-hint">Choose Session JWT or App Token to make it the active Bearer token for the main playground.</div>
          </div>
        </div>

        <div class="section">
          <p class="section-title">Status</p>
          <div id="status" class="status">Ready.</div>
        </div>

        <div class="section">
          <p class="section-title">Raw JSON</p>
          <pre id="jsonOutput">{}</pre>
        </div>
      </section>
    </main>
    <script>
      const config = ${bootstrap};
      const storageKeys = {
        activeToken: "agumbe-llm-playground-token",
        sessionJwt: "agumbe-llm-playground-session-jwt",
        latestAppToken: "agumbe-llm-playground-app-token",
        latestAppBundle: "agumbe-llm-playground-app-bundle"
      };

      const signupFirstNameInput = document.getElementById("signupFirstName");
      const signupLastNameInput = document.getElementById("signupLastName");
      const signinEmailInput = document.getElementById("signinEmail");
      const signinPasswordInput = document.getElementById("signinPassword");
      const appNameInput = document.getElementById("appName");
      const appScopeInput = document.getElementById("appScope");
      const appPurposeInput = document.getElementById("appPurpose");
      const authForm = document.getElementById("authForm");
      const identity = document.getElementById("identity");
      const appsList = document.getElementById("appsList");
      const tokenResult = document.getElementById("tokenResult");
      const status = document.getElementById("status");
      const jsonOutput = document.getElementById("jsonOutput");
      const signInButton = document.getElementById("signIn");
      const signUpButton = document.getElementById("signUp");
      const googleOauthButton = document.getElementById("googleOauth");
      const useSessionJwtButton = document.getElementById("useSessionJwt");
      const createAppTokenButton = document.getElementById("createAppToken");
      const useAppTokenButton = document.getElementById("useAppToken");
      const activeSelectionCard = document.getElementById("activeSelectionCard");
      const authAccountMenuShell = document.getElementById("authAccountMenuShell");
      const authAccountMenuButton = document.getElementById("authAccountMenuButton");
      const authAccountMenuPanel = document.getElementById("authAccountMenuPanel");
      const authAccountMenuCard = document.getElementById("authAccountMenuCard");
      const switchAccountMenuButton = document.getElementById("switchAccountMenuButton");
      const signOutMenuButton = document.getElementById("signOutMenuButton");
      const authToastStack = document.getElementById("authToastStack");

      const state = {
        sessionJwt: sessionStorage.getItem(storageKeys.sessionJwt) || "",
        latestAppToken: sessionStorage.getItem(storageKeys.latestAppToken) || "",
        latestAppBundle: null,
        apps: [],
        activeToken: sessionStorage.getItem(storageKeys.activeToken) || "",
        selectedAppId: ""
      };

      try { state.latestAppBundle = JSON.parse(sessionStorage.getItem(storageKeys.latestAppBundle) || "null"); } catch { state.latestAppBundle = null; }

      function escapeHtml(value) {
        return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
      }

      function decodeJwt(token) {
        const parts = token.split(".");
        if (parts.length < 2) return null;
        try {
          const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
          const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
          return JSON.parse(atob(padded));
        } catch {
          return null;
        }
      }

      function setStatus(message) { status.textContent = message; }
      function sanitizeForDisplay(value, parentKey) {
        if (Array.isArray(value)) {
          return value.map((entry) => sanitizeForDisplay(entry, parentKey));
        }

        if (!value || typeof value !== "object") {
          return value;
        }

        const sensitiveKeys = new Set([
          "token",
          "access_token",
          "refresh_token",
          "secret_jwt",
          "client_secret",
          "authorization",
          "cookie",
          "set-cookie",
        ]);

        const result = {};
        Object.entries(value).forEach(([key, entry]) => {
          if (sensitiveKeys.has(key.toLowerCase())) {
            if (key.toLowerCase() === "token" && entry && typeof entry === "object" && !Array.isArray(entry)) {
              result[key] = sanitizeForDisplay(entry, key);
            } else {
              result[key] = "[redacted]";
            }
            return;
          }

          result[key] = sanitizeForDisplay(entry, key);
        });

        return result;
      }

      function setJson(value) { jsonOutput.textContent = JSON.stringify(sanitizeForDisplay(value, ""), null, 2); }
      function closeAuthMenu() { authAccountMenuPanel.classList.add("hidden"); }
      function showToast(message, tone) {
        const toast = document.createElement("div");
        toast.className = "toast " + (tone || "success");
        toast.textContent = message;
        authToastStack.appendChild(toast);
        window.setTimeout(() => {
          toast.remove();
        }, 2600);
      }
      function renderActiveSelection() {
        const activeToken = sessionStorage.getItem(storageKeys.activeToken) || state.activeToken || "";
        state.activeToken = activeToken;

        useSessionJwtButton.classList.remove("selection-active");
        useAppTokenButton.classList.remove("selection-active");

        if (!activeToken) {
          activeSelectionCard.innerHTML = '<strong>No active playground credential selected yet.</strong><div class="mini-hint">Choose Session JWT or App Token to make it the active Bearer token for the main playground.</div>';
          return;
        }

        const isSession = !!state.sessionJwt && activeToken === state.sessionJwt;
        const isAppToken = !!state.latestAppToken && activeToken === state.latestAppToken;

        if (isSession) {
          useSessionJwtButton.classList.add("selection-active");
        }

        if (isAppToken) {
          useAppTokenButton.classList.add("selection-active");
        }

        const tokenLabel = isSession
          ? "Session JWT"
          : isAppToken
            ? "App Token"
            : "Custom Active Token";
        const subject = decodeJwt(activeToken);

        activeSelectionCard.innerHTML = [
          '<strong>Currently selected: ' + escapeHtml(tokenLabel) + '</strong>',
          '<div class="selection-grid">',
          '<div><span class="mini-hint">Source</span><br />' + escapeHtml(tokenLabel) + '</div>',
          '<div><span class="mini-hint">Subject</span><br />' + escapeHtml(subject?.email || subject?.client_key || subject?.id || subject?.sub || "Hidden") + '</div>',
          '</div>'
        ].join("");
      }

      function clearCredentials() {
        sessionStorage.removeItem(storageKeys.activeToken);
        sessionStorage.removeItem(storageKeys.sessionJwt);
        sessionStorage.removeItem(storageKeys.latestAppToken);
        sessionStorage.removeItem(storageKeys.latestAppBundle);
        state.sessionJwt = "";
        state.latestAppToken = "";
        state.latestAppBundle = null;
        state.apps = [];
        state.activeToken = "";
        closeAuthMenu();
        renderApps([]);
        renderTokenResult(null);
        renderActiveSelection();
      }

      function initialsFromClaims(claims) {
        const first = typeof claims?.first_name === "string" ? claims.first_name.trim() : "";
        const last = typeof claims?.last_name === "string" ? claims.last_name.trim() : "";
        if (first || last) {
          return (first.slice(0, 1) + last.slice(0, 1)).toUpperCase() || "A";
        }

        const email = typeof claims?.email === "string" ? claims.email.trim() : "";
        if (email) {
          return email.slice(0, 2).toUpperCase();
        }

        const id = typeof claims?.id === "string" ? claims.id : typeof claims?.sub === "string" ? claims.sub : "AG";
        return id.slice(0, 2).toUpperCase();
      }

      function renderIdentity(claims, sourceLabel) {
        if (!claims) {
          authForm.classList.remove("hidden");
          authAccountMenuShell.classList.add("hidden");
          identity.innerHTML = '<strong>No active session yet.</strong><div class="identity-meta"><span class="mini-hint">Sign in, sign up, or use Google OAuth to mint a JWT through the existing auth service and reuse it in the playground.</span></div>';
          return;
        }

        authForm.classList.add("hidden");
        authAccountMenuShell.classList.remove("hidden");

        const primaryLabel = claims.email || claims.owner_user || claims.client_key || "Signed in";
        const avatar = initialsFromClaims(claims);
        authAccountMenuButton.innerHTML = '<span class="button-text">' + escapeHtml(avatar) + '</span>' + ${JSON.stringify(chevronDownIcon)};
        authAccountMenuCard.innerHTML = [
          '<strong>' + escapeHtml(primaryLabel) + '</strong>',
          '<div class="menu-meta">',
          '<span class="mini-hint">Source: ' + escapeHtml(sourceLabel) + '</span>',
          '<span class="mini-hint">Tenant: ' + escapeHtml(claims.tenant_id || claims.tenantId || "n/a") + '</span>',
          '</div>'
        ].join("");
        identity.innerHTML = [
          '<div class="identity-shell">',
          '<div class="identity-top">',
          '<span class="avatar" aria-hidden="true">' + escapeHtml(avatar) + '</span>',
          '<div class="identity-name">',
          '<strong>' + escapeHtml(primaryLabel) + '</strong>',
          '<span class="mini-hint">Signed in. You can continue with token management below or switch accounts.</span>',
          '</div>',
          '</div>',
          '<div class="identity-meta">',
          '<span><strong style="display:block; margin-bottom:4px;">Source</strong>' + escapeHtml(sourceLabel) + '</span>',
          '<span><strong style="display:block; margin-bottom:4px;">Tenant</strong>' + escapeHtml(claims.tenant_id || claims.tenantId || "n/a") + '</span>',
          '<span><strong style="display:block; margin-bottom:4px;">User ID / JWT Subject</strong>' + escapeHtml(claims.id || claims.sub || claims.client_key || "n/a") + '</span>',
          '</div>',
          '</div>'
        ].join("");
      }

      function renderApps(apps) {
        if (!apps.length) {
          state.selectedAppId = "";
          appsList.innerHTML = '<div class="mini-hint">No existing tenant apps found yet. Create one below if you need a dedicated playground token.</div>';
          return;
        }

        const selectedAppId = apps.some((app) => app.id === state.selectedAppId)
          ? state.selectedAppId
          : apps[0].id;
        state.selectedAppId = selectedAppId;
        const selectedApp = apps.find((app) => app.id === selectedAppId) || apps[0];

        appsList.innerHTML = [
          '<div class="section-title" style="margin-bottom:0;">Existing Apps</div>',
          '<div id="appsPicker" class="apps-picker">',
          apps.map((app) => {
            const activeClass = app.id === selectedAppId ? " active" : "";
            const activeBadge = app.id === selectedAppId
              ? '<span class="app-choice-selected">' + checkIcon + '<span class="button-text">Selected</span></span>'
              : "";
            return [
              '<button class="app-choice' + activeClass + '" type="button" data-app-id="' + escapeHtml(app.id) + '" aria-pressed="' + (app.id === selectedAppId ? "true" : "false") + '">',
              '<span class="app-choice-meta">',
              '<strong>' + escapeHtml(app.app_name || "Unnamed app") + '</strong>',
              '<span class="mini-hint">' + escapeHtml(app.purpose || "No purpose set") + '</span>',
              '</span>',
              '<span class="app-choice-side">',
              activeBadge,
              '<span class="app-choice-badge">' + escapeHtml(app.scope || "no-scope") + '</span>',
              '</span>',
              '</button>'
            ].join("");
          }).join(""),
          '</div>',
          '<div class="mini-hint" style="margin-top:8px;">Selected app: <strong>' + escapeHtml(selectedApp?.app_name || "Unnamed app") + '</strong></div>',
          '<div class="actions">',
          '<button id="useExistingAppButton" class="ghost" type="button">${appWindowIcon}<span class="button-text">Use ' + escapeHtml(selectedApp?.app_name || "Selected App") + ' In Playground</span></button>',
          '</div>',
          '<div class="mini-hint">This mints a fresh access token for the selected tenant app and makes it the active playground credential.</div>'
        ].join("");

        const appsPicker = document.getElementById("appsPicker");
        appsPicker?.addEventListener("click", (event) => {
          const target = event.target;
          if (!(target instanceof Element)) return;
          const button = target.closest("[data-app-id]");
          if (!(button instanceof HTMLElement)) return;
          state.selectedAppId = button.getAttribute("data-app-id") || "";
          renderApps(state.apps);
        });

        const useExistingAppButton = document.getElementById("useExistingAppButton");

        useExistingAppButton?.addEventListener("click", async () => {
          const appId = state.selectedAppId || "";
          if (!appId) {
            setStatus("Select an app first.");
            return;
          }

          useExistingAppButton.disabled = true;
          setStatus("Minting a token for the selected app...");
          try {
            const data = await callApi("/api/v1/playground/auth/app-token/existing", { app_id: appId }, true, state.sessionJwt);
            const accessToken = data?.data?.token?.access_token;
            if (!accessToken) throw new Error("Auth service did not return an access token.");
            state.latestAppToken = accessToken;
            state.latestAppBundle = data.data;
            sessionStorage.setItem(storageKeys.latestAppToken, accessToken);
            sessionStorage.setItem(storageKeys.latestAppBundle, JSON.stringify(data.data));
            sessionStorage.setItem(storageKeys.activeToken, accessToken);
            state.activeToken = accessToken;
            renderTokenResult(data.data);
            renderActiveSelection();
            setJson(data);
            renderIdentity(decodeJwt(state.sessionJwt), "Session JWT");
            setStatus("Selected app token is now active in the playground.");
          } catch (error) {
            setStatus(error.message);
            setJson({ error: { message: error.message } });
          } finally {
            useExistingAppButton.disabled = false;
          }
        });
      }

      async function loadApps() {
        if (!state.sessionJwt) {
          renderApps([]);
          return;
        }

        try {
          const data = await callApi("/api/v1/playground/auth/apps", null, true, state.sessionJwt);
          state.apps = Array.isArray(data?.data) ? data.data : [];
          renderApps(state.apps);
        } catch (error) {
          renderApps([]);
          setStatus(error.message);
        }
      }

      function renderTokenResult(bundle) {
        if (!bundle) {
          tokenResult.innerHTML = '<strong>No app token created yet.</strong><div class="mini-hint">This uses the existing auth service\\'s app register + app token flow. It is an API token, not a separate LLM-native key yet.</div>';
          return;
        }
        tokenResult.innerHTML = [
          '<strong>App token ready.</strong>',
          '<div class="identity-meta">',
          '<span><strong style="display:block; margin-bottom:4px;">App</strong>' + escapeHtml(bundle.app.app_name) + '</span>',
          '<span><strong style="display:block; margin-bottom:4px;">Scope</strong>' + escapeHtml(bundle.app.scope) + '</span>',
          '<span><strong style="display:block; margin-bottom:4px;">Status</strong>' + escapeHtml(bundle.app.status || "active") + '</span>',
          '</div>',
          '<div class="mini-hint" style="margin-top:10px;">Use App Token will switch the active request credential for the main playground.</div>'
        ].join("");
      }

      function consumeOAuthResult() {
        const url = new URL(window.location.href);
        const statusValue = url.searchParams.get("status");
        const provider = url.searchParams.get("provider");
        const jwt = url.searchParams.get("jwt");
        const message = url.searchParams.get("message");
        if (!statusValue || !provider) return;
        if (statusValue === "success" && jwt) {
          state.sessionJwt = jwt;
          sessionStorage.setItem(storageKeys.sessionJwt, jwt);
          sessionStorage.setItem(storageKeys.activeToken, jwt);
          renderIdentity(decodeJwt(jwt), provider + " OAuth");
          loadApps();
          setStatus("Signed in with " + provider + ". You can go back to the playground now.");
          setJson({ data: { provider, claims: decodeJwt(jwt) } });
        } else if (statusValue === "error") {
          setStatus(message || (provider + " sign-in failed."));
          setJson({ error: { message: message || (provider + " sign-in failed.") } });
        }
        window.history.replaceState({}, document.title, url.pathname);
      }

      async function callApi(path, payload, requiresAuth, overrideToken) {
        const token = (overrideToken || "").trim();
        if (requiresAuth && !token) throw new Error("A signed-in session JWT is required.");
        const response = await fetch(path, {
          method: payload ? "POST" : "GET",
          headers: { ...(payload ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: "Bearer " + token } : {}) },
          body: payload ? JSON.stringify(payload) : undefined,
        });
        const text = await response.text();
        let data = {};
        if (text) {
          try {
            data = JSON.parse(text);
          } catch {
            data = {
              error: {
                message: text.includes("<html") || text.includes("<!doctype")
                  ? "The gateway returned HTML instead of JSON. This usually means the ingress route is missing or the upstream returned a non-API error page."
                  : text,
              },
            };
          }
        }
        if (!response.ok) throw new Error(data?.error?.message || "Request failed");
        return data;
      }

      signInButton.addEventListener("click", async () => {
        signInButton.disabled = true;
        setStatus("Signing in...");
        try {
          const data = await callApi("/api/v1/playground/auth/signin", {
            email: signinEmailInput.value.trim(),
            password: signinPasswordInput.value,
          }, false);
          const token = data?.data?.token;
          if (!token) throw new Error("Auth service did not return a session token.");
          state.sessionJwt = token;
          sessionStorage.setItem(storageKeys.sessionJwt, token);
          sessionStorage.setItem(storageKeys.activeToken, token);
          renderIdentity(data.data.claims || decodeJwt(token), "Session JWT");
          loadApps();
          setJson(data);
          setStatus("Signed in. Session JWT is now active for the main playground.");
        } catch (error) {
          setStatus(error.message);
          setJson({ error: { message: error.message } });
        } finally {
          signInButton.disabled = false;
        }
      });

      signUpButton.addEventListener("click", async () => {
        signUpButton.disabled = true;
        setStatus("Creating account...");
        try {
          const firstName = signupFirstNameInput.value.trim();
          const lastName = signupLastNameInput.value.trim();
          if (!firstName || !lastName) throw new Error("First name and last name are required for signup.");
          const data = await callApi("/api/v1/playground/auth/signup", {
            email: signinEmailInput.value.trim(),
            password: signinPasswordInput.value,
            first_name: firstName,
            last_name: lastName,
          }, false);
          setJson(data);
          setStatus("Signup submitted. Check email verification before signing in.");
        } catch (error) {
          setStatus(error.message);
          setJson({ error: { message: error.message } });
        } finally {
          signUpButton.disabled = false;
        }
      });

      googleOauthButton.addEventListener("click", () => {
        const redirectUri = window.location.origin + window.location.pathname;
        const oauthUrl = config.authBaseUrl + "/api/v1/users/auth/google?redirect_uri=" + encodeURIComponent(redirectUri);
        window.location.href = oauthUrl;
      });

      useSessionJwtButton.addEventListener("click", () => {
        if (!state.sessionJwt) {
          setStatus("Sign in first to load a session JWT.");
          return;
        }
        sessionStorage.setItem(storageKeys.activeToken, state.sessionJwt);
        state.activeToken = state.sessionJwt;
        renderIdentity(decodeJwt(state.sessionJwt), "Session JWT");
        renderActiveSelection();
        setStatus("Session JWT is now the active Bearer token for the main playground.");
      });

      createAppTokenButton.addEventListener("click", async () => {
        createAppTokenButton.disabled = true;
        setStatus("Creating app token...");
        try {
          if (!state.sessionJwt) throw new Error("Sign in first so the auth service can issue an app token.");
          const data = await callApi("/api/v1/playground/auth/app-token", {
            app_name: appNameInput.value.trim(),
            scope: appScopeInput.value.trim(),
            purpose: appPurposeInput.value.trim(),
          }, true, state.sessionJwt);
          const accessToken = data?.data?.token?.access_token;
          if (!accessToken) throw new Error("Auth service did not return an access token.");
          state.latestAppToken = accessToken;
          state.latestAppBundle = data.data;
          sessionStorage.setItem(storageKeys.latestAppToken, accessToken);
          sessionStorage.setItem(storageKeys.latestAppBundle, JSON.stringify(data.data));
          if (data?.data?.app?.id) {
            const nextApps = Array.isArray(state.apps) ? [...state.apps] : [];
            const existingIndex = nextApps.findIndex((app) => app?.id === data.data.app.id);
            if (existingIndex >= 0) {
              nextApps[existingIndex] = data.data.app;
            } else {
              nextApps.unshift(data.data.app);
            }
            state.apps = nextApps;
            state.selectedAppId = data.data.app.id;
            renderApps(state.apps);
          }
          renderTokenResult(data.data);
          renderActiveSelection();
          loadApps();
          setJson(data);
          setStatus("App token created. You can use it in the main playground.");
        } catch (error) {
          setStatus(error.message);
          setJson({ error: { message: error.message } });
        } finally {
          createAppTokenButton.disabled = false;
        }
      });

      useAppTokenButton.addEventListener("click", () => {
        if (!state.latestAppToken) {
          setStatus("Create an app token first.");
          return;
        }
        sessionStorage.setItem(storageKeys.activeToken, state.latestAppToken);
        state.activeToken = state.latestAppToken;
        renderIdentity(decodeJwt(state.latestAppToken), "App Token");
        renderActiveSelection();
        setStatus("App token is now the active Bearer token for the main playground.");
      });

      authAccountMenuButton.addEventListener("click", (event) => {
        event.stopPropagation();
        const isOpen = !authAccountMenuPanel.classList.contains("hidden");
        if (isOpen) {
          closeAuthMenu();
          return;
        }
        authAccountMenuPanel.classList.remove("hidden");
      });

      authAccountMenuPanel.addEventListener("click", (event) => {
        event.stopPropagation();
      });

      switchAccountMenuButton.addEventListener("click", () => {
        authForm.classList.remove("hidden");
        closeAuthMenu();
        setStatus("Sign in form reopened. Your current session remains active until you log out or replace it.");
      });

      signOutMenuButton.addEventListener("click", () => {
        clearCredentials();
        renderIdentity(null, "");
        setStatus("Logged out from this browser session.");
        showToast("Logged out from this browser session.", "success");
      });

      document.addEventListener("pointerdown", (event) => {
        if (!authAccountMenuPanel.classList.contains("hidden") && !authAccountMenuShell.contains(event.target)) {
          closeAuthMenu();
        }
      });

      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          closeAuthMenu();
        }
      });

      if (state.sessionJwt) {
        renderIdentity(decodeJwt(state.sessionJwt), "Session JWT");
        loadApps();
      } else {
        renderApps([]);
      }
      renderTokenResult(state.latestAppBundle);
      renderActiveSelection();
      consumeOAuthResult();
    </script>
  </body>
</html>`;
}

export function registerPlaygroundRoutes(app: FastifyInstance, env: Env) {
  app.get("/playground", async (_request, reply) => {
    reply.type("text/html; charset=utf-8").send(
      createPlaygroundHtml({
        authBaseUrl: env.AUTH_BASE_URL,
        pricing: env.MODEL_PRICING,
      }),
    );
  });

  app.get("/playground/auth", async (_request, reply) => {
    reply.type("text/html; charset=utf-8").send(
      createPlaygroundAuthHtml({
        authBaseUrl: env.AUTH_BASE_URL,
        pricing: env.MODEL_PRICING,
      }),
    );
  });

  app.post("/api/v1/playground/auth/signin", async (request, reply) => {
    const body = (request.body || {}) as Record<string, unknown>;
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!email || !password) {
      reply.code(400).send({
        error: {
          message: "email and password are required",
        },
      });
      return;
    }

    const result = await callAuth(env.AUTH_BASE_URL, "/api/v1/users/signin", {
      body: { email, password },
    });

    if (!result.ok) {
      reply.code(result.status).send({
        error: {
          message: getErrorMessage(result.data, "Sign in failed"),
        },
      });
      return;
    }

    const token = extractJwtFromSetCookie(result.cookies);
    if (!token) {
      reply.code(502).send({
        error: {
          message: "Auth service did not return a usable session token",
        },
      });
      return;
    }

    reply.send({
      data: {
        token,
        claims: decodeJwtPayload(token),
        user: result.data?.data || result.data?.currentUser || null,
      },
    });
  });

  app.post("/api/v1/playground/auth/signup", async (request, reply) => {
    const body = (request.body || {}) as Record<string, unknown>;
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const firstName = typeof body.first_name === "string" ? body.first_name.trim() : "";
    const lastName = typeof body.last_name === "string" ? body.last_name.trim() : "";

    if (!email || !password || !firstName || !lastName) {
      reply.code(400).send({
        error: {
          message: "first_name, last_name, email, and password are required",
        },
      });
      return;
    }

    const result = await callAuth(env.AUTH_BASE_URL, "/api/v1/users/signup", {
      body: {
        email,
        password,
        first_name: firstName,
        last_name: lastName,
        legal: {
          terms_accepted: true,
          privacy_accepted: true,
          terms_version: "playground-v1",
          privacy_version: "playground-v1",
        },
      },
    });

    if (!result.ok) {
      reply.code(result.status).send({
        error: {
          message: getErrorMessage(result.data, "Signup failed"),
        },
      });
      return;
    }

    reply.code(201).send({
      data: result.data?.data || null,
      message: result.data?.msg || "Verification email sent",
    });
  });

  app.get("/api/v1/playground/auth/apps", async (request, reply) => {
    const authorization = request.headers.authorization;
    const bearerToken = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length).trim()
      : "";

    if (!bearerToken) {
      reply.code(401).send({
        error: {
          message: "A signed-in session JWT is required to list apps",
        },
      });
      return;
    }

    const result = await callAuth(env.AUTH_BASE_URL, "/api/v1/app", {
      method: "GET",
      bearerToken,
    });

    if (!result.ok) {
      reply.code(result.status).send({
        error: {
          message: getErrorMessage(result.data, "App listing failed"),
        },
      });
      return;
    }

    reply.send({
      data: Array.isArray(result.data?.data)
        ? result.data.data
            .map((appEntry: Record<string, unknown>) => sanitizeAppForPlayground(appEntry))
            .filter(Boolean)
        : [],
    });
  });

  app.post("/api/v1/playground/auth/app-token", async (request, reply) => {
    const authorization = request.headers.authorization;
    const bearerToken = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length).trim()
      : "";

    if (!bearerToken) {
      reply.code(401).send({
        error: {
          message: "A signed-in session JWT is required to create an app token",
        },
      });
      return;
    }

    const body = (request.body || {}) as Record<string, unknown>;
    const appName = typeof body.app_name === "string" ? body.app_name.trim() : "";
    const purpose = typeof body.purpose === "string" ? body.purpose.trim() : "";
    const scope = typeof body.scope === "string" ? body.scope.trim() : "";

    if (!appName || !purpose || !scope) {
      reply.code(400).send({
        error: {
          message: "app_name, purpose, and scope are required",
        },
      });
      return;
    }

    const registration = await callAuth(env.AUTH_BASE_URL, "/api/v1/app/register", {
      bearerToken,
      body: {
        app_name: appName,
        purpose,
        scope,
      },
    });

    if (!registration.ok) {
      reply.code(registration.status).send({
        error: {
          message: getErrorMessage(registration.data, "App registration failed"),
        },
      });
      return;
    }

    const appData = registration.data?.data;
    if (!appData?.client_key || !appData?.secret_jwt) {
      reply.code(502).send({
        error: {
          message: "Auth service did not return app credentials",
        },
      });
      return;
    }

    const tokenResult = await callAuth(env.AUTH_BASE_URL, "/api/v1/app/token", {
      bearerToken,
      body: {
        client_key: appData.client_key,
        secret_jwt: appData.secret_jwt,
        grant_type: "client_credentials",
      },
    });

    if (!tokenResult.ok) {
      reply.code(tokenResult.status).send({
        error: {
          message: getErrorMessage(tokenResult.data, "App token creation failed"),
        },
      });
      return;
    }

    reply.send({
      data: {
        app: sanitizeAppForPlayground(appData),
        token: sanitizeTokenForPlayground(tokenResult.data?.data),
      },
    });
  });

  app.post("/api/v1/playground/auth/app-token/existing", async (request, reply) => {
    const authorization = request.headers.authorization;
    const bearerToken = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length).trim()
      : "";

    if (!bearerToken) {
      reply.code(401).send({
        error: {
          message: "A signed-in session JWT is required to use an existing app",
        },
      });
      return;
    }

    const body = (request.body || {}) as Record<string, unknown>;
    const appId = typeof body.app_id === "string" ? body.app_id.trim() : "";

    if (!appId) {
      reply.code(400).send({
        error: {
          message: "app_id is required",
        },
      });
      return;
    }

    const tokenResult = await callAuth(env.AUTH_BASE_URL, "/api/v1/app/token/session", {
      bearerToken,
      body: {
        app_id: appId,
        grant_type: "client_credentials",
      },
    });

    if (!tokenResult.ok) {
      reply.code(tokenResult.status).send({
        error: {
          message: getErrorMessage(tokenResult.data, "Existing app token creation failed"),
        },
      });
      return;
    }

    reply.send({
      data: {
        app: sanitizeAppForPlayground(tokenResult.data?.data?.app),
        token: sanitizeTokenForPlayground(tokenResult.data?.data?.token),
      },
    });
  });
}
