import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOC_SNAPSHOT = path.join(ROOT, "raw", "yuque", "plonkit_toc_snapshot.html");
const OUTPUT_DIR = path.join(ROOT, "data", "source");
const BOOK_ID = 35361605;
const MENU_ROOT_UUID = "35361605:8_T917iwIto1zqfS";
const SKIP_SLUGS = new Set(["plonkit", "spillover-countries", "middle-earth", "china"]);
const API_BASE = "https://www.yuque.com/api/docs";

const html = await fs.readFile(TOC_SNAPSHOT, "utf8");
const appDataMatch = html.match(/window\.appData = JSON\.parse\(decodeURIComponent\("(.*?)"\)\);/);
if (!appDataMatch) {
  throw new Error(`Could not find window.appData in ${TOC_SNAPSHOT}`);
}

const appData = JSON.parse(decodeURIComponent(appDataMatch[1]));
const toc = appData.book.toc;
const byParent = new Map();
for (const item of toc) {
  if (!byParent.has(item.parent_uuid)) byParent.set(item.parent_uuid, []);
  byParent.get(item.parent_uuid).push(item);
}

function collectDocs(uuid, trail = []) {
  const rows = [];
  for (const item of byParent.get(uuid) || []) {
    const nextTrail = item.type === "TITLE" ? [...trail, item.title] : trail;
    if (item.type === "DOC" && item.url && !SKIP_SLUGS.has(item.url)) {
      rows.push({
        title: item.title,
        slug: item.url,
        docId: item.doc_id || null,
        uuid: item.uuid,
        parentUuid: item.parent_uuid,
        section: trail.join(" / "),
      });
    }
    rows.push(...collectDocs(item.uuid, nextTrail));
  }
  return rows;
}

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
  const cardRegex = /<card\b[^>]*\bname="image"[^>]*\bvalue="([^"]+)"[^>]*>/gi;
  for (const match of content.matchAll(cardRegex)) {
    let value = decodeHtml(match[1]);
    if (value.startsWith("data:")) value = value.slice(5);
    try {
      const card = JSON.parse(decodeURIComponent(value));
      if (card.src) {
        images.push({
          src: card.src,
          alt: card.alt || card.name || "",
          width: card.width || null,
          height: card.height || null,
        });
      }
    } catch {
      images.push({ src: value, alt: "", width: null, height: null });
    }
  }
  const imgRegex = /<img\b[^>]*\bsrc="([^"]+)"/gi;
  for (const match of content.matchAll(imgRegex)) {
    const src = decodeHtml(match[1]);
    if (src && !images.some(image => image.src === src)) {
      images.push({ src, alt: "", width: null, height: null });
    }
  }
  return images;
}

function contentToText(content) {
  return decodeHtml(
    String(content || "")
      .replace(/<!doctype\s+lake>/gi, "")
      .replace(/<meta\b[^>]*\/?>/gi, "")
      .replace(/<card\b[^>]*\bname="image"[^>]*>/gi, "\n[图片]\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|h1|h2|h3|h4|h5|h6|li|tr|table|blockquote)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/\uFEFF/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

async function fetchDoc(doc, attempt = 1) {
  const url = `${API_BASE}/${encodeURIComponent(doc.slug)}?book_id=${BOOK_ID}&include_contributors=true&include_like=true&include_hits=true&merge_dynamic_data=false`;
  const response = await fetch(url, {
    headers: {
      "accept": "application/json, text/plain, */*",
      "referer": `https://www.yuque.com/chaofun/tuxun/${doc.slug}`,
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
    },
  });

  const text = await response.text();
  if (!response.ok) {
    if (attempt < 3 && [429, 500, 502, 503, 504].includes(response.status)) {
      await new Promise(resolve => setTimeout(resolve, 800 * attempt));
      return fetchDoc(doc, attempt + 1);
    }
    throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 160)}`);
  }

  const json = JSON.parse(text);
  const data = json.data || {};
  const content = data.content || data.body || "";
  return {
    ...doc,
    sourceUrl: `https://www.yuque.com/chaofun/tuxun/${doc.slug}`,
    apiUrl: url,
    crawledAt: new Date().toISOString(),
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
      editorMeta: data.editor_meta || "",
      contributors: data.contributors || [],
    },
    content,
    text: contentToText(content),
    images: extractImages(content),
    status: "ok",
  };
}

const docs = collectDocs(MENU_ROOT_UUID);
const results = [];
const failures = [];

for (let index = 0; index < docs.length; index += 1) {
  const doc = docs[index];
  process.stdout.write(`[${index + 1}/${docs.length}] ${doc.title} (${doc.slug}) ... `);
  try {
    const result = await fetchDoc(doc);
    results.push(result);
    process.stdout.write(`ok ${result.yuque.wordCount}w ${result.images.length}img\n`);
  } catch (error) {
    failures.push({ ...doc, status: "error", error: String(error.message || error) });
    process.stdout.write(`FAILED ${String(error.message || error)}\n`);
  }
  await new Promise(resolve => setTimeout(resolve, 160));
}

const output = {
  source: "https://www.yuque.com/chaofun/tuxun",
  bookId: BOOK_ID,
  menuRoot: "世界教程 / Plonk It",
  skipped: [{ title: "中华人民共和国", slug: "china", reason: "user requested: page is gone" }],
  crawledAt: new Date().toISOString(),
  count: results.length,
  failureCount: failures.length,
  failures,
  pages: results,
};

await fs.mkdir(OUTPUT_DIR, { recursive: true });
await fs.writeFile(path.join(OUTPUT_DIR, "plonkit_pages.json"), JSON.stringify(output, null, 2), "utf8");
await fs.writeFile(path.join(OUTPUT_DIR, "plonkit_pages_summary.json"), JSON.stringify({
  source: output.source,
  menuRoot: output.menuRoot,
  crawledAt: output.crawledAt,
  count: output.count,
  failureCount: output.failureCount,
  failures,
  pages: results.map(page => ({
    title: page.title,
    slug: page.slug,
    section: page.section,
    wordCount: page.yuque.wordCount,
    images: page.images.length,
    contentUpdatedAt: page.yuque.contentUpdatedAt,
    sourceUrl: page.sourceUrl,
  })),
}, null, 2), "utf8");

console.log(`DONE pages=${results.length} failures=${failures.length}`);
