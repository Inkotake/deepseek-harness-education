#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRequire } from "node:module";
import type { LoadedSkill } from "./types.js";
import { createServer } from "./server.js";

const require = createRequire(import.meta.url);
const skills = require("./skills.json") as LoadedSkill[];

async function main() {
  const server = createServer(skills);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});
