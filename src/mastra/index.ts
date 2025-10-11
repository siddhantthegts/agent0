import { Mastra } from "@mastra/core/mastra";
import { PinoLogger } from "@mastra/loggers";
import { LibSQLStore } from "@mastra/libsql";
import { agent0 } from "./agents/agent0.js";

export const mastra = new Mastra({
  agents: { agent0 },
  storage: new LibSQLStore({
    // stores observability, scores, ... into memory storage, if it needs to persist, change to file:../mastra.db
    url: ":memory:",
  }),
  logger: new PinoLogger({
    name: "Mastra",
    level: "info",
  }),
  telemetry: {
    // telemetry is deprecated and will be removed in the nov 4th release
    enabled: false,
  },
  observability: {
    // enables defaultexporter and cloudexporter for ai tracing
    default: { enabled: true },
  },
});
