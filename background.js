// background.js — MV3 service worker
// Manages the extension icon state on a per-tab basis.
//
// Three states:
//   unknown  — general page, no PE evaluation performed (default eye icon)
//   safe     — page was checked and is not PE-owned (green checkmark)
//   warning  — page is PE-owned (red $ icon)

const DEFAULT_ICON = {
  16:  "icons/icon16.png",
  48:  "icons/icon48.png",
  128: "icons/icon128.png",
};

const SAFE_ICON = {
  16:  "icons/icon-safe16.png",
  48:  "icons/icon-safe48.png",
  128: "icons/icon-safe128.png",
};

const WARNING_ICON = {
  16:  "icons/icon-warning16.png",
  48:  "icons/icon-warning48.png",
  128: "icons/icon-warning128.png",
};

// --- Message handler ---

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type !== "PAGE_CHECK_RESULT") return;

  const tabId = sender?.tab?.id;
  if (!tabId) return;

  if (message.status === "warning") {
    setWarningIcon(tabId, message.ownerInfo);
  } else if (message.status === "safe") {
    setSafeIcon(tabId);
  } else {
    setDefaultIcon(tabId);
  }
});

// --- Tab lifecycle ---

// Reset to the default (unknown) icon immediately when a new navigation begins,
// before the content script has had a chance to evaluate the new page.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    setDefaultIcon(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  setDefaultIcon(tabId);
});

// --- Icon helpers ---

function setWarningIcon(tabId, ownerInfo) {
  const title = ownerInfo
    ? `Private Equity Watch: Owned by ${ownerInfo}`
    : "Private Equity Watch: PE-owned";

  chrome.action.setTitle({ tabId, title });
  chrome.action.setIcon({ tabId, path: WARNING_ICON });
}

function setSafeIcon(tabId) {
  chrome.action.setTitle({ tabId, title: "Private Equity Watch: No PE ownership detected" });
  chrome.action.setIcon({ tabId, path: SAFE_ICON });
}

function setDefaultIcon(tabId) {
  chrome.action.setTitle({ tabId, title: "Private Equity Watch" });
  chrome.action.setIcon({ tabId, path: DEFAULT_ICON });
}
