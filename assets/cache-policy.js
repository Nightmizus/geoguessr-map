(function (global) {
  "use strict";

  function normalizeLayoutCache(source, dataVersion) {
    const normalized = {};
    if (!source || typeof source !== "object") return normalized;
    for (const [key, entry] of Object.entries(source)) {
      if (!entry || typeof entry !== "object"
          || entry.dataVersion !== dataVersion
          || typeof entry.signature !== "string"
          || !Array.isArray(entry.photos)) continue;
      normalized[key] = {
        dataVersion: entry.dataVersion,
        signature: entry.signature,
        photos: entry.photos
          .map(photo => ({
            ...photo,
            x: Number(photo.x),
            y: Number(photo.y),
            width: Number(photo.width),
            height: Number(photo.height),
          }))
          .filter(photo => photo.src
            && Number.isFinite(photo.x)
            && Number.isFinite(photo.y)
            && Number.isFinite(photo.width)
            && Number.isFinite(photo.height)),
      };
    }
    return normalized;
  }

  function normalizeRenderCache(source, dataVersion) {
    if (!source || typeof source !== "object" || source.dataVersion !== dataVersion) return null;
    if (typeof source.signature !== "string" || typeof source.html !== "string") return null;
    return {
      dataVersion: source.dataVersion,
      signature: source.signature,
      html: source.html,
    };
  }

  global.PLONKIT_CACHE_POLICY = Object.freeze({
    normalizeLayoutCache,
    normalizeRenderCache,
  });
})(typeof window === "object" ? window : globalThis);
