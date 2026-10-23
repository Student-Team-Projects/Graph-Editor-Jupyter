// Writes THIRD_PARTY_LICENSES.txt next to the bundle. MIT and ISC (Cytoscape.js, d3) allow
// redistribution on condition that their copyright and licence text travel with every copy,
// and minifying strips them from widget.js. Run by `npm run build`, after esbuild wrote its
// metafile, so the list always matches what is actually bundled.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [metafile, output] = process.argv.slice(2);
const meta = JSON.parse(readFileSync(metafile, "utf8"));

const packages = new Set();
for (const input of Object.keys(meta.inputs)) {
  const match = input.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
  if (match) packages.add(match[1]);
}

const sections = [...packages].sort().map((name) => {
  const dir = join("node_modules", name);
  const { version, license } = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const file = readdirSync(dir).find((f) => /^licen[cs]e(\.md|\.txt)?$/i.test(f));
  if (!file || !existsSync(join(dir, file))) throw new Error(`${name} has no licence file to include`);
  const text = readFileSync(join(dir, file), "utf8").trim();
  return `${name} ${version} (${license})\n${"-".repeat(60)}\n${text}\n`;
});

const header =
  "widget.js bundles the following third-party packages. Their licences are reproduced below,\n" +
  "as they require.\n\n";
writeFileSync(output, header + sections.join("\n"));
console.log(`THIRD_PARTY_LICENSES.txt: ${[...packages].sort().join(", ")}`);
