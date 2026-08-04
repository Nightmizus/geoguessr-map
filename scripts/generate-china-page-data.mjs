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

const pages = guides.guides.map(guide => {
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
  const content = guideContent(guide, sourcePages);
  const latestUpdate = sourcePages.map(page => page.contentUpdatedAt || "").sort().at(-1) || null;
  return {
    guideType: "china-province",
    adcode: guide.adcode,
    title: guide.name,
    slug: `china-province-${guide.adcode}`,
    section: "中国教程 / 省级指南",
    sourceUrl: guides.source,
    sourcePages,
    yuque: {
      wordCount: content.replace(/<[^>]+>/g, "").length,
      format: "lake",
      contentUpdatedAt: latestUpdate,
    },
    content,
    text: content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
    images: [],
    status: "ok",
  };
});

const output = {
  source: guides.source,
  basedOnCrawlAt: crawl.crawledAt,
  tocUpdatedAt: crawl.tocUpdatedAt,
  count: pages.length,
  adcodePages: Object.fromEntries(pages.map(page => [page.adcode, [page.slug]])),
  pages,
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `window.PLONKIT_CHINA_PAGES = ${JSON.stringify(output)};\n`, "utf8");
console.log(`Generated ${pages.length} China province pages in ${outputPath}`);
