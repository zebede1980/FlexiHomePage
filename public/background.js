// Clicking the toolbar button opens the home page, which is handy before the
// Vivaldi "controlled by extension" new-tab setting has been switched on.
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('newtab.html') });
});
