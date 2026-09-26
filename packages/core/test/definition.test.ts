import { describe, expect, it, vi } from 'vitest';
import { isAllowedHref, validateDefinition } from '../src/index.js';
import { definition } from './fixtures.js';

describe('C01: definition validation', () => {
  it('copies and deeply freezes the definition', () => {
    const source = definition();
    const result = validateDefinition(source);
    expect(result).toEqual(source);
    expect(result).not.toBe(source);
    expect(Object.isFrozen(result.signals.features)).toBe(true);
    expect(Object.isFrozen(result.signals.features?.topicIds)).toBe(true);
    expect(Object.isFrozen(source)).toBe(false);
  });

  it.each([
    { signals: { unknown: { kind: 'content', description: 'Synthetic', topicIds: ['unknown'] } } },
    { signals: { unknown: { kind: 'content', description: 'Synthetic', contentId: 'unknown' } } },
    { contents: { invalid: { title: 'Invalid', description: 'Synthetic', href: '/ok', enabled: true, relatedSignalIds: ['unknown'] } } },
    { pages: { invalid: { contentId: 'unknown' } } },
    { signals: { bad: { kind: 'content', description: '' } } },
    { signals: { bad: { kind: 'other', description: 'Synthetic' } } },
    { signals: { bad: { kind: 'content', description: 'Synthetic', topicIds: ['features', 'features'] } } },
    { siteId: 'not a fixed id' },
    { schemaVersion: '0.2' },
    { customInstructions: 'Synthetic untrusted instruction' },
  ])('rejects unknown references, duplicates, invalid values and unknown fields: %j', (patch) => {
    expect(() => validateDefinition({ ...definition(), ...patch })).toThrow();
  });

  it.each(['__proto__', 'constructor', 'prototype'])('rejects dangerous key %s', (key) => {
    const source = definition();
    const signals = JSON.parse(`{"${key}":{"kind":"content","description":"Synthetic"}}`) as unknown;
    expect(() => validateDefinition({ ...source, signals })).toThrow();
    expect(() => validateDefinition({ ...source, siteId: key })).toThrow();
  });

  it('rejects inherited definitions', () => {
    const inherited = Object.create({ inherited: { kind: 'content', description: 'Synthetic' } });
    expect(() => validateDefinition({ ...definition(), signals: inherited })).toThrow();
  });

  it.each(['javascript:alert(1)', 'data:text/html,no', '//evil.example/path', '/\\evil.example', '/\tevil', 'https://name:password@allowed.example/path', 'http://allowed.example/path', 'https://allowed.example.evil.test/path', ' https://allowed.example/path'])('blocks unsafe href %s', (href) => {
    expect(isAllowedHref(href, ['https://allowed.example'])).toBe(false);
    const source = definition();
    expect(() => validateDefinition({ ...source, contents: { ...source.contents, 'feature-guide': { ...source.contents['feature-guide'], href } } }, { allowedOrigins: ['https://allowed.example'] })).toThrow();
  });

  it('uses exact parsed origins and relative paths', () => {
    expect(isAllowedHref('/guides/features/?tab=1#part')).toBe(true);
    expect(isAllowedHref('https://allowed.example:443/guide', ['https://allowed.example'])).toBe(true);
    expect(isAllowedHref('https://allowed.example:444/guide', ['https://allowed.example'])).toBe(false);
    expect(isAllowedHref('https://allowed.example/guide')).toBe(false);
    expect(isAllowedHref('guide')).toBe(false);
  });

  it.each([
    { availableFrom: '2026-02-30T00:00:00Z' },
    { availableFrom: '2026-09-26' },
    { availableFrom: '2026-09-27T00:00:00+09:00' },
    { availableFrom: '2026-09-27T00:00:00Z', availableUntil: '2026-09-26T00:00:00Z' },
  ])('rejects invalid or reversed UTC periods %j', (period) => {
    const source = definition();
    expect(() => validateDefinition({ ...source, contents: { ...source.contents, 'feature-guide': { ...source.contents['feature-guide'], ...period } } })).toThrow();
  });

  it('accepts explicit UTC periods and milliseconds', () => {
    const source = definition();
    expect(() => validateDefinition({ ...source, contents: { ...source.contents, 'feature-guide': { ...source.contents['feature-guide'], availableFrom: '2026-09-26T00:00:00Z', availableUntil: '2026-09-27T00:00:00.123Z' } } })).not.toThrow();
  });

  it('warns above 8 candidates and rejects configuration above 20', () => {
    const warning = vi.fn();
    const source = definition();
    const contents = Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`candidate-${index}`, source.contents['feature-guide']!]));
    // The referenced content must exist even if it is disabled.
    contents['feature-guide'] = source.contents['feature-guide']!;
    validateDefinition({ ...source, contents }, { onWarning: warning });
    expect(warning).toHaveBeenCalledExactlyOnceWith('candidate_capacity');
    expect(() => validateDefinition({ ...source, contents: Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`candidate-${index}`, source.contents['feature-guide']])) })).toThrow();
  });
});
