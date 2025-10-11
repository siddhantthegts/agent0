# User Story: Single-Tool Code Agent with E2B Sandbox (Mastra)

## Title

Build a minimal “one-tool” code agent that plans → writes TypeScript → executes inside an E2B sandbox and uses in-prompt skills to call external APIs—without adding extra tool-calling round-trips.

## As a

Developer building a concise demo of agentic code execution.

## I want

- A Mastra agent with exactly **one tool**: `exec_ts(code: string, files?: Record<string,string>, args?: any) -> { stdout, stderr, files, result }`.
- The model to **write TS programs** that:
  - import/use a tiny set of **in-prompt skills** (documented in the system prompt), e.g. `http.request`, `kv.get/put`, `search.query`, `fs.readFile/writeFile` (backed by our own server-side shims).
  - **define new helper functions on the fly** (i.e., “generate tools”) within the same TS program and reuse them across steps by re-emitting them (no separate tool registration step).
- Execution to run in an **E2B sandbox** with:
  - network access **only** via our provided skill shims (secrets injected as env vars)
  - per-run CPU/timeout quotas, file persistence for the session, and log capture.

## So that

- The agent can plan and act in **two phases** per iteration: (1) generate TS; (2) run once; consume results immediately—**no third “tool result reflection” round-trip**.
- The demo stays small, auditable, and reproducible.

## System Prompt (seed)

You are a code-mode agent. You have ONE capability: emit TypeScript for `exec_ts`.  
Rules:

1. Always output a complete TS program (no prose).
2. Use only these skill shims:
   - `import { http, search, kv, fs, log } from "skills";`
   - `http.request({ url, method?, headers?, body? }) -> { status, headers, body }`
   - `search.query(q: string) -> { results: Array<{title,url,snippet}> }`
   - `kv.get(key), kv.put(key, value)`, `fs.readFile(path), fs.writeFile(path, content)`, `log.info(...args)`
3. You may define new helpers inside your TS and reuse them by re-emitting them later.
4. Never request tools other than `exec_ts`. Do not ask the host to fetch URLs; use `http.request`.
5. On each step:
   - read inputs (args, prior files);
   - do the minimal work;
   - print **one** `JSON.stringify({ ok:true, data })` at the end to stdout.
6. Keep code deterministic and side-effect-aware; write small pure helpers; persist important artifacts via `fs`/`kv`.

## Acceptance Criteria

- **AC1**: Given a goal (“fetch top posts from an API and summarize”), the agent emits a single TS program that calls `http.request`, parses JSON, summarizes, then prints JSON to stdout; the host appends `{stdout}` back into the chat.
- **AC2**: Agent self-creates a helper (e.g., `extractLinks(html)`) and reuses it in a later step by re-emitting it—no separate tool registration.
- **AC3**: Secrets (API keys) are **never** printed; they are read from `process.env` via provided shims.
- **AC4**: A quota breach (timeout/CPU) returns a controlled error and the agent adjusts (smaller batch/page).
- **AC5**: Demo runs locally with Mastra + E2B; no Cloudflare account required.

## Non-Goals / Constraints

- No dynamic tool discovery or external MCP registry UI.
- No unrestricted internet from the sandbox; all egress goes through `http` shim.

## Architecture (concise)

- **Host App (Node/Next)**: Mastra agent loop + single tool adapter.
- **Tool Adapter**: `exec_ts` → spins E2B sandbox; mounts `files`, injects `skills` module and env; runs TS; streams logs; returns `{ stdout, stderr, files }`.
- **Skills Layer** (host-provided): lightweight TypeScript APIs that proxy to host services (fetch, search provider, KV, file staging). Bound into sandbox via a virtual module `skills`.

## Minimal API Contracts

- `POST /tool/exec_ts` body: `{ code: string, files?: Record<string,string>, args?: any }`
  - returns: `{ stdout: string, stderr: string, files?: Record<string,string>, result?: any }`
- `skills` env: `process.env.API_KEY_*`, `process.env.BASE_URL_*`

## Example Tasks (ready to demo)

1. **Web search + summarize**: `search.query("site:docs e2b sandbox limits")` → collect → summarize → store to `files/summary.md`.
2. **HTTP API integration**: call a public JSON API; write TSV to `report.tsv`; persist in KV.
3. **Iterative helper**: define `chunk<T>(arr,n)` and reuse across a follow-up step.

## Telemetry & Safety

- Log every `exec_ts` call (prompt hash, token usage, duration, exit code).
- Hard time limit (e.g., 20s), memory cap, outbound URL allow-list.
- Redact secrets in logs; block `child_process`, raw sockets, and `eval` within skills.

## Definition of Done

- One `npm run demo` starts a local chat, provisions E2B, and completes AC1–AC3.
- Readme shows **one** end-to-end transcript and the system prompt above.
