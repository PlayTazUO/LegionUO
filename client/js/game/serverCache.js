export function serverCacheId(config) {
  const id = config?.serverId ?? config?.assetServerId;
  return id == null ? '' : String(id);
}

export function withServerParam(url, config) {
  const id = serverCacheId(config);
  if (!id) return url;
  return `${url}${url.includes('?') ? '&' : '?'}server=${encodeURIComponent(id)}`;
}
