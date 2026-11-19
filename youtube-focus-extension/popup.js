const KEYS = ['skipAds', 'hideSidebar', 'hideShorts', 'hideComments', 'hideEndscreen', 'hideHomeFeed'];
const DEFAULTS = {
  skipAds: true,
  hideSidebar: true,
  hideShorts: true,
  hideComments: false,
  hideEndscreen: true,
  hideHomeFeed: false
};

chrome.storage.sync.get(DEFAULTS, (items) => {
  for (const k of KEYS) {
    const el = document.getElementById(k);
    el.checked = !!items[k];
    el.addEventListener('change', () => {
      chrome.storage.sync.set({ [k]: el.checked });
    });
  }
});
