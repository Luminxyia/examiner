import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const vault = process.argv[2];
if (!vault) {
	console.error('Usage: npm run install-plugin -- "<path to vault>"');
	process.exit(1);
}
if (!existsSync(vault)) {
	console.error(`No folder at ${vault}`);
	process.exit(1);
}
if (!existsSync("main.js")) {
	console.error("main.js is missing. Run npm run build first.");
	process.exit(1);
}

const { id } = JSON.parse(readFileSync("manifest.json", "utf8"));
const target = join(vault, ".obsidian", "plugins", id);
mkdirSync(target, { recursive: true });
for (const file of ["main.js", "manifest.json", "styles.css"]) copyFileSync(file, join(target, file));
console.log(`Installed ${id} in ${target}`);
