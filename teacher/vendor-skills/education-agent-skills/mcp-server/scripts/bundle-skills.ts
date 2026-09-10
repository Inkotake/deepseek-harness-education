/**
 * Pre-parses all skill markdown files and writes a single skills.json
 * for use by the Vercel serverless function (which can't read the parent repo at runtime).
 */
import { resolve, dirname } from "node:path";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadSkills } from "../src/skill-loader.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIBRARY_ROOT = resolve(__dirname, "../..");
const OUTPUT = resolve(__dirname, "../src/skills.json");

async function main() {
  const skills = await loadSkills(LIBRARY_ROOT);
  // Strip filePath (not meaningful at runtime on Vercel)
  const serializable = skills.map(({ filePath, ...rest }) => rest);
  await writeFile(OUTPUT, JSON.stringify(serializable, null, 2));
  console.log(`Bundled ${skills.length} skills into ${OUTPUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
