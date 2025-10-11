/**
 * Skills module - Host-provided APIs for sandboxed code
 * These functions are injected into the E2B sandbox as a virtual "skills" module
 */

export interface HttpRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * HTTP request shim - proxies through host
 */
export const http = {
  async request(req: HttpRequest): Promise<HttpResponse> {
    const response = await fetch(req.url, {
      method: req.method || "GET",
      headers: req.headers,
      body: req.body,
    });

    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    return {
      status: response.status,
      headers,
      body: await response.text(),
    };
  },
};

/**
 * Search shim - currently uses DuckDuckGo HTML scraping
 * In production, use a proper search API
 */
export const search = {
  async query(q: string): Promise<{ results: SearchResult[] }> {
    // Simple implementation - in production use a real search API
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
    const response = await fetch(url);
    const html = await response.text();

    // Basic HTML parsing - extract results
    const results: SearchResult[] = [];
    const resultRegex =
      /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g;
    const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([^<]*)<\/a>/g;

    let match;
    let count = 0;
    while ((match = resultRegex.exec(html)) && count < 10) {
      results.push({
        url: match[1],
        title: match[2],
        snippet: "",
      });
      count++;
    }

    return { results };
  },
};

/**
 * Key-Value store shim - in-memory for demo
 * In production, use Redis/DynamoDB/etc
 */
const kvStore = new Map<string, any>();

export const kv = {
  async get(key: string): Promise<any> {
    return kvStore.get(key);
  },

  async put(key: string, value: any): Promise<void> {
    kvStore.set(key, value);
  },
};

/**
 * File system shim - scoped to session
 * Files are tracked per-session and returned to host
 */
const sessionFiles = new Map<string, string>();

export const fs = {
  async readFile(path: string): Promise<string> {
    const content = sessionFiles.get(path);
    if (content === undefined) {
      throw new Error(`File not found: ${path}`);
    }
    return content;
  },

  async writeFile(path: string, content: string): Promise<void> {
    sessionFiles.set(path, content);
  },

  _getFiles(): Record<string, string> {
    return Object.fromEntries(sessionFiles);
  },

  _setFiles(files: Record<string, string>): void {
    sessionFiles.clear();
    for (const [path, content] of Object.entries(files)) {
      sessionFiles.set(path, content);
    }
  },
};

/**
 * Logging shim
 */
export const log = {
  info(...args: any[]): void {
    console.log("[SKILLS]", ...args);
  },

  error(...args: any[]): void {
    console.error("[SKILLS]", ...args);
  },
};
