// Load PE_ENTITIES into the global scope before content.js is required,
// mirroring how the browser loads pe-channels.js before content.js.
const { PE_ENTITIES } = require('../pe-channels.js');
global.PE_ENTITIES = PE_ENTITIES;

const {
  detectCurrentSite,
  detectByDomain,
  detectYouTube,
  extractHandleFromYtData,
} = require('../content.js');

// ---------------------------------------------------------------------------
// detectCurrentSite — top-level dispatcher
// ---------------------------------------------------------------------------

describe('detectCurrentSite — routing', () => {
  test('routes youtube.com to YouTube detection (warning)', () => {
    const result = detectCurrentSite('https://www.youtube.com/@veritasium');
    expect(result.status).toBe('warning');
  });

  test('routes youtu.be short links to YouTube detection (unknown — no channel context in URL)', () => {
    // youtu.be/ID has no watch/shorts prefix — falls through to unknown
    const result = detectCurrentSite('https://youtu.be/abc123');
    expect(result.status).toBe('unknown');
  });

  test('routes other domains to domain detection (unknown — not in our list)', () => {
    const result = detectCurrentSite('https://buzzfeed.com/article/foo');
    expect(result.status).toBe('unknown');
  });

  test('returns unknown for invalid URLs', () => {
    expect(detectCurrentSite('not-a-url').status).toBe('unknown');
    expect(detectCurrentSite('').status).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// detectByDomain — generic website detection
// ---------------------------------------------------------------------------

describe('detectByDomain', () => {
  beforeEach(() => {
    PE_ENTITIES.domains.add('example-pe-site.com');
    PE_ENTITIES.ownerInfo['example-pe-site.com'] = 'Test PE Firm';
  });

  afterEach(() => {
    PE_ENTITIES.domains.delete('example-pe-site.com');
    delete PE_ENTITIES.ownerInfo['example-pe-site.com'];
  });

  test('returns warning for a known PE-owned domain', () => {
    const result = detectByDomain('example-pe-site.com');
    expect(result.status).toBe('warning');
    expect(result.ownerInfo).toBe('Test PE Firm');
  });

  test('returns unknown for a domain not in our list', () => {
    expect(detectByDomain('wikipedia.org').status).toBe('unknown');
    expect(detectByDomain('github.com').status).toBe('unknown');
  });

  test('www prefix is stripped before matching', () => {
    const result = detectCurrentSite('https://www.example-pe-site.com/article');
    expect(result.status).toBe('warning');
  });

  test('subdomains do not match the bare domain', () => {
    expect(detectByDomain('news.example-pe-site.com').status).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// detectYouTube — @handle URLs
// ---------------------------------------------------------------------------

describe('detectYouTube — @handle URLs', () => {
  function parse(url) { return new URL(url); }

  test('detects a known PE channel by handle', () => {
    const result = detectYouTube(parse('https://www.youtube.com/@veritasium'));
    expect(result.status).toBe('warning');
    expect(result.ownerInfo).toBe('Electrify Video Partners');
  });

  test('matching is case-insensitive', () => {
    expect(detectYouTube(parse('https://www.youtube.com/@Veritasium')).status).toBe('warning');
    expect(detectYouTube(parse('https://www.youtube.com/@VERITASIUM')).status).toBe('warning');
  });

  test('non-PE channel returns safe', () => {
    expect(detectYouTube(parse('https://www.youtube.com/@mkbhd')).status).toBe('safe');
  });

  test('detects PE channel on sub-pages', () => {
    expect(detectYouTube(parse('https://www.youtube.com/@veritasium/videos')).status).toBe('warning');
    expect(detectYouTube(parse('https://www.youtube.com/@mrbeast/community')).status).toBe('warning');
  });

  test('detects each PE firm via a representative channel', () => {
    const cases = [
      ['https://www.youtube.com/@fireship',     'Electrify Video Partners'],
      ['https://www.youtube.com/@dudeperfect',  'Spotter'],
      ['https://www.youtube.com/@react',        'Electric Monster'],
      ['https://www.youtube.com/@gametheory',   'Lunar X'],
      ['https://www.youtube.com/@realstories',  'Little Dot Studios'],
      ['https://www.youtube.com/@donutmedia',   'Recurrent Ventures'],
    ];
    for (const [url, firm] of cases) {
      const result = detectYouTube(parse(url));
      expect(result.status).toBe('warning');
      expect(result.ownerInfo).toBe(firm);
    }
  });
});

// ---------------------------------------------------------------------------
// detectYouTube — legacy URL formats
// ---------------------------------------------------------------------------

describe('detectYouTube — legacy URL formats', () => {
  function parse(url) { return new URL(url); }

  test('/c/slug matches when slug equals a known handle', () => {
    expect(detectYouTube(parse('https://www.youtube.com/c/veritasium')).status).toBe('warning');
  });

  test('/user/username matches when username equals a known handle', () => {
    expect(detectYouTube(parse('https://www.youtube.com/user/veritasium')).status).toBe('warning');
  });

  test('/c/ with unknown slug returns safe', () => {
    expect(detectYouTube(parse('https://www.youtube.com/c/unknownchannel')).status).toBe('safe');
  });
});

// ---------------------------------------------------------------------------
// detectYouTube — non-channel pages (unknown — no channel context)
// ---------------------------------------------------------------------------

describe('detectYouTube — non-channel pages', () => {
  function parse(url) { return new URL(url); }

  test('YouTube homepage returns unknown', () => {
    expect(detectYouTube(parse('https://www.youtube.com/')).status).toBe('unknown');
  });

  test('subscriptions feed returns unknown', () => {
    expect(detectYouTube(parse('https://www.youtube.com/feed/subscriptions')).status).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// detectYouTube — /watch and /shorts pages (page-content detection)
// ---------------------------------------------------------------------------

describe('detectYouTube — /watch pages via ytInitialData', () => {
  function makeYtData(canonicalBaseUrl) {
    return {
      contents: {
        twoColumnWatchNextResults: {
          results: {
            results: {
              contents: [{
                videoSecondaryInfoRenderer: {
                  owner: {
                    videoOwnerRenderer: {
                      navigationEndpoint: {
                        browseEndpoint: { canonicalBaseUrl },
                      },
                    },
                  },
                },
              }],
            },
          },
        },
      },
    };
  }

  function parse(url) { return new URL(url); }

  beforeEach(() => { delete window.ytInitialData; });

  test('detects PE channel owner via ytInitialData', () => {
    window.ytInitialData = makeYtData('/@veritasium');
    expect(detectYouTube(parse('https://www.youtube.com/watch?v=abc')).status).toBe('warning');
  });

  test('non-PE channel via ytInitialData returns safe', () => {
    window.ytInitialData = makeYtData('/@mkbhd');
    expect(detectYouTube(parse('https://www.youtube.com/watch?v=abc')).status).toBe('safe');
  });

  test('returns unknown when ytInitialData is absent and DOM has no channel links', () => {
    // No ytInitialData and no DOM channel links — data hasn't loaded yet.
    // Caller should retry rather than treating this as confirmed safe.
    expect(detectYouTube(parse('https://www.youtube.com/watch?v=abc')).status).toBe('unknown');
  });

  test('ignores stale ytInitialData when its video ID differs from the current URL', () => {
    // Simulate navigating from a PE-owned video to a different video before
    // YouTube has updated ytInitialData. The stale PE data must not cause a
    // false positive on the new (non-PE) video page.
    window.ytInitialData = {
      ...makeYtData('/@veritasium'),
      currentVideoEndpoint: { watchEndpoint: { videoId: 'old_pe_video' } },
    };
    const result = detectYouTube(parse('https://www.youtube.com/watch?v=new_video'));
    expect(result.status).toBe('unknown'); // stale — not a false positive warning
  });

  test('uses ytInitialData when its video ID matches the current URL', () => {
    window.ytInitialData = {
      ...makeYtData('/@veritasium'),
      currentVideoEndpoint: { watchEndpoint: { videoId: 'matching_id' } },
    };
    const result = detectYouTube(parse('https://www.youtube.com/watch?v=matching_id'));
    expect(result.status).toBe('warning');
  });

  test('detects PE channel on a /shorts page', () => {
    window.ytInitialData = makeYtData('/@mrbeast');
    expect(detectYouTube(parse('https://www.youtube.com/shorts/abc')).status).toBe('warning');
  });
});

describe('detectYouTube — /watch pages via DOM fallback', () => {
  function parse(url) { return new URL(url); }

  beforeEach(() => {
    delete window.ytInitialData;
    document.body.innerHTML = '';
  });

  test('detects PE channel from DOM owner link', () => {
    document.body.innerHTML = `<ytd-channel-name><a href="/@veritasium">Channel</a></ytd-channel-name>`;
    expect(detectYouTube(parse('https://www.youtube.com/watch?v=abc')).status).toBe('warning');
  });

  test('non-PE channel in DOM owner link returns safe', () => {
    document.body.innerHTML = `<ytd-channel-name><a href="/@mkbhd">Channel</a></ytd-channel-name>`;
    expect(detectYouTube(parse('https://www.youtube.com/watch?v=abc')).status).toBe('safe');
  });
});

// ---------------------------------------------------------------------------
// extractHandleFromYtData
// ---------------------------------------------------------------------------

describe('extractHandleFromYtData', () => {
  test('extracts handle from video watch page data', () => {
    const ytData = {
      contents: {
        twoColumnWatchNextResults: {
          results: { results: { contents: [{
            videoSecondaryInfoRenderer: {
              owner: { videoOwnerRenderer: {
                navigationEndpoint: { browseEndpoint: { canonicalBaseUrl: '/@veritasium' } },
              }},
            },
          }]}},
        },
      },
    };
    expect(extractHandleFromYtData(ytData)).toBe('veritasium');
  });

  test('extracts handle from channel page header data', () => {
    const ytData = {
      header: { c4TabbedHeaderRenderer: {
        navigationEndpoint: { browseEndpoint: { canonicalBaseUrl: '/@fireship' } },
      }},
    };
    expect(extractHandleFromYtData(ytData)).toBe('fireship');
  });

  test('returns null when no handle can be found', () => {
    expect(extractHandleFromYtData({})).toBeNull();
    expect(extractHandleFromYtData({ contents: {} })).toBeNull();
  });

  test('returns null for null/undefined without throwing', () => {
    expect(extractHandleFromYtData(null)).toBeNull();
    expect(extractHandleFromYtData(undefined)).toBeNull();
  });
});
