import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "dist");
const dataFiles = [
  "data/generated/plonkit_geo_data.js",
  "data/generated/plonkit_china_geo_data.js",
  "data/generated/plonkit_china_page_data.js",
  "data/generated/plonkit_page_data.js",
  "data/generated/plonkit_image_selections.js",
];
const runtimeFiles = [
  "assets/vendor/d3.v7.min.js",
  "assets/cache-policy.js",
  ...dataFiles,
];

await rm(output, { recursive: true, force: true });

const dataHash = createHash("sha256");
for (const relativePath of dataFiles) {
  dataHash.update(relativePath);
  dataHash.update("\0");
  dataHash.update(await readFile(path.join(root, relativePath)));
  dataHash.update("\0");
}
const dataVersion = dataHash.digest("hex").slice(0, 24);

let indexHtml = await readFile(path.join(root, "index.html"), "utf8");
if (!indexHtml.includes("__PLONKIT_DATA_VERSION__")) {
  throw new Error("index.html is missing the data-version build placeholder");
}
indexHtml = indexHtml.replaceAll("__PLONKIT_DATA_VERSION__", dataVersion);
for (const relativePath of ["assets/cache-policy.js", ...dataFiles]) {
  indexHtml = indexHtml.replaceAll(`src="${relativePath}"`, `src="${relativePath}?v=${dataVersion}"`);
}
await mkdir(output, { recursive: true });
await writeFile(path.join(output, "index.html"), indexHtml);

for (const relativePath of runtimeFiles) {
  const sourcePath = path.join(root, relativePath);
  const outputPath = path.join(output, relativePath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await copyFile(sourcePath, outputPath);
}

console.log(`Built geoguessr-map with ${runtimeFiles.length + 1} files in ${output} (data version ${dataVersion})`);
