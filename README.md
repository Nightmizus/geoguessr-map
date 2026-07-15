# geoguessr-map

一个按国家和线索整理 GeoGuessr 学习资料的交互式世界地图。地图、教程索引和页面正文均以静态文件加载，可部署到 EdgeOne Pages 等静态托管平台。

## 本地构建

```powershell
npm run build
```

构建结果位于 `dist/`。页面运行所需的地图与教程数据会一并复制，不需要服务器、数据库或运行时 API。

## EdgeOne Pages 部署

在 EdgeOne Pages 中导入 GitHub 仓库后，项目会读取根目录的 `edgeone.json`：

- 构建命令：`npm run build`
- 输出目录：`dist`
- Node.js：`22.11.0`

每次推送到 GitHub 后可自动触发重新部署。教程中的部分图片仍来自原始远程图片地址，图片服务是否可访问不由本仓库控制。

## Profile 数据

Profile、图片选择和地图显示设置使用浏览器 `localStorage` 保存在用户本机，并按浏览器用户和站点域名隔离。项目没有上传或集中保存这些个人配置的服务器接口；用户也可以手动下载 JSON 备份，再在其他浏览器中导入。
