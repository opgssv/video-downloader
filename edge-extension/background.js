const capturedUrls = new Map();
const MAX_URLS_PER_TAB = 50;

const EXTENSION_TYPES = {
  m3u8: 'HLS',
  mpd: 'DASH',
  mp4: 'Video', m4v: 'Video', mov: 'Video', webm: 'Video', mkv: 'Video', avi: 'Video', flv: 'Video', ogv: 'Video',
  mp3: 'Audio', m4a: 'Audio', aac: 'Audio', ogg: 'Audio', opus: 'Audio', wav: 'Audio', flac: 'Audio',
};
const DIRECT_MEDIA_REGEX = /\.([a-z0-9]+)(?:$|[?#])/i;
const SEGMENT_REGEX = /\.(?:ts|m4s|cmfv|cmfa)(?:$|[?#])/i;

function mediaTypeFromUrl(url) {
  if (/googlevideo\.com\/videoplayback/i.test(url)) return 'Video';
  if (/\b(?:manifest|playlist)\b/i.test(url) && /(?:hls|dash|stream)/i.test(url)) return 'Stream';
  const match = url.match(DIRECT_MEDIA_REGEX);
  return match ? EXTENSION_TYPES[match[1].toLowerCase()] : null;
}

function mediaTypeFromHeaders(headers = []) {
  const contentType = headers.find(header => header.name.toLowerCase() === 'content-type')?.value?.toLowerCase() || '';
  const disposition = headers.find(header => header.name.toLowerCase() === 'content-disposition')?.value?.toLowerCase() || '';
  if (/application\/(?:vnd\.apple\.mpegurl|x-mpegurl)/.test(contentType)) return { type: 'HLS', contentType };
  if (/application\/dash\+xml/.test(contentType)) return { type: 'DASH', contentType };
  if (/^video\//.test(contentType)) return { type: 'Video', contentType };
  if (/^audio\//.test(contentType)) return { type: 'Audio', contentType };
  if (/filename=.*\.(?:mp4|mkv|webm|mov|m4v|mp3|m4a|aac|ogg|opus)/.test(disposition)) return { type: 'Media', contentType };
  return null;
}

function capture(details, type, contentType = '') {
  if (details.tabId === -1 || SEGMENT_REGEX.test(details.url)) return;
  if (details.url.includes('analytics') || details.url.includes('pixel')) return;

  if (!capturedUrls.has(details.tabId)) capturedUrls.set(details.tabId, new Map());
  const urls = capturedUrls.get(details.tabId);
  if (urls.has(details.url)) return;

  urls.set(details.url, { url: details.url, type, contentType });
  if (urls.size > MAX_URLS_PER_TAB) urls.delete(urls.keys().next().value);
  chrome.storage.local.set({ [`urls_${details.tabId}`]: Array.from(urls.values()) });
}

// Captures obvious manifests and direct media URLs before a response is received.
chrome.webRequest.onBeforeRequest.addListener((details) => {
  const type = mediaTypeFromUrl(details.url);
  if (type) capture(details, type);
}, { urls: ['<all_urls>'] });

// Captures extensionless CDN/API URLs from the response MIME type.
chrome.webRequest.onHeadersReceived.addListener((details) => {
  const media = mediaTypeFromHeaders(details.responseHeaders);
  if (media) capture(details, media.type, media.contentType);
}, { urls: ['<all_urls>'] }, ['responseHeaders']);

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url) return;
  const type = mediaTypeFromUrl(changeInfo.url);
  if (type) capture({ tabId, url: changeInfo.url }, type);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  capturedUrls.delete(tabId);
  chrome.storage.local.remove([`urls_${tabId}`]);
});
