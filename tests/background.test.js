// background.test.js
// The chrome global must be set up before background.js is loaded, because
// background.js calls chrome.*addListener at module evaluation time.

// Capture registered listeners so tests can invoke them directly.
const listeners = {
  message: null,
  tabUpdated: null,
  tabRemoved: null,
};

global.chrome = {
  runtime: {
    onMessage: {
      addListener: jest.fn((fn) => { listeners.message = fn; }),
    },
  },
  action: {
    setTitle: jest.fn(),
    setIcon: jest.fn(),
  },
  tabs: {
    onUpdated: {
      addListener: jest.fn((fn) => { listeners.tabUpdated = fn; }),
    },
    onRemoved: {
      addListener: jest.fn((fn) => { listeners.tabRemoved = fn; }),
    },
  },
};

// Load background.js after chrome is mocked — it registers its listeners here.
require('../background.js');

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Listener registration
// ---------------------------------------------------------------------------

describe('listener registration', () => {
  test('registers a message listener', () => {
    expect(typeof listeners.message).toBe('function');
  });

  test('registers a tabs.onUpdated listener', () => {
    expect(typeof listeners.tabUpdated).toBe('function');
  });

  test('registers a tabs.onRemoved listener', () => {
    expect(typeof listeners.tabRemoved).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// PAGE_CHECK_RESULT — warning state
// ---------------------------------------------------------------------------

describe('PAGE_CHECK_RESULT: status = warning', () => {
  const sender = { tab: { id: 42 } };

  test('sets title naming the PE firm when ownerInfo is provided', () => {
    listeners.message(
      { type: 'PAGE_CHECK_RESULT', status: 'warning', ownerInfo: 'Spotter' },
      sender
    );
    expect(chrome.action.setTitle).toHaveBeenCalledWith({
      tabId: 42,
      title: 'Private Equity Watch: Owned by Spotter',
    });
  });

  test('sets generic PE title when ownerInfo is null', () => {
    listeners.message(
      { type: 'PAGE_CHECK_RESULT', status: 'warning', ownerInfo: null },
      sender
    );
    expect(chrome.action.setTitle).toHaveBeenCalledWith({
      tabId: 42,
      title: 'Private Equity Watch: PE-owned',
    });
  });

  test('sets the warning icon', () => {
    listeners.message({ type: 'PAGE_CHECK_RESULT', status: 'warning' }, sender);
    const call = chrome.action.setIcon.mock.calls[0][0];
    expect(call.tabId).toBe(42);
    expect(call.path[16]).toContain('warning');
  });
});

// ---------------------------------------------------------------------------
// PAGE_CHECK_RESULT — safe state
// ---------------------------------------------------------------------------

describe('PAGE_CHECK_RESULT: status = safe', () => {
  const sender = { tab: { id: 7 } };

  test('sets the safe icon', () => {
    listeners.message({ type: 'PAGE_CHECK_RESULT', status: 'safe' }, sender);
    const call = chrome.action.setIcon.mock.calls[0][0];
    expect(call.tabId).toBe(7);
    expect(call.path[16]).toContain('safe');
  });

  test('sets the safe title', () => {
    listeners.message({ type: 'PAGE_CHECK_RESULT', status: 'safe' }, sender);
    expect(chrome.action.setTitle).toHaveBeenCalledWith({
      tabId: 7,
      title: 'Private Equity Watch: No PE ownership detected',
    });
  });
});

// ---------------------------------------------------------------------------
// PAGE_CHECK_RESULT — unknown state
// ---------------------------------------------------------------------------

describe('PAGE_CHECK_RESULT: status = unknown', () => {
  const sender = { tab: { id: 3 } };

  test('sets the default icon', () => {
    listeners.message({ type: 'PAGE_CHECK_RESULT', status: 'unknown' }, sender);
    const call = chrome.action.setIcon.mock.calls[0][0];
    expect(call.tabId).toBe(3);
    expect(call.path[16]).not.toContain('warning');
    expect(call.path[16]).not.toContain('safe');
  });

  test('sets the default title', () => {
    listeners.message({ type: 'PAGE_CHECK_RESULT', status: 'unknown' }, sender);
    expect(chrome.action.setTitle).toHaveBeenCalledWith({
      tabId: 3,
      title: 'Private Equity Watch',
    });
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('message listener edge cases', () => {
  test('ignores messages with unknown type', () => {
    listeners.message({ type: 'SOMETHING_ELSE', status: 'warning' }, { tab: { id: 1 } });
    expect(chrome.action.setIcon).not.toHaveBeenCalled();
  });

  test('ignores messages with no sender tab', () => {
    listeners.message({ type: 'PAGE_CHECK_RESULT', status: 'warning' }, {});
    expect(chrome.action.setIcon).not.toHaveBeenCalled();
  });

  test('ignores messages with undefined sender', () => {
    listeners.message({ type: 'PAGE_CHECK_RESULT', status: 'warning' }, undefined);
    expect(chrome.action.setIcon).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tab lifecycle
// ---------------------------------------------------------------------------

describe('tabs.onUpdated', () => {
  test('sets default icon when status is "loading"', () => {
    listeners.tabUpdated(99, { status: 'loading' });
    const call = chrome.action.setIcon.mock.calls[0][0];
    expect(call.tabId).toBe(99);
    expect(call.path[16]).not.toContain('warning');
    expect(call.path[16]).not.toContain('safe');
  });

  test('does nothing when status is not "loading"', () => {
    listeners.tabUpdated(99, { status: 'complete' });
    expect(chrome.action.setIcon).not.toHaveBeenCalled();
  });

  test('does nothing when changeInfo has no status', () => {
    listeners.tabUpdated(99, {});
    expect(chrome.action.setIcon).not.toHaveBeenCalled();
  });
});

describe('tabs.onRemoved', () => {
  test('resets to default icon when a tab is closed', () => {
    listeners.tabRemoved(55);
    const call = chrome.action.setIcon.mock.calls[0][0];
    expect(call.tabId).toBe(55);
    expect(call.path[16]).not.toContain('warning');
    expect(call.path[16]).not.toContain('safe');
  });
});
