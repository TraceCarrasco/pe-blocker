// tests/setup.js
// Globals that the extension files expect to find at runtime.
// Loaded before every test file via jest.setupFiles.

// Minimal chrome API stub — individual test files override specific methods
// with jest.fn() as needed.
global.chrome = {
  runtime: {
    onMessage: { addListener: () => {} },
    sendMessage: () => {},
  },
  action: {
    setBadgeText: () => {},
    setBadgeBackgroundColor: () => {},
    setTitle: () => {},
    setIcon: () => {},
  },
  tabs: {
    onUpdated: { addListener: () => {} },
    onRemoved: { addListener: () => {} },
  },
};
