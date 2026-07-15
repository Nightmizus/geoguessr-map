import { copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "dist");
const runtimeFiles = [
  "index.html",
  "assets/vendor/d3.v7.min.js",
  "data/generated/plonkit_geo_data.js",
  "data/generated/plonkit_page_data.js",
  "data/generated/plonkit_image_selections.js",
];

await rm(output, { recursive: true, force: true });

for (const relativePath of runtimeFiles) {
  const sourcePath = path.join(root, relativePath);
  const outputPath = path.join(output, relativePath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await copyFile(sourcePath, outputPath);
}

console.log(`Built geoguessr-map with ${runtimeFiles.length} files in ${output}`);
