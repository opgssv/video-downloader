const statusText = document.getElementById('statusText');
const urlListContainer = document.getElementById('urlList');

async function sendToApp(url, title = 'External Link') {
  statusText.innerText = 'Sending...';
  statusText.style.color = '#666';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const originalUrl = tab ? tab.url : '';

    const response = await fetch('http://127.0.0.1:8888/send-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, title, originalUrl })
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
    
    // Also include originalUrl and title in protocol for auto-launch
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const originalUrl = tab ? tab.url : '';
    const pageTitle = tab ? tab.title : 'Downloaded Video';
    const protocolUrl = `video-downloader://${encodeURIComponent(url)}?originalUrl=${encodeURIComponent(originalUrl)}&title=${encodeURIComponent(pageTitle)}`;
    
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
      urls.forEach(url => {
        const item = document.createElement('div');
        item.className = 'url-item';
        
        const isM3U8 = url.toLowerCase().includes('.m3u8');
        const typeLabel = isM3U8 ? 'm3u8' : 'mp4';
        const typeClass = isM3U8 ? 'type-m3u8' : 'type-mp4';
        
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
