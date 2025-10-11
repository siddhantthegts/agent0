/**
 * Demo script for Code Agent
 * Tests AC1-AC3 from user story
 */

import { randomUUID } from "crypto";
import { mastra } from "./mastra/index.js";

async function demo() {
  console.log("=== Code Agent Demo ===\n");

  const agent = mastra.getAgent("agent0");
  if (!agent) {
    throw new Error("Code agent not found");
  }

  // Memory configuration - thread for this conversation, resource for the user
  const threadId = randomUUID();
  const resourceId = "demo-user";
  console.log(`Thread ID: ${threadId}\n`);

  // AC1: Fetch top posts from an API and summarize
  console.log("--- AC1: Fetch API data and summarize ---");
  try {
    const response = await agent.generate(
      [
        {
          role: "user",
          content:
            "Fetch the top 5 posts from JSONPlaceholder (https://jsonplaceholder.typicode.com/posts) and create a summary with titles and word counts.",
        },
      ],
      {
        threadId,
        resourceId,
      }
    );

    console.log("Agent Response:");
    console.log(response.text);
    console.log("\n");
  } catch (err: any) {
    console.error("AC1 Error:", err.message);
  }

  // AC2: Self-create a helper and reuse it
  console.log("--- AC2: Create helper function and reuse ---");
  try {
    const response1 = await agent.generate(
      [
        {
          role: "user",
          content:
            'Create a helper function called extractDomain that extracts the domain from a URL (e.g., "https://example.com/path" -> "example.com"). Test it with 3 URLs and save the function to a file called "helpers.ts" using fs.writeFile.',
        },
      ],
      {
        threadId,
        resourceId,
      }
    );

    console.log("Step 1 - Create helper:");
    console.log(response1.text);
    console.log("\n");

    const response2 = await agent.generate(
      [
        {
          role: "user",
          content:
            'Read the extractDomain function from helpers.ts and use it to extract domains from these URLs: ["https://github.com/mastra/core", "https://docs.mastra.ai/guide", "https://e2b.dev/docs"]. Return the results as JSON.',
        },
      ],
      {
        threadId,
        resourceId,
      }
    );

    console.log("Step 2 - Reuse helper:");
    console.log(response2.text);
    console.log("\n");
  } catch (err: any) {
    console.error("AC2 Error:", err.message);
  }

  // AC3: Verify secrets are not printed
  console.log("--- AC3: Verify secrets not printed ---");
  try {
    const response = await agent.generate(
      [
        {
          role: "user",
          content:
            "List all environment variables that start with API_KEY_ or BASE_URL_ (without printing their values), and confirm that secrets are available but not exposed.",
        },
      ],
      {
        threadId,
        resourceId,
      }
    );

    console.log("Agent Response:");
    console.log(response.text);
    console.log("\n");
  } catch (err: any) {
    console.error("AC3 Error:", err.message);
  }

  console.log("=== Demo Complete ===");
}

demo().catch(console.error);
