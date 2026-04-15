// content.js
// Runs on every page. Detects whether the current site or channel is owned
// by a private equity firm, then messages the background service worker so
// it can update the extension icon.
//
// Platform support:
//   youtube.com  — channel-level detection via URL, ytInitialData, and DOM
//   everything else — domain-level detection against PE_ENTITIES.domains

// ---------------------------------------------------------------------------
// Top-level dispatcher
// ---------------------------------------------------------------------------

function detectCurrentSite(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { status: "unknown" };
  }

  const hostname = parsed.hostname.replace(/^www\./, "").toLowerCase();

  if (hostname === "youtube.com" || hostname === "youtu.be") {
    return detectYouTube(parsed);
  }

  return detectByDomain(hostname);
}

// ---------------------------------------------------------------------------
// Generic domain detection (non-YouTube sites)
// ---------------------------------------------------------------------------

function detectByDomain(hostname) {
  if (PE_ENTITIES.domains.has(hostname)) {
    return { status: "warning", ownerInfo: PE_ENTITIES.ownerInfo[hostname] };
  }
  // Not in our domains list — unknown, not confirmed safe.
  // The list only covers known PE sites; absence of a match is not a guarantee.
  return { status: "unknown" };
}

// ---------------------------------------------------------------------------
// YouTube-specific detection
// ---------------------------------------------------------------------------

function detectYouTube(parsed) {
  const parts = parsed.pathname.split("/").filter(Boolean);

  // /@handle  (most common modern format)
  if (parts[0] && parts[0].startsWith("@")) {
    const handle = parts[0].slice(1).toLowerCase();
    if (PE_ENTITIES.youtubeHandles.has(handle)) {
      return { status: "warning", ownerInfo: PE_ENTITIES.ownerInfo[handle] };
    }
    // We checked this specific channel — confirmed safe.
    return { status: "safe" };
  }

  // /channel/UCxxx  (channel ID format)
  if (parts[0] === "channel" && parts[1]) {
    const id = parts[1].toLowerCase();
    if (PE_ENTITIES.youtubeHandles.has(id)) {
      return { status: "warning", ownerInfo: PE_ENTITIES.ownerInfo[id] };
    }
    return { status: "safe" };
  }

  // /c/slug  or  /user/username  (legacy formats)
  if ((parts[0] === "c" || parts[0] === "user") && parts[1]) {
    const slug = parts[1].toLowerCase();
    if (PE_ENTITIES.youtubeHandles.has(slug)) {
      return { status: "warning", ownerInfo: PE_ENTITIES.ownerInfo[slug] };
    }
    return { status: "safe" };
  }

  // /watch?v=xxx  or  /shorts/xxx  — channel not in URL, inspect page content
  if (parts[0] === "watch" || parts[0] === "shorts") {
    return detectFromYouTubePage(parsed);
  }

  // YouTube homepage, /feed/, /results, etc. — no channel context to evaluate
  return { status: "unknown" };
}

function detectFromYouTubePage(parsed) {
  // During SPA navigation, ytInitialData can briefly reflect the *previous* page
  // before YouTube updates it for the new one. Validate freshness by comparing
  // the video ID embedded in ytInitialData against the URL's ?v= param.
  const currentVideoId = parsed
    ? (parsed.searchParams.get("v") ||
       parsed.pathname.match(/\/shorts\/([^/?]+)/)?.[1] ||
       null)
    : null;

  try {
    const ytData = window.ytInitialData;
    if (ytData) {
      if (currentVideoId) {
        const dataVideoId =
          ytData?.currentVideoEndpoint?.watchEndpoint?.videoId ?? null;
        // If ytInitialData carries a video ID that doesn't match the current URL,
        // the data is stale — skip it to avoid false positives/negatives.
        if (dataVideoId !== null && dataVideoId !== currentVideoId) {
          throw new Error("stale");
        }
      }

      const handle = extractHandleFromYtData(ytData);
      if (handle) {
        const lc = handle.toLowerCase();
        if (PE_ENTITIES.youtubeHandles.has(lc)) {
          return { status: "warning", ownerInfo: PE_ENTITIES.ownerInfo[lc] };
        }
        return { status: "safe" };
      }
    }
  } catch (_) {
    // ytInitialData structure can change or is stale; fall through to DOM
  }

  // DOM fallback: owner link rendered under the video
  let domChannelFound = false;
  const ownerLinks = document.querySelectorAll(
    "ytd-channel-name a, #owner #channel-name a, #upload-info #channel-name a"
  );
  for (const link of ownerLinks) {
    const href = link.getAttribute("href") || "";
    const match = href.match(/\/@([^/?]+)/) || href.match(/\/channel\/([^/?]+)/);
    if (match) {
      domChannelFound = true;
      const id = match[1].toLowerCase();
      if (PE_ENTITIES.youtubeHandles.has(id)) {
        return { status: "warning", ownerInfo: PE_ENTITIES.ownerInfo[id] };
      }
    }
  }

  // DOM has loaded and identified a non-PE channel — confirmed safe.
  if (domChannelFound) return { status: "safe" };

  // Neither ytInitialData nor the DOM had reliable channel info yet
  // (data is stale or the page hasn't finished rendering).
  // Signal the caller to retry rather than treating this as safe/warning.
  return { status: "unknown" };
}

function extractHandleFromYtData(ytData) {
  // Video watch page: owner info lives in videoSecondaryInfoRenderer
  try {
    const contents =
      ytData?.contents?.twoColumnWatchNextResults?.results?.results?.contents;
    if (Array.isArray(contents)) {
      for (const item of contents) {
        const renderer = item?.videoSecondaryInfoRenderer;
        if (!renderer) continue;
        const canonical =
          renderer?.owner?.videoOwnerRenderer?.navigationEndpoint
            ?.browseEndpoint?.canonicalBaseUrl;
        if (canonical) {
          return canonical.replace(/^\/@/, "");
        }
      }
    }
  } catch (_) {}

  // Channel page: header renderer
  try {
    const handle =
      ytData?.header?.c4TabbedHeaderRenderer?.navigationEndpoint
        ?.browseEndpoint?.canonicalBaseUrl;
    if (handle) return handle.replace(/^\/@/, "");
  } catch (_) {}

  return null;
}

// Export for the test environment
if (typeof module !== "undefined") {
  module.exports = { detectCurrentSite, detectByDomain, detectYouTube, extractHandleFromYtData };
}

// ---------------------------------------------------------------------------
// Browser-only: SPA navigation tracking and chrome messaging
// ---------------------------------------------------------------------------
(function () {
  if (typeof chrome === "undefined") return;

  let lastCheckedUrl = null;

  // Returns true when the URL is a YouTube watch or shorts page — the only pages
  // where detectFromYouTubePage can return "unknown" due to data not being ready.
  function isYouTubeWatchPage(url) {
    try {
      const parts = new URL(url).pathname.split("/").filter(Boolean);
      return parts[0] === "watch" || parts[0] === "shorts";
    } catch (_) {
      return false;
    }
  }

  function checkCurrentPage(retries) {
    retries = retries || 0;
    const url = window.location.href;
    if (url === lastCheckedUrl) return;

    const result = detectCurrentSite(url);

    // "unknown" on a watch/shorts page means ytInitialData is stale or the DOM
    // hasn't rendered the channel info yet. Retry with exponential backoff rather
    // than locking in a potentially wrong result.
    if (result.status === "unknown" && retries < 4 && isYouTubeWatchPage(url)) {
      const delay = [200, 400, 800, 1600][retries];
      setTimeout(() => checkCurrentPage(retries + 1), delay);
      return;
    }

    // Only lock the URL once we have a definitive result, so that any in-flight
    // retry above can still re-evaluate after the page data finishes loading.
    lastCheckedUrl = url;
    chrome.runtime.sendMessage({
      type: "PAGE_CHECK_RESULT",
      status: result.status,
      ownerInfo: result.ownerInfo || null,
    });
  }

  // YouTube fires this on every SPA navigation
  document.addEventListener("yt-navigate-finish", () => {
    lastCheckedUrl = null;
    checkCurrentPage();
  });

  // MutationObserver as a belt-and-suspenders fallback for SPA navigations
  const observer = new MutationObserver(() => checkCurrentPage());
  observer.observe(document.documentElement, { childList: true, subtree: false });

  checkCurrentPage();
})();
