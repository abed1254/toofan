// YouTube Focus — content script
const DEFAULTS = {
  skipAds: true,
  hideSidebar: true,
  hideShorts: true,
  hideComments: false,
  hideEndscreen: true,
  hideHomeFeed: false
};

let settings = { ...DEFAULTS };

function applySettings(s) {
  const root = document.documentElement;
  root.classList.toggle('ytf-hide-ads', !!s.skipAds);
  root.classList.toggle('ytf-hide-sidebar', !!s.hideSidebar);
  root.classList.toggle('ytf-hide-shorts', !!s.hideShorts);
  root.classList.toggle('ytf-hide-comments', !!s.hideComments);
  root.classList.toggle('ytf-hide-endscreen', !!s.hideEndscreen);
  root.classList.toggle('ytf-hide-homefeed', !!s.hideHomeFeed);
}

chrome.storage.sync.get(DEFAULTS, (items) => {
  settings = items;
  applySettings(settings);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  for (const [k, v] of Object.entries(changes)) settings[k] = v.newValue;
  applySettings(settings);
});

// --- رد خودکار تبلیغات ---
function skipAds() {
  if (!settings.skipAds) return;
  // دکمه Skip رو بزن اگه اومد
  const skipBtn = document.querySelector(
    '.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button'
  );
  if (skipBtn) {
    skipBtn.click();
    return;
  }
  // تبلیغ غیرقابل‌رد: بپر آخرش
  const video = document.querySelector('video');
  if (video && document.querySelector('.ad-showing')) {
    try {
      video.muted = true;
      if (video.duration && isFinite(video.duration)) {
        video.currentTime = video.duration;
      }
    } catch (e) { /* ignore */ }
  }
}

setInterval(skipAds, 500);
new MutationObserver(skipAds).observe(document.documentElement, {
  childList: true,
  subtree: true
});
