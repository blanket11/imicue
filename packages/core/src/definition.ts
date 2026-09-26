import type { Definition } from './types.js';

export class ValidationError extends Error {
  readonly code = 'invalid_definition';
  constructor(readonly field: string) {
    super(`Invalid definition field: ${field}`);
    this.name = 'ValidationError';
  }
}

const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);
export const isId = (value: unknown): value is string =>
  typeof value === 'string' && value.length >= 1 && value.length <= 64 &&
  /^[a-z0-9][a-z0-9_-]*$/.test(value) && !forbiddenKeys.has(value);

export function own<T>(dictionary: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(dictionary, key) ? dictionary[key] : undefined;
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

function plain(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new ValidationError(field);
  for (const key of Object.keys(value)) if (forbiddenKeys.has(key)) throw new ValidationError(field);
  return value as Record<string, unknown>;
}

function fields(value: Record<string, unknown>, permitted: readonly string[], field: string): void {
  if (Object.keys(value).some((key) => !permitted.includes(key))) throw new ValidationError(field);
}

function text(value: unknown, max: number, field: string): asserts value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || !value.trim()) {
    throw new ValidationError(field);
  }
}

function id(value: unknown, field: string): asserts value is string {
  if (!isId(value)) throw new ValidationError(field);
}

function meaning(value: Record<string, unknown>, field: string): void {
  text(value.description, 1_000, `${field}.description`);
  if (value.modelDescription !== undefined) text(value.modelDescription, 1_000, `${field}.modelDescription`);
  if (value.label !== undefined) text(value.label, 120, `${field}.label`);
}

function dictionary(value: unknown, limit: number, field: string): Record<string, unknown> {
  const record = plain(value, field);
  if (Object.keys(record).length > limit) throw new ValidationError(field);
  for (const key of Object.keys(record)) id(key, field);
  return record;
}

function reference(value: unknown, target: Record<string, unknown>, field: string): void {
  id(value, field);
  if (own(target, value) === undefined) throw new ValidationError(field);
}

function references(value: unknown, target: Record<string, unknown>, field: string): void {
  if (!Array.isArray(value) || value.length > Object.keys(target).length || new Set(value).size !== value.length) {
    throw new ValidationError(field);
  }
  for (const item of value) reference(item, target, field);
}

function utcTime(value: unknown, field: string): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    throw new ValidationError(field);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value.replace(/(?<!\.\d{3})Z$/, '.000Z')) {
    throw new ValidationError(field);
  }
  return timestamp;
}

/** Parse paths against a fixed origin so backslashes cannot bypass origin checks. */
export function isAllowedHref(href: string, allowedOrigins: readonly string[] = []): boolean {
  if (typeof href !== 'string' || !href || href !== href.trim() ||
    [...href].some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127 || character === '\\')) return false;
  try {
    if (href.startsWith('/')) {
      if (href.startsWith('//')) return false;
      const relative = new URL(href, 'https://imicue.invalid');
      return relative.origin === 'https://imicue.invalid' && !relative.username && !relative.password;
    }
    const url = new URL(href);
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    return allowedOrigins.some((origin) => {
      const allowed = new URL(origin);
      return allowed.protocol === 'https:' && !allowed.username && !allowed.password &&
        allowed.pathname === '/' && !allowed.search && !allowed.hash && allowed.origin === url.origin;
    });
  } catch {
    return false;
  }
}

export interface DefinitionOptions {
  allowedOrigins?: readonly string[];
  onWarning?: (code: 'candidate_capacity') => void;
}

/** Returns a validated, independent and deeply frozen copy. */
export function validateDefinition(input: unknown, options: DefinitionOptions = {}): Definition {
  const value = plain(input, 'definition');
  fields(value, ['schemaVersion', 'siteId', 'definitionVersion', 'topics', 'signals', 'contents', 'pages'], 'definition');
  if (value.schemaVersion !== '0.1') throw new ValidationError('schemaVersion');
  id(value.siteId, 'siteId');
  text(value.definitionVersion, 120, 'definitionVersion');
  const topics = dictionary(value.topics ?? {}, 32, 'topics');
  const signals = dictionary(value.signals, 200, 'signals');
  const contents = dictionary(value.contents, 20, 'contents');
  const pages = dictionary(value.pages, 100, 'pages');
  for (const [key, entry] of Object.entries(topics)) {
    const item = plain(entry, `topics.${key}`);
    fields(item, ['label', 'description', 'modelDescription'], `topics.${key}`);
    meaning(item, `topics.${key}`);
  }
  for (const [key, entry] of Object.entries(signals)) {
    const item = plain(entry, `signals.${key}`);
    fields(item, ['label', 'description', 'modelDescription', 'kind', 'productId', 'topicIds', 'contentId'], `signals.${key}`);
    meaning(item, `signals.${key}`);
    if (item.kind !== 'content' && item.kind !== 'action') throw new ValidationError(`signals.${key}.kind`);
    if (item.productId !== undefined) id(item.productId, `signals.${key}.productId`);
    if (item.topicIds !== undefined) references(item.topicIds, topics, `signals.${key}.topicIds`);
    if (item.contentId !== undefined) reference(item.contentId, contents, `signals.${key}.contentId`);
  }
  for (const [key, entry] of Object.entries(contents)) {
    const item = plain(entry, `contents.${key}`);
    fields(item, ['label', 'description', 'modelDescription', 'title', 'href', 'productId', 'topicIds', 'relatedSignalIds', 'enabled', 'availableFrom', 'availableUntil'], `contents.${key}`);
    meaning(item, `contents.${key}`);
    text(item.title, 120, `contents.${key}.title`);
    if (typeof item.href !== 'string' || !isAllowedHref(item.href, options.allowedOrigins)) throw new ValidationError(`contents.${key}.href`);
    if (typeof item.enabled !== 'boolean') throw new ValidationError(`contents.${key}.enabled`);
    if (item.productId !== undefined) id(item.productId, `contents.${key}.productId`);
    if (item.topicIds !== undefined) references(item.topicIds, topics, `contents.${key}.topicIds`);
    if (item.relatedSignalIds !== undefined) references(item.relatedSignalIds, signals, `contents.${key}.relatedSignalIds`);
    const from = item.availableFrom === undefined ? -Infinity : utcTime(item.availableFrom, `contents.${key}.availableFrom`);
    const until = item.availableUntil === undefined ? Infinity : utcTime(item.availableUntil, `contents.${key}.availableUntil`);
    if (from >= until) throw new ValidationError(`contents.${key}.availability`);
  }
  for (const [key, entry] of Object.entries(pages)) {
    const item = plain(entry, `pages.${key}`);
    fields(item, ['productId', 'contentId'], `pages.${key}`);
    if (item.productId !== undefined) id(item.productId, `pages.${key}.productId`);
    if (item.contentId !== undefined) reference(item.contentId, contents, `pages.${key}.contentId`);
  }
  if (Object.keys(contents).length > 8) options.onWarning?.('candidate_capacity');
  return deepFreeze(JSON.parse(JSON.stringify(input)) as Definition);
}
