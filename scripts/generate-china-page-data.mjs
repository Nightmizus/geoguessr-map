import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const guidePath = path.join(ROOT, "data", "source", "china_province_guides.json");
const crawlPath = path.join(ROOT, "data", "source", "china_tutorial_pages.json");
const outputPath = path.join(ROOT, "data", "generated", "plonkit_china_page_data.js");

const guides = JSON.parse(await fs.readFile(guidePath, "utf8"));
const crawl = JSON.parse(await fs.readFile(crawlPath, "utf8"));
const sourceBySlug = new Map(crawl.pages.map(page => [page.slug, page]));
// Curated articles always win when both curated and community tutorials exist.
const featuredSourceByAdcode = new Map([
  ["120000", "tianjin"],
  ["140000", "shanxi"],
  ["150000", "neimenggu"],
  ["220000", "jilin"],
  ["420000", "hubei"],
  ["450000", "guangxi"],
  ["530000", "yunnan"],
  ["650000", "xinjiang"],
]);
const friendSourcesByAdcode = new Map([
  ["130000", ["hebei"]],
  ["310000", ["shanghai", "chongming"]],
  ["350000", ["fujian"]],
  ["430000", ["hunan_sidelines"]],
  ["460000", ["hainan_is_in_sv"]],
  ["500000", ["chongqing", "a_deconstructed_chongqing"]],
  ["510000", ["ganzi"]],
  ["540000", ["xizang"]],
  ["810000", ["hongkong_extension"]],
]);

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function list(items) {
  return `<ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function guideContent(guide, sourcePages) {
  const sourceLinks = sourcePages.map(page => `<li><a href="${escapeHtml(page.sourceUrl)}">${escapeHtml(page.title)}</a>（${escapeHtml(page.section)}）</li>`).join("");
  return [
    "<!doctype lake>",
    `<p><strong>快速判断：</strong>${escapeHtml(guide.summary)}</p>`,
    "<h2>自然环境与聚落</h2>",
    list(guide.landscape),
    "<h2>文字与交通线索</h2>",
    `<p><strong>行政中心：</strong>${escapeHtml(guide.capital)}　<strong>常见电话区号：</strong>${escapeHtml(guide.areaCode)}</p>`,
    list(guide.clues),
    "<h2>区内拆分</h2>",
    list(guide.regions),
    "<h2>误判提醒</h2>",
    `<p>${escapeHtml(guide.caution)}</p>`,
    "<h2>本页资料来源</h2>",
    "<p>本页不是原文摘抄，而是将下列语雀教程中的可复用线索按省级行政区重新归纳。道路设施、出租车涂装和街景覆盖会随时间变化，实战时应以文字、车牌、区号等多条证据交叉确认。</p>",
    `<ul>${sourceLinks}</ul>`,
  ].join("");
}

const provincePages = guides.guides.map(guide => {
  const sourcePages = guide.sources.map(slug => {
    const page = sourceBySlug.get(slug);
    if (!page) throw new Error(`Unknown source slug ${slug} for ${guide.name}`);
    return {
      slug,
      title: page.title,
      section: page.section,
      sourceUrl: page.sourceUrl,
      contentUpdatedAt: page.yuque.contentUpdatedAt,
    };
  });
  const featuredSource = featuredSourceByAdcode.get(guide.adcode);
  const friendSource = friendSourcesByAdcode.get(guide.adcode)?.[0];
  const originalSource = featuredSource || friendSource;
  const originalPage = originalSource ? sourceBySlug.get(originalSource) : null;
  if (originalSource && !originalPage) {
    throw new Error(`Unknown original source slug ${originalSource} for ${guide.name}`);
  }
  const content = originalPage?.content ?? guideContent(guide, sourcePages);
  const latestUpdate = sourcePages.map(page => page.contentUpdatedAt || "").sort().at(-1) || null;
  return {
    guideType: "china-province",
    adcode: guide.adcode,
    title: guide.name,
    slug: `china-province-${guide.adcode}`,
    section: originalPage ? `中国教程 / ${originalPage.section}` : "中国教程 / 省级指南",
    sourceUrl: originalPage?.sourceUrl ?? guides.source,
    sourceKind: featuredSource ? "精选篇目" : friendSource ? "寻友教程" : "整理版",
    originalSourceSlug: originalPage?.slug ?? null,
    sourcePages,
    yuque: originalPage?.yuque ?? {
      wordCount: content.replace(/<[^>]+>/g, "").length,
      format: "lake",
      contentUpdatedAt: latestUpdate,
    },
    content,
    text: originalPage?.text ?? content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
    images: originalPage?.images ?? [],
    status: "ok",
  };
});

// A province can have more than one community article (for example Shanghai plus
// Chongming). Keep the broad province article first and expose the remaining exact
// originals as tabs on the same province. A curated article suppresses all community
// tabs for that province, preserving the requested curated-over-community priority.
const additionalFriendPages = guides.guides.flatMap(guide => {
  if (featuredSourceByAdcode.has(guide.adcode)) return [];
  return (friendSourcesByAdcode.get(guide.adcode) || []).slice(1).map(slug => {
    const sourcePage = sourceBySlug.get(slug);
    if (!sourcePage) throw new Error(`Unknown additional friend source slug ${slug} for ${guide.name}`);
    return {
      ...sourcePage,
      guideType: "china-province",
      adcode: guide.adcode,
      title: sourcePage.title,
      section: `中国教程 / ${sourcePage.section}`,
      sourceKind: "寻友教程",
      originalSourceSlug: sourcePage.slug,
      sourcePages: [{
        slug: sourcePage.slug,
        title: sourcePage.title,
        section: sourcePage.section,
        sourceUrl: sourcePage.sourceUrl,
        contentUpdatedAt: sourcePage.yuque.contentUpdatedAt,
      }],
    };
  });
});

const pages = [...provincePages, ...additionalFriendPages];
const adcodePages = Object.fromEntries(guides.guides.map(guide => [
  guide.adcode,
  pages.filter(page => page.adcode === guide.adcode).map(page => page.slug),
]));

const output = {
  source: guides.source,
  basedOnCrawlAt: crawl.crawledAt,
  tocUpdatedAt: crawl.tocUpdatedAt,
  count: pages.length,
  provinceCount: guides.guides.length,
  adcodePages,
  pages,
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `window.PLONKIT_CHINA_PAGES = ${JSON.stringify(output)};\n`, "utf8");
console.log(`Generated ${pages.length} China province pages in ${outputPath}`);
