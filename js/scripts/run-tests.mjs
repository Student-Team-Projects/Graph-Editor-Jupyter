// Runs the compiled tests: node scripts/run-tests.mjs <dir>. Used by `npm test`.
//
// `node --test <dir>` only works on Node 20 and older: from Node 22 the arguments are files or
// globs, so a directory fails with "Cannot find module". Globs in turn need Node 21+, and the
// shell can't expand them for us on Windows. Listing the files here works on every Node 18+.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const [dir] = process.argv.slice(2);
const files = readdirSync(dir)
  .filter((name) => name.endsWith(".mjs"))
  .sort()
  .map((name) => join(dir, name));
if (files.length === 0) {
  console.error(`No tests found in ${dir}`);
  process.exit(1);
}
const { status } = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exit(status ?? 1);
