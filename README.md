![agent0 banner](public/agent0_banner.jpg)

agent0 interacts with the world using one universal tool to rule them all: code.

the concrete tool is `exec_ts` and it can be used like this:

- agent0 (`x-ai/grok-code-fast-1`) writes code in typescript on the fly to provide an answer to what ever prompt is given
- the tool `exec_ts` runs the generated code in a e2b sandbox & provides the result back to the agent
- agent0 can self-heal on errors, as it just fixes the code and runs `exec_ts` again
- we define the context like apis to use (for example: `use google rss for news`)

this is a foundation. take it, adapt it, make it yours.

inspired by [theo's video](https://www.youtube.com/watch?v=bAYZjVAodoo) on [Cloudflare's "code mode"](https://blog.cloudflare.com/code-mode/).

## setup

**1. install dependencies**

```bash
pnpm install
```

**2. get API keys and configure**

```bash
cp .env.example .env
```

edit `.env` and add your keys:

**required:**

- `E2B_API_KEY` - create account at https://e2b.dev (free tier: 500 executions/month)
- `OPENROUTER_API_KEY` - create account at https://openrouter.ai (pay per use, ~$0.10/1M tokens for grok-code-fast-1)

**optional:**

- `BRAVE_API_KEY` - create account at https://brave.com/search/api (free: 2000 queries/month)

**3. start dev server**

```bash
pnpm dev
```

launches Mastra with agent0

**4. chat with agent0**

open playground at http://localhost:4111, select agent0, start chatting.

**try these prompts:**

- "give me the top 5 news from germany today and the weather in berlin"

## APIs

(adapt these)

we include these as examples to show you how it works. replace them with APIs your agent needs:

- **Google News RSS** - https://news.google.com/rss (free, no key)
- **Brave Search** - https://brave.com/search/api (requires BRAVE_API_KEY)
- **Open-Meteo Weather** - https://open-meteo.com (free, no key)

**to add your own**: open `src/mastra/agents/agent0.ts`, scroll to the API section in the prompt, add:

```
### Your API Name
**Endpoint**: https://your-api.com/endpoint?param={value}
**Auth**: Header "Authorization: Bearer {YOUR_API_KEY}" (if needed)
**Returns**: { data: { field1, field2 } }
```

agent reads this, understands the API, writes code to use it. no code changes needed on our side. so provide the stuff that you think is the most important.

> [!TIP]
> if it still does not work, then provide all the context for the given thing it is not doing correctly or switch to a smarter model.

## reusable utilities

(optional)

if you have domain-specific helpers that the agent uses repeatedly (data schemas, validators, parsers), mount them instead of having the agent rewrite them every time:

**1. create** `utils/validators.ts`:

```typescript
export function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
```

**2. mount when calling tool**:

```typescript
import fs from "fs";
import { execTsTool } from "./mastra/tools/exec_ts.js";

const validators = fs.readFileSync("utils/validators.ts", "utf-8");

await execTsTool.execute({
  context: {
    code: `
      import { validateEmail } from "./validators.ts";
      console.log(JSON.stringify({ 
        ok: true, 
        data: { valid: validateEmail("test@example.com") }
      }));
    `,
    files: { "validators.ts": validators },
  },
});
```

saves tokens, keeps logic consistent across calls.

---

**this is your foundation. build on it.**

want different APIs? edit the prompt.  
want different model? change one line.  
want custom utilities? mount your files.
