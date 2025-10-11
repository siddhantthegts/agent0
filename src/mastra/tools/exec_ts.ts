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
 * exec_ts - the one tool for code execution
 * runs typescript in e2b sandbox with npm packages installed on demand
 */
export const exec_ts = createTool({
  id: "exec_ts",
  description:
    "execute typescript code in an e2b sandbox. specify npm dependencies to install. api keys accessible via process.env. always output result as json.stringify() to stdout.",
  inputSchema: z.object({
    code: z.string().describe("complete typescript program to execute"),
    dependencies: z
      .array(z.string())
      .optional()
      .describe(
        "npm packages to install before execution (e.g., ['axios', 'cheerio'])"
      ),
    files: z
      .record(z.string())
      .optional()
      .describe("files to make available in the sandbox"),
    args: z
      .any()
      .optional()
      .describe("arguments to pass to the program via process.argv"),
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
 * core execution function
 * creates e2b sandbox, installs dependencies, runs code, captures output
 */
async function executeTypeScript(
  code: string,
  dependencies?: string[],
  files?: Record<string, string>,
  args?: any
): Promise<ExecResult> {
  let sbx: Sandbox | null = null;
  const startTime = Date.now();

  // log tool call summary
  console.log("\n=== exec_ts call ===");
  console.log("dependencies:", dependencies || "none");
  console.log("files:", files ? Object.keys(files) : "none");
  console.log("args:", args || "none");
  console.log("========================\n");

  try {
    // create e2b sandbox with timeout
    const sandboxStartTime = Date.now();
    sbx = await Sandbox.create({
      timeoutMs: 30000, // 30s hard limit (increased for npm install)
    });
    const sandboxDuration = Date.now() - sandboxStartTime;
    console.log(`sandbox created in ${sandboxDuration}ms`);

    // install dependencies if provided (using npm - e2b sandboxes have npm by default)
    if (dependencies && dependencies.length > 0) {
      const installStartTime = Date.now();
      const packages = dependencies.join(" ");
      await sbx.commands.run(`npm install ${packages}`);
      const installDuration = Date.now() - installStartTime;
      console.log(`dependencies installed in ${installDuration}ms`);
    }

    // write any provided files
    if (files) {
      for (const [path, content] of Object.entries(files)) {
        await sbx.files.write(`/home/user/${path}`, content);
      }
    }

    // inject env vars (api keys and secrets)
    const envVars: Record<string, string> = {};

    // pass through api keys and base urls
    for (const [key, value] of Object.entries(process.env)) {
      if (
        key.endsWith("_API_KEY") ||
        key.startsWith("API_KEY_") ||
        key.startsWith("BASE_URL_")
      ) {
        envVars[key] = value || "";
      }
    }

    // inject args if provided
    if (args) {
      envVars.ARGS_JSON = JSON.stringify(args);
    }

    // execute the typescript code
    const execStartTime = Date.now();
    const execution = await sbx.runCode(code, {
      language: "ts",
      envs: envVars,
    });
    const execDuration = Date.now() - execStartTime;
    console.log(`code executed in ${execDuration}ms`);

    // collect stdout/stderr
    const stdout = execution.logs.stdout.join("");
    const stderr = execution.logs.stderr.join("");

    // try to extract result from stdout (expecting json)
    let result: any = undefined;
    let error: string | undefined = execution.error
      ? JSON.stringify(execution.error, null, 2)
      : undefined;

    try {
      // look for json in stdout
      const jsonMatch = stdout.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      // not json, that's okay
    }

    // read back any files that were written (exclude system/npm files)
    const outputFiles: Record<string, string> = {};
    const excludeFiles = [
      ".bashrc",
      ".bash_logout",
      ".profile",
      "package.json",
      "package-lock.json",
    ];

    // list files in working directory
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
      // ignore file listing errors
    }

    const totalDuration = Date.now() - startTime;
    console.log(`total execution time: ${totalDuration}ms\n`);

    return {
      stdout,
      stderr,
      files: Object.keys(outputFiles).length > 0 ? outputFiles : undefined,
      result,
      error,
    };
  } catch (err: any) {
    const totalDuration = Date.now() - startTime;
    console.log(`total execution time (error): ${totalDuration}ms\n`);

    return {
      stdout: "",
      stderr: err.message || "unknown error",
      error: err.message || "unknown error",
    };
  } finally {
    // always kill sandbox
    if (sbx) {
      await sbx.kill();
    }
  }
}
