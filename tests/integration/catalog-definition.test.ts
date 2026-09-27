import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { validateDefinition } from '@imicue/core';
import { catalogDefinition } from '../../examples/vanilla/catalog/definition.js';

describe('shared static/server catalog', () => {
  it('pins the content hash and represents 100 distinct destinations', () => {
    const { definitionVersion, ...content } = catalogDefinition;
    expect(definitionVersion).toBe(`catalog-${createHash('sha256').update(JSON.stringify(content)).digest('hex').slice(0, 16)}`);
    const validated = validateDefinition(catalogDefinition);
    expect(Object.keys(validated.contents)).toHaveLength(100);
    expect(new Set(Object.values(validated.contents).map((item) => item.href)).size).toBe(100);
    expect(Object.keys(validated.pages)).toHaveLength(102);
  });
});
