import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildRequest,
  callPangolinfo,
  parseInteger,
  parseRequestJson,
  resolveOutputPath,
  writeResult,
} from '../src/pangolinfo.js';

test('builds each fixed product endpoint', () => {
  assert.equal(buildRequest('amazon-scraper', { parserName: 'amzProductDetail', site: 'amz_us' }).endpoint,
    'https://scrapeapi.pangolinfo.com/api/v1/scrape');
  assert.equal(buildRequest('ai-overview', { parserName: 'googleSearch', url: 'https://www.google.com/search?q=test' }).path,
    '/api/v2/scrape');
  assert.equal(buildRequest('amazon-niche', { marketplaceId: 'US' }).path,
    '/api/v1/amzscope/niches/filter');
  assert.equal(buildRequest('amazon-alexa', { parserName: 'amazonAlexa', param: ['quiet fan'] }).path,
    '/api/v2/scrape');
});

test('rejects unsupported product, parser, and target domain', () => {
  assert.throws(() => buildRequest('custom', {}), /product must be one of/);
  assert.throws(() => buildRequest('ai-overview', { parserName: 'other', url: 'https://www.google.com/' }), /googleSearch/);
  assert.throws(() => buildRequest('ai-overview', { parserName: 'googleSearch', url: 'https://example.com/' }), /unsupported domain/);
  assert.throws(() => buildRequest('amazon-alexa', { parserName: 'amazonAlexa', param: [] }), /between 1 and 5/);
});

test('parses JSON and bounded integers', () => {
  assert.deepEqual(parseRequestJson('{"marketplaceId":"US"}'), { marketplaceId: 'US' });
  assert.throws(() => parseRequestJson('[]'), /JSON object/);
  assert.equal(parseInteger('3', 'attempts', 1, 5), 3);
  assert.throws(() => parseInteger('3.5', 'attempts', 1, 5), /integer/);
});

test('keeps output inside the workspace', () => {
  assert.equal(resolveOutputPath('/tmp/workspace', 'data/result.json'), '/tmp/workspace/data/result.json');
  assert.throws(() => resolveOutputPath('/tmp/workspace', '../token.txt'), /inside GITHUB_WORKSPACE/);
  assert.throws(() => resolveOutputPath('/tmp/workspace', '/tmp/result.json'), /relative path/);
});

test('calls the API without logging response content', async () => {
  const seen = [];
  const result = await callPangolinfo({
    endpoint: 'https://scrapeapi.pangolinfo.com/api/v1/scrape',
    body: { parserName: 'amzProductDetail' },
    token: 'secret',
    timeoutMs: 1000,
    maxAttempts: 1,
    fetchImpl: async (url, init) => {
      seen.push({ url, init });
      return new Response(JSON.stringify({ data: [{ asin: 'B000TEST' }] }), {
        status: 200,
        headers: { 'x-request-id': 'req-123' },
      });
    },
  });
  assert.equal(seen[0].init.headers.Authorization, 'Bearer secret');
  assert.equal(result.status, 200);
  assert.equal(result.requestId, 'req-123');
  assert.deepEqual(result.data.data[0], { asin: 'B000TEST' });
});

test('returns actionable authentication errors', async () => {
  await assert.rejects(() => callPangolinfo({
    endpoint: 'https://scrapeapi.pangolinfo.com/api/v1/scrape',
    body: {}, token: 'bad', timeoutMs: 1000, maxAttempts: 1,
    fetchImpl: async () => new Response('{"message":"raw error hidden"}', { status: 401 }),
  }), /Authentication failed/);
});

test('writes private JSON output', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pangolinfo-action-'));
  const destination = path.join(directory, 'nested', 'result.json');
  await writeResult(destination, { ok: true });
  assert.deepEqual(JSON.parse(await readFile(destination, 'utf8')), { ok: true });
});
