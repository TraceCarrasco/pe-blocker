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
  return { status: "safe" };
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
        // the data is stale — the DOM is likely also mid-transition, so return
        // unknown to let the retry mechanism wait for fresh data.
        if (dataVideoId !== null && dataVideoId !== currentVideoId) {
          return { status: "unknown" };
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
      // ytInitialData present but no channel handle found — fall through to DOM.
    }
  } catch (_) {
    // ytInitialData structure can change or is stale; fall through to DOM
  }

  // DOM fallback: owner link rendered under the video.
  //
  // Before reading the channel link, verify the DOM is actually showing the
  // current video. YouTube updates the `video-id` attribute on ytd-watch-flexy
  // early during SPA navigation; if it doesn't match the URL's video ID the
  // rest of the DOM (including the channel link) is still from the previous
  // page and must not be trusted.
  if (currentVideoId) {
    const watchFlexy = document.querySelector("ytd-watch-flexy");
    const domVideoId = watchFlexy ? watchFlexy.getAttribute("video-id") : null;
    if (domVideoId !== null && domVideoId !== currentVideoId) {
      return { status: "unknown" };
    }
  }

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

  // Neither ytInitialData nor the DOM had reliable channel info yet.
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
// Browser-only: URL change detection and chrome messaging
// ---------------------------------------------------------------------------
(function () {
  if (typeof chrome === "undefined") return;

  let lastSeenUrl = null;
  // Nonce incremented on every URL change; in-flight retries that carry a
  // stale nonce are discarded when a newer navigation has already started.
  let checkNonce = 0;

  function isYouTubeWatchPage(url) {
    try {
      const parts = new URL(url).pathname.split("/").filter(Boolean);
      return parts[0] === "watch" || parts[0] === "shorts";
    } catch (_) {
      return false;
    }
  }

  function runCheck(retries, nonce) {
    if (nonce !== checkNonce) return;

    const url = window.location.href;
    const result = detectCurrentSite(url);

    // On watch/shorts pages ytInitialData or the DOM may not be ready yet —
    // retry with exponential backoff before committing a result.
    if (result.status === "unknown" && retries < 4 && isYouTubeWatchPage(url)) {
      const delay = [200, 400, 800, 1600][retries];
      setTimeout(() => runCheck(retries + 1, nonce), delay);
      return;
    }

    if (nonce !== checkNonce) return;

    chrome.runtime.sendMessage({
      type: "PAGE_CHECK_RESULT",
      status: result.status,
      ownerInfo: result.ownerInfo || null,
    });
  }

  function onUrlChange() {
    checkNonce++;
    // Reset icon immediately so a stale warning never lingers during navigation.
    chrome.runtime.sendMessage({ type: "PAGE_CHECK_RESULT", status: "unknown", ownerInfo: null });
    runCheck(0, checkNonce);
  }

  function checkForUrlChange() {
    const url = window.location.href;
    if (url !== lastSeenUrl) {
      lastSeenUrl = url;
      onUrlChange();
    }
  }

  // YouTube fires this when its SPA navigation finishes (video autoplay, next
  // button, clicking a recommendation). This is the most reliable signal for
  // YouTube and fires faster than polling.
  document.addEventListener("yt-navigate-finish", () => {
    lastSeenUrl = window.location.href; // suppress duplicate from interval
    onUrlChange();
  });

  // Catch forward/back navigation driven by history.pushState (YouTube and
  // other SPAs) and browser back/forward.
  const _origPushState = history.pushState.bind(history);
  history.pushState = function (...args) {
    _origPushState(...args);
    setTimeout(checkForUrlChange, 0);
  };
  window.addEventListener("popstate", checkForUrlChange);

  // Keep a fallback poll for any navigations we didn't intercept above.
  setInterval(checkForUrlChange, 500);

  // Run immediately on page load without waiting for the first poll tick.
  lastSeenUrl = window.location.href;
  onUrlChange();
})();
