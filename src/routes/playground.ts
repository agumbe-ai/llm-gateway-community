import type { FastifyInstance } from "fastify";

const playgroundHtml = `<!doctype html>
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
        font-family: "Avenir Next", "Segoe UI", sans-serif;
        color: var(--ink);
        background:
          radial-gradient(circle at 18% 12%, rgba(255, 109, 63, 0.24), transparent 18rem),
          radial-gradient(circle at 86% 18%, rgba(0, 163, 255, 0.18), transparent 20rem),
          radial-gradient(circle at 55% 85%, rgba(129, 69, 255, 0.16), transparent 22rem),
          linear-gradient(180deg, #cfdceb 0%, #dce8f6 22%, #f7f8fc 100%);
      }

      main {
        width: min(1180px, calc(100vw - 32px));
        margin: 28px auto;
      }

      .hero {
        display: grid;
        gap: 14px;
        margin-bottom: 18px;
        padding: 18px 8px 6px;
      }

      .eyebrow {
        display: inline-flex;
        width: fit-content;
        padding: 6px 12px;
        border-radius: 999px;
        background: linear-gradient(135deg, rgba(129, 69, 255, 0.14), rgba(0, 163, 255, 0.12));
        color: var(--purple);
        font-size: 12px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        border: 1px solid rgba(129, 69, 255, 0.14);
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

      .controls {
        padding: 22px;
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

      input,
      select,
      textarea,
      button {
        font: inherit;
      }

      input,
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
        min-height: 84px;
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }

      .preset-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
      }

      button {
        border: 0;
        border-radius: 999px;
        padding: 12px 18px;
        cursor: pointer;
        transition: transform 120ms ease, opacity 120ms ease, box-shadow 120ms ease;
      }

      button:hover {
        transform: translateY(-1px);
      }

      button:disabled {
        cursor: wait;
        opacity: 0.65;
      }

      .primary {
        background: linear-gradient(135deg, var(--orange), #ff875f 52%, var(--purple));
        color: var(--white);
        box-shadow: 0 14px 24px rgba(255, 109, 63, 0.22);
      }

      .secondary {
        background: linear-gradient(135deg, rgba(129, 69, 255, 0.08), rgba(0, 163, 255, 0.08));
        color: var(--ink);
        border: 1px solid rgba(129, 69, 255, 0.1);
      }

      .ghost {
        background: rgba(255, 255, 255, 0.72);
        color: var(--purple);
        border: 1px solid rgba(129, 69, 255, 0.16);
      }

      .output {
        padding: 22px;
        display: grid;
        gap: 18px;
      }

      .assistant {
        border-radius: 20px;
        padding: 18px;
        background:
          radial-gradient(circle at top right, rgba(0, 163, 255, 0.16), transparent 12rem),
          linear-gradient(145deg, rgba(255, 109, 63, 0.12), rgba(255, 255, 255, 0.9) 42%, rgba(129, 69, 255, 0.1));
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
        background:
          linear-gradient(180deg, rgba(0, 0, 0, 0.96), rgba(16, 18, 28, 0.98)),
          linear-gradient(135deg, rgba(129, 69, 255, 0.18), rgba(0, 163, 255, 0.12));
        color: #f4f7ff;
        overflow: auto;
        min-height: 280px;
        font-size: 0.92rem;
        line-height: 1.5;
        border: 1px solid rgba(255, 255, 255, 0.08);
      }

      .status {
        min-height: 24px;
        font-size: 0.95rem;
        color: var(--muted);
      }

      .hint {
        font-size: 0.9rem;
        color: var(--muted);
      }

      .meta {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        color: var(--muted);
        font-size: 0.9rem;
      }

      @media (max-width: 920px) {
        .layout {
          grid-template-columns: 1fr;
        }

        .grid.cols-2 {
          grid-template-columns: 1fr;
        }

        .preset-grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <span class="eyebrow">Agumbe Playground</span>
        <h1>Test the gateway like a customer would.</h1>
        <p>
          This playground talks to the same compatibility-first API exposed by the gateway.
          Paste a Bearer token, choose chat or embeddings, and inspect the raw JSON response.
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
            <div class="grid">
              <label>
                Bearer Token
                <textarea id="token" class="token" placeholder="Paste a JWT or future API key here"></textarea>
              </label>
              <p class="hint">Stored only in this browser session for convenience.</p>
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
              <button id="copyAssistant" class="ghost" type="button">Copy Response</button>
            </div>
            <div id="assistant" class="assistant empty">Run a chat request to see the assistant response here.</div>
          </div>

          <div>
            <p class="section-title">Status</p>
            <div id="status" class="status">Ready.</div>
          </div>

          <div>
            <p class="section-title">Raw JSON</p>
            <pre id="jsonOutput">{}</pre>
          </div>
        </section>
      </section>
    </main>

    <script>
      const storageKey = "agumbe-llm-playground-token";
      const tokenInput = document.getElementById("token");
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
      const copyAssistantButton = document.getElementById("copyAssistant");
      const loadModelsButton = document.getElementById("loadModels");
      const runRequestButton = document.getElementById("runRequest");
      const clearOutputButton = document.getElementById("clearOutput");

      tokenInput.value = sessionStorage.getItem(storageKey) || "";

      function setStatus(message) {
        status.textContent = message;
      }

      function setJson(value) {
        jsonOutput.textContent = JSON.stringify(value, null, 2);
      }

      function setAssistantPreview(value) {
        assistant.textContent = value || "No assistant preview available for this response.";
        assistant.classList.toggle("empty", !value);
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

      async function callApi(path, payload, requiresAuth) {
        const token = tokenInput.value.trim();
        if (requiresAuth && !token) {
          throw new Error("Paste a Bearer token before sending a protected request.");
        }

        sessionStorage.setItem(storageKey, token);

        const response = await fetch(path, {
          method: payload ? "POST" : "GET",
          headers: {
            ...(payload ? { "Content-Type": "application/json" } : {}),
            ...(token ? { Authorization: "Bearer " + token } : {}),
          },
          body: payload ? JSON.stringify(payload) : undefined,
        });

        const text = await response.text();
        const data = text ? JSON.parse(text) : {};

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
        setStatus("Sending request...");
        try {
          const mode = modeInput.value;
          const model = modelInput.value.trim();

          const data = mode === "chat"
            ? await callApi("/api/v1/llm/chat/completions", {
                model,
                messages: [
                  ...(systemPromptInput.value.trim()
                    ? [{ role: "system", content: systemPromptInput.value.trim() }]
                    : []),
                  { role: "user", content: userPromptInput.value.trim() },
                ],
                max_tokens: 300,
                temperature: 0.7,
              }, true)
            : await callApi("/api/v1/llm/embeddings", {
                model,
                input: embeddingInput.value
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

          setStatus("Request completed successfully.");
        } catch (error) {
          setAssistantPreview("Request failed.");
          setStatus(error.message);
          setJson({ error: { message: error.message } });
        } finally {
          runRequestButton.disabled = false;
        }
      });

      clearOutputButton.addEventListener("click", () => {
        setAssistantPreview(
          modeInput.value === "chat"
            ? "Run a chat request to see the assistant response here."
            : "Embeddings responses are shown in raw JSON."
        );
        setStatus("Ready.");
        setJson({});
      });

      copyAssistantButton.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(assistant.textContent || "");
          setStatus("Assistant response copied.");
        } catch (_error) {
          setStatus("Clipboard copy failed.");
        }
      });

      presetButtons.forEach((button) => {
        button.addEventListener("click", () => {
          applyPreset(button.dataset.preset);
          setStatus("Preset applied.");
        });
      });

      modeInput.addEventListener("change", syncMode);
      syncMode();
      void (async () => {
        try {
          const data = await callApi("/api/v1/llm/models", null, false);
          const models = (data.data || [])
            .filter((entry) => entry.kind === "chat")
            .map((entry) => entry.id);
          replaceModelOptions(models, "cheap-fast");
        } catch (_error) {
          setStatus("Ready. Model catalog will load when requested.");
        }
      })();
    </script>
  </body>
</html>
`;

export function registerPlaygroundRoutes(app: FastifyInstance) {
  app.get("/playground", async (_request, reply) => {
    reply.type("text/html; charset=utf-8").send(playgroundHtml);
  });
}
