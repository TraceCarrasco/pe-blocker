const { PE_ENTITIES } = require('../pe-channels.js');

describe('PE_ENTITIES structure', () => {
  test('youtubeHandles is a Set', () => {
    expect(PE_ENTITIES.youtubeHandles).toBeInstanceOf(Set);
  });

  test('domains is a Set', () => {
    expect(PE_ENTITIES.domains).toBeInstanceOf(Set);
  });

  test('ownerInfo is a plain object', () => {
    expect(PE_ENTITIES.ownerInfo).toBeDefined();
    expect(typeof PE_ENTITIES.ownerInfo).toBe('object');
    expect(Array.isArray(PE_ENTITIES.ownerInfo)).toBe(false);
  });

  test('youtubeHandles is non-empty', () => {
    expect(PE_ENTITIES.youtubeHandles.size).toBeGreaterThan(0);
  });

  test('all YouTube handles are lowercase strings', () => {
    for (const handle of PE_ENTITIES.youtubeHandles) {
      expect(typeof handle).toBe('string');
      expect(handle).toBe(handle.toLowerCase());
      expect(handle.trim().length).toBeGreaterThan(0);
    }
  });

  test('every YouTube handle has a matching ownerInfo entry', () => {
    for (const handle of PE_ENTITIES.youtubeHandles) {
      expect(PE_ENTITIES.ownerInfo[handle]).toBeDefined();
      expect(typeof PE_ENTITIES.ownerInfo[handle]).toBe('string');
      expect(PE_ENTITIES.ownerInfo[handle].trim().length).toBeGreaterThan(0);
    }
  });

  test('every domain has a matching ownerInfo entry', () => {
    for (const domain of PE_ENTITIES.domains) {
      expect(PE_ENTITIES.ownerInfo[domain]).toBeDefined();
    }
  });

  test('every ownerInfo key is either a YouTube handle or a domain', () => {
    for (const key of Object.keys(PE_ENTITIES.ownerInfo)) {
      const inHandles = PE_ENTITIES.youtubeHandles.has(key);
      const inDomains = PE_ENTITIES.domains.has(key);
      expect(inHandles || inDomains).toBe(true);
    }
  });
});

describe('PE_ENTITIES known YouTube channels', () => {
  test.each([
    ['veritasium',        'Electrify Video Partners'],
    ['fireship',          'Electrify Video Partners'],
    ['mrbeast',           'Spotter'],
    ['dudeperfect',       'Spotter'],
    ['thetryguys',        'Spotter'],
    ['react',             'Electric Monster'],
    ['gametheory',        'Lunar X'],
    ['economicsexplained','Lunar X'],
    ['realstories',       'Little Dot Studios'],
    ['donutmedia',        'Recurrent Ventures'],
  ])('%s is mapped to %s', (handle, firm) => {
    expect(PE_ENTITIES.youtubeHandles.has(handle)).toBe(true);
    expect(PE_ENTITIES.ownerInfo[handle]).toBe(firm);
  });

  test('non-PE channels are not in the list', () => {
    for (const handle of ['mkbhd', 'linus', 'pewdiepie', 'kurzgesagt']) {
      expect(PE_ENTITIES.youtubeHandles.has(handle)).toBe(false);
    }
  });
});

describe('PE_ENTITIES PE firm coverage', () => {
  const firms = new Set(Object.values(PE_ENTITIES.ownerInfo));

  test.each([
    'Electrify Video Partners',
    'Spotter',
    'Electric Monster',
    'Lunar X',
    'Little Dot Studios',
    'Recurrent Ventures',
  ])('%s has at least one entry', (firm) => {
    expect(firms.has(firm)).toBe(true);
  });
});
