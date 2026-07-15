# Project Structure

这个项目已经按用途分目录。根目录只保留主页面、项目说明和目录。

## 根目录

- `index.html`：主页面入口，也是静态托管的默认入口。
- `PROJECT_STRUCTURE.md`：当前说明文件。
- `edgeone.json`：EdgeOne Pages 构建配置。
- `package.json`：项目名称和静态站点构建命令。

## assets/

- `assets/vendor/d3.v7.min.js`：地图页面使用的 D3。
- `assets/vendor/topojson-client.min.js`：保留的地图工具库。

## data/

- `data/generated/plonkit_page_data.js`：网页直接加载的文章数据包，包含 `window.PLONKIT_MAP_INDEX` 和 `window.PLONKIT_PAGES`。
- `data/generated/plonkit_geo_data.js`：网页直接加载的地图数据包。
- `data/generated/plonkit_image_selections.js`：图片勾选结果，目前为空对象。
- `data/source/plonkit_pages.json`：完整文章抓取结果，包含正文、纯文本、图片地址、语雀元数据等。
- `data/source/plonkit_pages_summary.json`：文章摘要列表。
- `data/source/plonkit_map_index.json`：文章和地图区域的索引。
- `data/source/ne_*.geojson`、`data/source/countries*`：地图源数据和中间文件。

## scripts/

- `scripts/build-static-site.mjs`：把页面运行所需文件复制到 `dist/`，供静态托管平台发布。
- `scripts/crawl_plonkit_pages.mjs`：文章抓取脚本。运行它才会访问语雀 API，并重新生成 `data/source/plonkit_pages.json` 和 `data/source/plonkit_pages_summary.json`。

## raw/

- `raw/yuque/plonkit_toc_snapshot.html`：语雀目录快照。原来的名字用国家页做样例，容易误导；实际用途是给爬虫读取整本 Plonk It 目录。
- `raw/yuque/api_*.json`、`raw/yuque/*.headers.txt`：早期 API 探测响应，已归档。
- `raw/yuque/page_assets/yuque_*.js`：早期保存的语雀页面脚本，已归档。
- `raw/yuque/obsolete_doc_api_sample.*`：早期试 API 留下的样例响应，已归档，不参与页面运行。

## logs/

- `logs/server.out.log`、`logs/server.err.log`：本地服务日志。

## 文章是否现爬

不是每次现爬。主页面打开时只加载本地的 `data/generated/plonkit_page_data.js`，里面已经包含 132 篇文章数据。

需要更新文章时，才手动运行 `scripts/crawl_plonkit_pages.mjs` 重新抓取。

注意：文章正文和图片地址已经保存，但图片文件本身没有下载到本地；页面显示图片时仍会访问远程 `cdn.nlark.com` 图片地址。
