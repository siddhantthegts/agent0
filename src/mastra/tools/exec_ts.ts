import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { Sandbox } from "@e2b/code-interpreter";

export interface ExecResult {
  stdout: string;
  stderr: string;
  files?: Record<string, string>;
  result?: any;
  error?: string;
}

/**
 * exec_ts - The ONE tool for code execution
 * Runs TypeScript in E2B sandbox with npm packages installed on demand
 */
export const exec_ts = createTool({
  id: "exec_ts",
  description:
    "Execute TypeScript code in an E2B sandbox. Specify npm dependencies to install. API keys accessible via process.env. Always output result as JSON.stringify() to stdout.",
  inputSchema: z.object({
    code: z.string().describe("Complete TypeScript program to execute"),
    dependencies: z
      .array(z.string())
      .optional()
      .describe(
        "NPM packages to install before execution (e.g., ['axios', 'cheerio'])"
      ),
    files: z
      .record(z.string())
      .optional()
      .describe("Files to make available in the sandbox"),
    args: z
      .any()
      .optional()
      .describe("Arguments to pass to the program via process.argv"),
  }),
  outputSchema: z.object({
    stdout: z.string(),
    stderr: z.string(),
    files: z.record(z.string()).optional(),
    result: z.any().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ context }) => {
    return await executeTypeScript(
      context.code,
      context.dependencies,
      context.files,
      context.args
    );
  },
});

/**
 * Core execution function
 * Creates E2B sandbox, installs dependencies, runs code, captures output
 */
async function executeTypeScript(
  code: string,
  dependencies?: string[],
  files?: Record<string, string>,
  args?: any
): Promise<ExecResult> {
  let sbx: Sandbox | null = null;

  // Log the full tool call for debugging
  console.log("\n=== EXEC_TS TOOL CALL ===");
  console.log("Dependencies:", dependencies || "none");
  console.log("Files:", files ? Object.keys(files) : "none");
  console.log("Args:", args || "none");
  console.log("Code:\n", code);
  console.log("========================\n");

  try {
    // Create E2B sandbox with timeout
    sbx = await Sandbox.create({
      timeoutMs: 30000, // 30s hard limit (increased for npm install)
    });

    // Install npm dependencies if provided
    if (dependencies && dependencies.length > 0) {
      const packages = dependencies.join(" ");
      await sbx.commands.run(`npm install ${packages}`);
    }

    // Write any provided files
    if (files) {
      for (const [path, content] of Object.entries(files)) {
        await sbx.files.write(`/home/user/${path}`, content);
      }
    }

    // Inject env vars (API keys and secrets)
    const envVars: Record<string, string> = {};

    // Pass through API keys and base URLs
    for (const [key, value] of Object.entries(process.env)) {
      if (
        key.endsWith("_API_KEY") ||
        key.startsWith("API_KEY_") ||
        key.startsWith("BASE_URL_")
      ) {
        envVars[key] = value || "";
      }
    }

    // Inject args if provided
    if (args) {
      envVars.ARGS_JSON = JSON.stringify(args);
    }

    // Execute the TypeScript code
    const execution = await sbx.runCode(code, {
      language: "ts",
      envs: envVars,
    });

    // Collect stdout/stderr
    const stdout = execution.logs.stdout.join("");
    const stderr = execution.logs.stderr.join("");

    // Try to extract result from stdout (expecting JSON)
    let result: any = undefined;
    let error: string | undefined = execution.error
      ? JSON.stringify(execution.error, null, 2)
      : undefined;

    try {
      // Look for JSON in stdout
      const jsonMatch = stdout.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      // Not JSON, that's okay
    }

    // Read back any files that were written (exclude system/npm files)
    const outputFiles: Record<string, string> = {};
    const excludeFiles = [
      ".bashrc",
      ".bash_logout",
      ".profile",
      "package.json",
      "package-lock.json",
    ];

    // List files in working directory
    try {
      const fileList = await sbx.files.list("/home/user");
      for (const file of fileList) {
        if (
          file.type === "file" &&
          !file.name.endsWith(".ts") &&
          !excludeFiles.includes(file.name)
        ) {
          const content = await sbx.files.read(`/home/user/${file.name}`);
          outputFiles[file.name] = content;
        }
      }
    } catch (e) {
      // Ignore file listing errors
    }

    return {
      stdout,
      stderr,
      files: Object.keys(outputFiles).length > 0 ? outputFiles : undefined,
      result,
      error,
    };
  } catch (err: any) {
    return {
      stdout: "",
      stderr: err.message || "Unknown error",
      error: err.message || "Unknown error",
    };
  } finally {
    // Always kill sandbox
    if (sbx) {
      await sbx.kill();
    }
  }
}
