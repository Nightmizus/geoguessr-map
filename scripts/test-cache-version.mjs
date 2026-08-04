import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const policySource = await readFile(new URL("../assets/cache-policy.js", import.meta.url), "utf8");
const builtIndex = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
const context = vm.createContext({});
vm.runInContext(policySource, context);
const { normalizeLayoutCache, normalizeRenderCache } = context.PLONKIT_CACHE_POLICY;

const oldVersion = "old-data";
const currentVersion = builtIndex.match(/const DATA_VERSION = "([a-f0-9]+)";/)?.[1];
assert.ok(currentVersion, "构建产物必须注入数据内容版本");
assert.match(
  builtIndex,
  new RegExp(`src="data/generated/plonkit_page_data\\.js\\?v=${currentVersion}"`),
  "数据脚本 URL 必须绑定当前数据内容版本",
);
const storedProfile = {
  name: "我的 Profile",
  scope: "china",
  showLanguagePatterns: false,
  showLeftDriveColors: true,
  selections: { japan: [1, 3] },
  fadedFeatures: ["JPN"],
  layoutCache: {
    JPN: {
      dataVersion: oldVersion,
      signature: "old-layout",
      photos: [{ src: "old.png", x: 1, y: 2, width: 3, height: 4 }],
    },
  },
  renderCache: {
    dataVersion: oldVersion,
    signature: "old-render",
    html: "<g id=\"old\"></g>",
  },
};

const restored = {
  ...storedProfile,
  layoutCache: normalizeLayoutCache(storedProfile.layoutCache, currentVersion),
  renderCache: normalizeRenderCache(storedProfile.renderCache, currentVersion),
};

assert.deepEqual(Object.keys(restored.layoutCache), [], "旧数据版本的布局缓存必须失效");
assert.equal(restored.renderCache, null, "旧数据版本的渲染 HTML 缓存必须失效");
assert.equal(restored.name, storedProfile.name);
assert.equal(restored.scope, storedProfile.scope);
assert.equal(restored.showLanguagePatterns, storedProfile.showLanguagePatterns);
assert.deepEqual(restored.selections, storedProfile.selections);
assert.deepEqual(restored.fadedFeatures, storedProfile.fadedFeatures);

const freshLayout = {
  JPN: {
    dataVersion: currentVersion,
    signature: "new-layout",
    photos: [{ src: "new.png", x: 1, y: 2, width: 3, height: 4 }],
  },
};
assert.deepEqual(Object.keys(normalizeLayoutCache(freshLayout, currentVersion)), ["JPN"]);
assert.equal(normalizeRenderCache({
  dataVersion: currentVersion,
  signature: "new-render",
  html: "<g></g>",
}, currentVersion)?.html, "<g></g>");

console.log("Cache version mismatch invalidates derived caches and preserves user settings.");
