import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSkills } from "./skill-loader.js";
import { createServer } from "./server.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIBRARY_ROOT = resolve(__dirname, "../..");

async function main() {
  const skills = await loadSkills(LIBRARY_ROOT);
  console.error(`Loaded ${skills.length} skills from ${LIBRARY_ROOT}`);

  const server = createServer(skills);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
