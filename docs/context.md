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

1. **Code Agent** (`src/mastra/agents/code-agent.ts`)
   - Groq LLM (openai/gpt-oss-20b)
   - System prompt with strict rules (no prose, only TS)
   - Single tool: `execTsTool`
   - Memory: LibSQL (local dev) or Postgres (production)

2. **exec_ts Tool** (`src/mastra/tools/exec-ts-tool.ts`)
   - Creates E2B sandbox per execution
   - Installs npm dependencies on demand (e.g., `["axios", "cheerio"]`)
   - Mounts user files if provided
   - Passes API keys via env vars (any key ending in `_API_KEY` or starting with `API_KEY_` or `BASE_URL_`)
   - Executes TypeScript with Node.js runtime
   - Captures stdout/stderr, extracts JSON result
   - Returns `{ stdout, stderr, files, result, error }`
   - Timeout: 30s (includes npm install time)

3. **System Prompt** (`src/mastra/agents/code-agent.ts`)
   - Documents exec_ts parameters (code, dependencies, files, args)
   - Lists recommended npm packages (axios, cheerio, zod, etc.)
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

**NPM Packages:**

- HTTP: `axios`, native fetch
- Scraping: `cheerio`, `jsdom`
- Data: `zod`, `csv-parse`, `xml2js`
- Utils: `date-fns`, `lodash`

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
│   │   │   └── code-agent.ts   # Main agent (system prompt with API docs)
│   │   ├── tools/
│   │   │   └── exec-ts-tool.ts # E2B wrapper
│   │   ├── skills/
│   │   │   └── index.ts        # DEPRECATED - not used anymore
│   │   └── index.ts            # Mastra config
│   └── demo.ts                 # AC1-AC3 tests
├── package.json
├── README.md
└── .env.example                # Required env vars
```

**Note**: The `skills/` directory is kept for reference but no longer used. Agent writes raw fetch calls instead of importing skill abstractions.

## Dependencies

### Core

- `@mastra/core` - Agent framework
- `@ai-sdk/groq` - LLM provider
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
E2B_API_KEY=...        # E2B sandbox API key
GROQ_API_KEY=...       # Groq LLM API key
NODE_ENV=development   # Environment (development/production)
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
7. ✅ Demo script testing AC1-AC3
8. ✅ Agent memory with LibSQL (local) / Postgres (production)
9. ✅ Semantic recall for conversation context

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
   - Add `npm run test` with actual tests
   - Add hot reload for agent code changes
   - Add interactive REPL mode
   - Better error messages from sandbox

## Things That Went Wrong (Lessons Learned)

### Issue 1: Skills Module Over-Engineering

**Problem**: Created abstraction layer with "skills" module that just wrapped fetch anyway  
**Solution**: Removed skills injection; document APIs in system prompt; let agent write raw fetch  
**Lesson**: Provide knowledge/examples in prompt, not code abstractions. Let the agent use native APIs.

### Issue 2: Result Extraction

**Problem**: Parsing JSON from stdout was fragile with mixed output  
**Solution**: Instruct agent to output single JSON at end; use regex to extract  
**Lesson**: System prompt must be explicit about output format

### Issue 3: File Persistence

**Problem**: Files written in sandbox weren't accessible across steps  
**Solution**: Return files in tool output; agent must re-read via `fs.readFile`  
**Lesson**: Sandbox is ephemeral; persistence requires explicit file tracking

### Issue 4: Secrets in Output

**Problem**: Risk of agent printing env vars  
**Solution**: Strong system prompt rule + redaction in logs  
**Lesson**: Defense in depth: prevent generation + filter output

## State of the Project (Current)

**Status**: ✅ MVP Complete - User Story 001_seed implemented

### What's Working

- Code agent generates valid TypeScript
- E2B sandbox executes code successfully
- Skills module provides HTTP, search, KV, FS, logging
- Demo script validates AC1-AC3
- Secrets management via env vars
- File persistence across steps
- Memory with automatic local/production switching
- Conversation history with semantic recall

### Next Steps (if continuing)

1. Add proper search API (Brave/Perplexity)
2. Add persistent KV store (Redis/Upstash)
3. Add URL allowlist for security
4. Write comprehensive tests
5. Add more example tasks to demo
6. Improve error handling and retries

### Migration Notes for Future Agents

When taking over this project:

1. Read this file first for context
2. Check `docs/stories/` for original requirements
3. Review `README.md` for setup instructions
4. Run `npm run demo` to verify working state
5. Agent name is `agent0`, using Groq model `openai/gpt-oss-20b`
6. System prompt in `code-agent.ts` is critical - contains all API documentation
7. Add new APIs by documenting them in the prompt with examples

## Development Workflow

### Adding a New API

1. Get API documentation (endpoints, auth, example responses)
2. Add API section to agent system prompt in `code-agent.ts`
3. Include example TypeScript code (with fetch or recommended package like axios)
4. Show example response structure
5. Add API key pattern to env var passthrough in `exec-ts-tool.ts` if needed
6. Test with agent by asking it to use the new API

### Adding a New Recommended Package

1. Add package to "Recommended NPM Packages" section in system prompt
2. Include brief description of what it's used for
3. Optionally add example usage pattern
4. Agent will automatically include it in `dependencies` array when needed

### Debugging Execution

1. Check E2B sandbox logs (stdout/stderr in tool output)
2. Verify API keys passed correctly via env vars
3. Look for TypeScript compilation errors
4. Validate JSON output format
5. Check network requests in sandbox

### Modifying Agent Behavior

1. Update system prompt in `code-agent.ts`
2. Test with simple example first
3. Verify AC1-AC3 still pass
4. Update context.md with changes

## Conventions Summary

### Code Style

- Use TypeScript strict mode
- Async/await for all I/O
- Explicit error handling
- No `any` types without comment

### File Naming

- `kebab-case.ts` for files
- `PascalCase` for classes/interfaces
- `camelCase` for functions/variables

### Git Commits

- Conventional commits format
- Reference user story in commit message
- Keep commits atomic and focused

### Documentation

- Update context.md for architectural changes
- Update README.md for user-facing changes
- Document "why" not just "what"

---

**Last Updated**: Added npm dependency support - agent can use any package, documented in prompt  
**Project Phase**: MVP Complete + Memory + Package Support  
**Next Milestone**: Add more API/package documentation, dependency caching, production hardening
