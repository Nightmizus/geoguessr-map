import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "data", "source", "china_datav_100000_full.json");
const output = path.join(root, "data", "generated", "plonkit_china_geo_data.js");
const geo = JSON.parse(await readFile(source, "utf8"));

await writeFile(output, `window.PLONKIT_CHINA_GEO = ${JSON.stringify(geo)};\n`, "utf8");
console.log(`Generated ${path.relative(root, output)} with ${geo.features?.length || 0} features`);
