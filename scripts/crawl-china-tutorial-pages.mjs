import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_URL = "https://www.yuque.com/chaofun/tuxun";
const BOOK_ID = 35361605;
const CHINA_ROOT_TITLE = "中国教程";
const TARGET_SECTION_TITLES = ["综合指南", "精选篇目", "寻友教程"];
const OUTPUT_DIR = path.join(ROOT, "data", "source");
const OUTPUT_PATH = path.join(OUTPUT_DIR, "china_tutorial_pages.json");
const SUMMARY_PATH = path.join(OUTPUT_DIR, "china_tutorial_pages_summary.json");
const RAW_DIR = path.join(ROOT, "raw", "yuque");
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36";

function decodeHtml(value) {
  return String(value || "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'");
}

function extractImages(content) {
  const images = [];
  for (const match of String(content || "").matchAll(/<card\b[^>]*\bname="image"[^>]*\bvalue="([^"]+)"[^>]*>/gi)) {
    let value = decodeHtml(match[1]);
    if (value.startsWith("data:")) value = value.slice(5);
    try {
      const card = JSON.parse(decodeURIComponent(value));
      if (card.src) images.push({ src: card.src, alt: card.alt || card.name || "", width: card.width || null, height: card.height || null });
    } catch {
      if (value) images.push({ src: value, alt: "", width: null, height: null });
    }
  }
  for (const match of String(content || "").matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gi)) {
    const src = decodeHtml(match[1]);
    if (src && !images.some(image => image.src === src)) images.push({ src, alt: "", width: null, height: null });
  }
  return images;
}

function contentToText(content) {
  return decodeHtml(String(content || "")
    .replace(/<!doctype\s+lake>/gi, "")
    .replace(/<meta\b[^>]*\/?>/gi, "")
    .replace(/<card\b[^>]*\bname="image"[^>]*>/gi, "\n[图片]\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h1|h2|h3|h4|h5|h6|li|tr|table|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\uFEFF/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim());
}

async function fetchText(url, accept = "text/html") {
  const response = await fetch(url, { headers: { accept, "user-agent": USER_AGENT } });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 180)}`);
  return text;
}

async function readExistingOutput() {
  try {
    return JSON.parse(await fs.readFile(OUTPUT_PATH, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return { pages: [] };
    throw error;
  }
}

const tocHtml = await fetchText(SOURCE_URL);
const appDataMatch = tocHtml.match(/window\.appData = JSON\.parse\(decodeURIComponent\("(.*?)"\)\);/);
if (!appDataMatch) throw new Error("Could not find the Yuque appData payload");
const appData = JSON.parse(decodeURIComponent(appDataMatch[1]));
const toc = appData.book?.toc || [];
const rowByUuid = new Map(toc.map(item => [item.uuid, item]));
const chinaRoot = toc.find(item => item.type === "TITLE" && item.title === CHINA_ROOT_TITLE && !item.parent_uuid);
if (!chinaRoot) throw new Error(`Could not find the ${CHINA_ROOT_TITLE} directory`);

const sectionRows = toc.filter(item =>
  item.type === "TITLE"
  && item.parent_uuid === chinaRoot.uuid
  && TARGET_SECTION_TITLES.includes(item.title)
);
const sectionByUuid = new Map(sectionRows.map(item => [item.uuid, item.title]));
if (sectionRows.length !== TARGET_SECTION_TITLES.length) {
  throw new Error(`Expected sections ${TARGET_SECTION_TITLES.join(", ")}; found ${sectionRows.map(item => item.title).join(", ")}`);
}

function targetSectionForRow(row) {
  const visited = new Set();
  let parentUuid = row.parent_uuid;
  while (parentUuid && !visited.has(parentUuid)) {
    if (sectionByUuid.has(parentUuid)) return sectionByUuid.get(parentUuid);
    visited.add(parentUuid);
    parentUuid = rowByUuid.get(parentUuid)?.parent_uuid || "";
  }
  return null;
}

const docs = toc
  .filter(item => item.type === "DOC")
  .map(item => ({ item, section: targetSectionForRow(item) }))
  .filter(({ section }) => section)
  .map(({ item, section }) => ({
    title: item.title,
    slug: item.url,
    docId: item.doc_id,
    uuid: item.uuid,
    parentUuid: item.parent_uuid,
    section,
  }));

const externalLinks = toc
  .filter(item => item.type === "LINK")
  .map(item => ({ item, section: targetSectionForRow(item) }))
  .filter(({ section }) => section)
  .map(({ item, section }) => ({ title: item.title, url: item.url, uuid: item.uuid, parentUuid: item.parent_uuid, section }));

await fs.mkdir(RAW_DIR, { recursive: true });
await fs.writeFile(path.join(RAW_DIR, "china_tutorial_toc_snapshot.html"), tocHtml, "utf8");

const existing = await readExistingOutput();
const existingBySlug = new Map((existing.pages || []).map(page => [page.slug, page]));
const crawledPages = [];
const failures = [];
for (let index = 0; index < docs.length; index += 1) {
  const doc = docs[index];
  process.stdout.write(`[${index + 1}/${docs.length}] ${doc.title} (${doc.slug}) ... `);
  const apiUrl = `https://www.yuque.com/api/docs/${encodeURIComponent(doc.slug)}?book_id=${BOOK_ID}&include_contributors=true&include_like=true&include_hits=true&merge_dynamic_data=false`;
  try {
    const text = await fetchText(apiUrl, "application/json, text/plain, */*");
    const data = JSON.parse(text).data || {};
    const content = data.content || data.body || "";
    const page = {
      ...doc,
      sourceUrl: `${SOURCE_URL}/${doc.slug}`,
      apiUrl,
      yuque: {
        id: data.id,
        title: data.title || doc.title,
        slug: data.slug || doc.slug,
        wordCount: data.word_count || 0,
        format: data.format || "",
        contentUpdatedAt: data.content_updated_at || null,
        publishedAt: data.published_at || null,
        updatedAt: data.updated_at || null,
        description: data.description || "",
      },
      content,
      text: contentToText(content),
      images: extractImages(content),
      status: "ok",
    };
    crawledPages.push(page);
    process.stdout.write(`ok ${page.yuque.wordCount}w ${page.images.length}img\n`);
  } catch (error) {
    const failure = { ...doc, status: "error", error: String(error.message || error) };
    failures.push(failure);
    const previous = existingBySlug.get(doc.slug);
    if (previous) {
      crawledPages.push(previous);
      process.stdout.write(`FAILED; kept existing copy (${failure.error})\n`);
    } else {
      process.stdout.write(`FAILED ${failure.error}\n`);
    }
  }
  await new Promise(resolve => setTimeout(resolve, 160));
}

// Keep any previously stored page that is no longer in a selected TOC section instead of
// silently deleting data. Current TOC pages retain the same order as the knowledge base.
const currentSlugs = new Set(crawledPages.map(page => page.slug));
const pages = [...crawledPages, ...(existing.pages || []).filter(page => !currentSlugs.has(page.slug))];
const crawledAt = new Date().toISOString();
const output = {
  source: SOURCE_URL,
  bookId: BOOK_ID,
  tocUpdatedAt: appData.book?.toc_updated_at || null,
  categories: TARGET_SECTION_TITLES,
  crawledAt,
  count: pages.length,
  failureCount: failures.length,
  failures,
  externalLinks,
  pages,
};
await fs.mkdir(OUTPUT_DIR, { recursive: true });
await fs.writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2), "utf8");
await fs.writeFile(SUMMARY_PATH, JSON.stringify({
  source: SOURCE_URL,
  tocUpdatedAt: output.tocUpdatedAt,
  crawledAt,
  count: pages.length,
  failureCount: failures.length,
  failures,
  externalLinks,
  pages: pages.map(page => ({
    title: page.title,
    slug: page.slug,
    section: page.section,
    wordCount: page.yuque.wordCount,
    images: page.images.length,
    contentUpdatedAt: page.yuque.contentUpdatedAt,
    sourceUrl: page.sourceUrl,
  })),
}, null, 2), "utf8");

console.log(`DONE pages=${pages.length} failures=${failures.length} externalLinks=${externalLinks.length}`);
