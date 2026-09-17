import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  clean: true,
  noExternal: ["@agentinfra/mcp", "@papers.bot/sdk", "@agentinfra/contracts"],
});
