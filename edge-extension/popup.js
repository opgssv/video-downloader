const statusText = document.getElementById('statusText');
const urlListContainer = document.getElementById('urlList');

async function getCookiesForUrl(targetUrl, tabUrl) {
  try {
    // Query cookies by URL instead of domain to ensure browser matching rules are applied correctly
    const targetCookies = await chrome.cookies.getAll({ url: targetUrl });
    
    let tabCookies = [];
    if (tabUrl && tabUrl.startsWith('http')) {
      try {
        tabCookies = await chrome.cookies.getAll({ url: tabUrl });
      } catch (err) {
        console.error('Failed to get tab cookies:', err);
      }
    }
    
    const allCookies = [...targetCookies, ...tabCookies];
    const uniqueCookies = [];
    const seenNames = new Set();
    for (const cookie of allCookies) {
      if (!seenNames.has(cookie.name)) {
        seenNames.add(cookie.name);
        uniqueCookies.push(cookie);
      }
    }
    
    const cookieStr = uniqueCookies.map(c => `${c.name}=${c.value}`).join('; ');
    console.log(`[Cookies Scraped] Target: ${targetUrl}, Found: ${uniqueCookies.length} cookies.`);
    return cookieStr;
  } catch (e) {
    console.error('Failed to retrieve cookies:', e);
    return '';
  }
}

async function sendToApp(url, title = 'External Link') {
  statusText.innerText = 'Sending...';
  statusText.style.color = '#666';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const originalUrl = tab ? tab.url : '';
    const cookie = await getCookiesForUrl(url, originalUrl);

    const response = await fetch('http://127.0.0.1:8888/send-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, title, originalUrl, cookie })
    });

    if (response.ok) {
      statusText.innerText = 'Success! App is analyzing.';
      statusText.style.color = '#2b7d1e';
      // Keep popup open so user can see it's working and send other links
      setTimeout(() => {
        statusText.innerText = 'Ready';
        statusText.style.color = '#666';
      }, 3000);
    } else {
      throw new Error('App rejected request');
    }
  } catch (error) {
    statusText.innerText = 'Launching App...';
    statusText.style.color = '#1877f2';
    
    // Also include originalUrl, title, and cookie in protocol for auto-launch
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const originalUrl = tab ? tab.url : '';
    const pageTitle = tab ? tab.title : 'Downloaded Video';
    const cookie = await getCookiesForUrl(url, originalUrl);
    
    const protocolUrl = `video-downloader://${encodeURIComponent(url)}?originalUrl=${encodeURIComponent(originalUrl)}&title=${encodeURIComponent(pageTitle)}&cookie=${encodeURIComponent(cookie)}`;
    
    location.href = protocolUrl;
    
    setTimeout(() => {
      statusText.innerText = 'App launched. Check your taskbar.';
      setTimeout(() => window.close(), 2500);
    }, 1500);
  }
}

document.getElementById('sendCurrent').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.url) {
    sendToApp(tab.url, tab.title);
  } else {
    statusText.innerText = 'No active tab found';
    statusText.style.color = '#c92a2a';
  }
});

async function loadCapturedUrls() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  const storageKey = "urls_" + tab.id;
  const pageTitle = tab.title || 'Downloaded Video';

  chrome.storage.local.get([storageKey], (result) => {
    const urls = result[storageKey] || [];
    
    if (urls.length > 0) {
      document.getElementById('blockedTip').style.display = 'block';
      urlListContainer.innerHTML = '';
      // REVERSE the array so the newest link is at the top
      [...urls].reverse().forEach(entry => {
        // Supports URLs saved by older extension versions as well as new metadata records.
        const detected = typeof entry === 'string' ? { url: entry, type: entry.toLowerCase().includes('.m3u8') ? 'HLS' : 'Video' } : entry;
        const url = detected.url;
        const item = document.createElement('div');
        item.className = 'url-item';

        const typeLabel = detected.type || 'Media';
        const typeClass = `type-${typeLabel.toLowerCase()}`;
        
        item.innerHTML = `<span class="url-item-type ${typeClass}">${typeLabel}</span>${url}`;
        // CRITICAL: Pass pageTitle here instead of a generic label
        item.addEventListener('click', () => sendToApp(url, pageTitle));
        urlListContainer.appendChild(item);
      });
    }
  });
}

// Initial load
loadCapturedUrls();
