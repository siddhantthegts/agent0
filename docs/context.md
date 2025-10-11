# Agent0 Project Conventions

## Project Overview

**Agent0** is a minimal "one-tool" code agent built with Mastra that demonstrates agentic code execution in E2B sandboxes. The core concept: the agent writes complete TypeScript programs which execute in an isolated sandbox with access to native Node.js APIs (fetch, file system, etc.) and external APIs documented in the system prompt (Brave Search, etc.).

### Core Philosophy

- **Single Tool, Maximum Power**: One tool (`exec_ts`) that runs arbitrary TypeScript code
- **Knowledge, Not Code**: APIs documented in system prompt with examples; agent writes raw fetch calls
- **Two-Phase Execution**: Generate code → execute once → consume results (no reflection round-trip)
- **Self-Generating Tools**: Agent defines helpers inline and reuses by re-emitting them
- **Zero Trust on Secrets**: API keys via env vars only, never exposed in output

## Architecture

### High-Level Structure

```
Host (Node.js + Mastra)
├── Code Agent
│   ├── System Prompt (rules + skill docs)
│   └── Single Tool: exec_ts
│       └── E2B Sandbox (isolated)
│           ├── Skills Module (injected as virtual import)
│           ├── User Files (mounted)
│           ├── Env Vars (secrets)
│           └── TypeScript Runtime
```

### Components

1. **Code Agent** (`src/mastra/agents/agent0.ts`)
   - OpenRouter LLM (x-ai/grok-code-fast-1)
   - System prompt with API documentation and examples
   - Single tool: `exec_ts`
   - Memory: LibSQL (local dev) or Postgres (production)

2. **exec_ts Tool** (`src/mastra/tools/exec_ts.ts`)
   - Creates E2B sandbox per execution
   - Installs npm dependencies on demand (e.g., `["axios", "cheerio"]`)
   - Mounts user files if provided
   - Passes API keys via env vars (any key ending in `_API_KEY` or starting with `API_KEY_` or `BASE_URL_`)
   - Executes TypeScript with Node.js runtime
   - Captures stdout/stderr, extracts JSON result
   - Returns `{ stdout, stderr, files, result, error }`
   - Timeout: 30s (includes npm install time)
   - Logs summary (dependencies, files, args) and performance metrics (sandbox creation, dependency install, code execution, total time)

3. **System Prompt** (`src/mastra/agents/agent0.ts`)
   - Documents exec_ts parameters (code, dependencies, files, args)
   - Lists recommended pnpm packages (axios, cheerio, zod, etc.)
   - Documents available APIs (Brave Search, etc.) with examples
   - Shows code patterns with and without dependencies
   - Example result format so agent knows what to expect
   - No code injection - pure knowledge transfer

4. **Mastra Config** (`src/mastra/index.ts`)
   - Registers `agent0`
   - LibSQL storage (in-memory for observability)
   - Pino logger
   - Observability enabled

## Code Patterns

### Agent System Prompt Rules

The agent must follow these rules:

1. Always output complete TS (no prose, no explanations)
2. Use native `fetch()` for all HTTP requests (available globally in Node.js)
3. Define helpers inline, reuse by re-emitting in later steps
4. Never request other tools - write ALL logic in TypeScript
5. End with: `console.log(JSON.stringify({ ok: true, data: result }))`
6. Keep code deterministic, side-effect-aware
7. API keys via `process.env.*` only, never printed

### Available Packages & APIs (documented in prompt)

**npm Packages:**

- HTTP: `axios`, native fetch
- Scraping: `cheerio`, `jsdom`
- Data: `zod`, `csv-parse`, `xml2js`
- Utils: `date-fns` (formatting only), `lodash`

**note:** sandbox uses npm (e2b default). for timezones, agent uses native `Intl.DateTimeFormat` instead of date-fns-tz (v2.0 breaking changes)

**APIs:**

- **Brave Search API**: Web search with axios/fetch examples
- Agent learns from in-prompt examples, not code injections

**exec_ts Parameters:**

- `code`: TypeScript program (required)
- `dependencies`: npm packages to install (optional)
- `files`: files to mount (optional)
- `args`: arguments via process.env.ARGS_JSON (optional)

### Tool Execution Flow

```typescript
// 1. Agent calls exec_ts with code and dependencies
{
  code: `
    import axios from "axios";
    async function main() {
      const { data } = await axios.get("https://api.example.com/data");
      console.log(JSON.stringify({ ok: true, data }));
    }
    main();
  `,
  dependencies: ["axios"]
}

// 2. Tool creates sandbox
const sbx = await Sandbox.create({ timeoutMs: 30000 });

// 3. Install dependencies
await sbx.commands.run("npm install axios");

// 4. Pass API keys via env vars
const envVars = {
  BRAVE_API_KEY: process.env.BRAVE_API_KEY,
  // ... other API keys
};

// 5. Execute code
const execution = await sbx.runCode(code, { language: "ts", envVars });

// 6. Extract result
const stdout = execution.logs.stdout.join("");
const result = JSON.parse(stdout); // { ok: true, data: ... }

// 7. Clean up
await sbx.close();
```

### File Management

- **Session Files**: Tracked in-memory during execution
- **Persistence**: Files written via `fs.writeFile` returned in tool output
- **Cross-Step**: Agent can save helpers to `helpers.ts`, read back later

## Project Structure

```
agent0/
├── docs/
│   ├── context.md              # This file
│   └── stories/
│       └── 001_seed.md         # Original user story
├── src/
│   ├── mastra/
│   │   ├── agents/
│   │   │   └── agent0.ts       # Main agent (system prompt with API docs)
│   │   ├── tools/
│   │   │   └── exec_ts.ts      # E2B wrapper
│   │   ├── skills/
│   │   │   └── index.ts        # DEPRECATED - not used anymore
│   │   └── index.ts            # Mastra config
├── package.json
├── README.md
└── .env.example                # Required env vars
```

**Note**: The `skills/` directory is kept for reference but no longer used. Agent writes raw fetch calls instead of importing skill abstractions.

## Dependencies

### Core

- `@mastra/core` - Agent framework
- `@openrouter/ai-sdk-provider` - LLM provider (OpenRouter)
- `@e2b/code-interpreter` - Sandboxed code execution

### Storage & Logging

- `@mastra/libsql` - Observability storage
- `@mastra/loggers` - Structured logging

### Dev

- `typescript` - Type checking
- `tsx` - TypeScript execution
- `mastra` (CLI) - Dev server, build, start

## Environment Variables

Required in `.env`:

```bash
E2B_API_KEY=...           # E2B sandbox API key
OPENROUTER_API_KEY=...    # OpenRouter LLM API key
NODE_ENV=development      # Environment (development/production)
```

Optional (passed through to sandbox):

```bash
API_KEY_*=...          # Any API keys for external services
BASE_URL_*=...         # Base URLs for APIs
```

For production (Postgres):

```bash
NODE_ENV=production
DATABASE_URL=postgresql://user:password@host:5432/database
```

### Memory Database Configuration

The agent uses **LibSQL** (file-based SQLite) for local development and **Postgres** for production:

- **Local**: `file:./agent0-memory.db` - Automatic, no setup needed
- **Production**: Set `NODE_ENV=production` and `DATABASE_URL` to use Postgres

The memory configuration automatically switches based on `NODE_ENV` and presence of `DATABASE_URL`.

## Acceptance Criteria (from User Story)

- **AC1**: Agent emits TS that calls `http.request`, parses JSON, summarizes, prints to stdout ✅
- **AC2**: Agent creates helper (e.g., `extractLinks`), saves to file, reuses in later step ✅
- **AC3**: Secrets read from `process.env`, never printed ✅
- **AC4**: Quota breach returns controlled error (timeout/CPU) - ⚠️ E2B handles this
- **AC5**: Runs locally with Mastra + E2B, no Cloudflare required ✅

## What Works

1. ✅ Single-tool architecture with `exec_ts`
2. ✅ Skills module injected as virtual import
3. ✅ Code generation following system prompt rules
4. ✅ E2B sandbox integration with timeout
5. ✅ Secrets via env vars
6. ✅ File persistence across steps
7. ✅ Agent memory with LibSQL (local) / Postgres (production)
8. ✅ Semantic recall for conversation context
9. ✅ Performance metrics (sandbox creation, install, execution times)

## Known Limitations & Future Improvements

### Current Limitations

1. **API Documentation**: Only Brave Search documented; should add more APIs (GitHub, OpenAI, etc.)
2. **Package Documentation**: Limited list of recommended packages; could document more
3. **Error Handling**: Basic; could add retry logic, better error messages
4. **Observability**: Telemetry disabled (deprecated); relying on default observability only
5. **Memory Embeddings**: No embedder configured; semantic recall uses default (may need custom embedder for production)
6. **File Persistence**: Files only persist within a single execution; need mechanism for cross-execution file storage
7. **Dependency Caching**: npm install runs on every execution; E2B supports caching but not implemented

### Improvements Needed

1. **Documentation (System Prompt)**
   - Add more APIs: GitHub, OpenAI, Anthropic, etc.
   - Document more npm packages for common tasks
   - Include rate limits and error handling patterns
   - Add pagination examples
   - Document response schemas more thoroughly

2. **Security**
   - URL allowlist for `http.request`
   - Redact secrets in logs (currently just not printing them)
   - Block `child_process`, `eval`, raw sockets in sandbox
   - Add content scanning for sensitive data in outputs

3. **Agent Behavior**
   - Add reflection/retry on execution errors
   - Better prompt engineering for complex multi-step tasks
   - Add examples of good/bad code to system prompt

4. **Testing**
   - Unit tests for skills module
   - Integration tests for exec_ts tool
   - End-to-end tests for AC1-AC5
   - Performance benchmarks

5. **Developer Experience**
   - Add `pnpm run test` with actual tests (local dev uses pnpm, sandbox uses npm)
   - Add hot reload for agent code changes
   - Add interactive REPL mode
   - Better error messages from sandbox
   - Performance metrics already added (sandbox creation, install, execution times)

## Things That Went Wrong (Lessons Learned)

### Issue 1: Skills Module Over-Engineering

**Problem**: created abstraction layer with "skills" module that just wrapped fetch anyway  
**Solution**: removed skills injection; document apis in system prompt; let agent write raw fetch  
**Lesson**: provide knowledge/examples in prompt, not code abstractions. let the agent use native apis.

### Issue 2: Result Extraction

**Problem**: parsing json from stdout was fragile with mixed output  
**Solution**: instruct agent to output single json at end; use regex to extract  
**Lesson**: system prompt must be explicit about output format

### Issue 3: File Persistence

**Problem**: files written in sandbox weren't accessible across steps  
**Solution**: return files in tool output; agent must re-read via `fs.readFile`  
**Lesson**: sandbox is ephemeral; persistence requires explicit file tracking

### Issue 4: Secrets in Output

**Problem**: risk of agent printing env vars  
**Solution**: strong system prompt rule + redaction in logs  
**Lesson**: defense in depth: prevent generation + filter output

## State of the Project (Current)

**Status**: ✅ MVP Complete - User Story 001_seed implemented

### What's Working

- code agent generates valid typescript
- e2b sandbox executes code successfully
- secrets management via env vars
- file persistence across steps
- memory with automatic local/production switching
- conversation history with semantic recall
- performance metrics logging

### Next Steps (if continuing)

1. add proper search api (brave/perplexity)
2. add persistent kv store (redis/upstash)
3. add url allowlist for security
4. write comprehensive tests
5. improve error handling and retries

### Migration Notes for Future Agents

when taking over this project:

1. read this file first for context
2. check `docs/stories/` for original requirements
3. review `readme.md` for setup instructions
4. run `pnpm dev` and test via playground at http://localhost:4111
5. agent name is `agent0`, using openrouter model `x-ai/grok-code-fast-1`
6. system prompt in `agent0.ts` is critical - contains all api documentation
7. add new apis by documenting them in the prompt with examples

## Development Workflow

### Adding a New API

1. get api documentation (endpoints, auth, example responses)
2. add api section to agent system prompt in `agent0.ts`
3. include example typescript code (with fetch or recommended package like axios)
4. show example response structure
5. add api key pattern to env var passthrough in `exec_ts.ts` if needed
6. test with agent by asking it to use the new api

### Adding a New Recommended Package

1. add package to "recommended npm packages" section in system prompt
2. include brief description of what it's used for
3. optionally add example usage pattern
4. agent will automatically include it in `dependencies` array when needed

### Debugging Execution

1. check e2b sandbox logs (stdout/stderr in tool output)
2. verify api keys passed correctly via env vars
3. look for typescript compilation errors
4. validate json output format
5. check network requests in sandbox

### Modifying Agent Behavior

1. update system prompt in `agent0.ts`
2. test with simple example first
3. verify ac1-ac3 still pass
4. update context.md with changes

## Conventions Summary

### Code Style

- use typescript strict mode
- async/await for all i/o
- explicit error handling
- no `any` types without comment

### File Naming

- `kebab-case.ts` for files
- `pascalcase` for classes/interfaces
- `camelcase` for functions/variables

### Git Commits

- conventional commits format
- reference user story in commit message
- keep commits atomic and focused

### Documentation

- update context.md for architectural changes
- update readme.md for user-facing changes
- document "why" not just "what"

---

**last updated**: switched to openrouter/grok, switched to pnpm, lowercase all comments and logs  
**project phase**: mvp complete + memory + package support  
**next milestone**: add more api/package documentation, dependency caching, production hardening
