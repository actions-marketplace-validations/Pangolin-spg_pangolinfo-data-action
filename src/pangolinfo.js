import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const API_ORIGIN = 'https://scrapeapi.pangolinfo.com';

export const PRODUCTS = Object.freeze({
  'amazon-scraper': {
    path: '/api/v1/scrape',
    title: 'Amazon Scraper API',
    productUrl: 'https://www.pangolinfo.com/amazon-scraper-api/',
    docsUrl: 'https://docs.pangolinfo.com/en-api-reference/amazonApi/amazonScrapeAPI',
    validate(body) {
      requireString(body.parserName, 'request.parserName');
      requireString(body.site, 'request.site');
    },
  },
  'ai-overview': {
    path: '/api/v2/scrape',
    title: 'AI Overview SERP API',
    productUrl: 'https://www.pangolinfo.com/ai-overview-serp-api/',
    docsUrl: 'https://docs.pangolinfo.com/en-api-reference/aiModeSerpApi/serpSubmit',
    validate(body) {
      requireParser(body, 'googleSearch');
      requireHttpsUrl(body.url, 'request.url', ['google.com', 'google.co.uk', 'google.de', 'google.fr', 'google.it', 'google.es', 'google.ca', 'google.co.jp']);
    },
  },
  'amazon-niche': {
    path: '/api/v1/amzscope/niches/filter',
    title: 'Amazon Niche Data API',
    productUrl: 'https://www.pangolinfo.com/amazon-niche-data-api/',
    docsUrl: 'https://docs.pangolinfo.com/en-api-reference/nicheFilterAPI/nicheFilterAPI',
    validate(body) {
      requireString(body.marketplaceId, 'request.marketplaceId');
    },
  },
  'amazon-alexa': {
    path: '/api/v2/scrape',
    title: 'Amazon Alexa for Shopping API',
    productUrl: 'https://www.pangolinfo.com/amazon-alexa-api/',
    docsUrl: 'https://docs.pangolinfo.com/en-api-reference/amazonAlexaAPI/amazonAlexaAPI',
    validate(body) {
      requireParser(body, 'amazonAlexa');
      if (!Array.isArray(body.param) || body.param.length < 1 || body.param.length > 5) {
        throw new Error('request.param must contain between 1 and 5 prompts');
      }
      body.param.forEach((value, index) => requireString(value, `request.param[${index}]`));
      if (body.url) requireHttpsUrl(body.url, 'request.url', ['amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon.fr', 'amazon.it', 'amazon.es', 'amazon.ca', 'amazon.co.jp']);
    },
  },
});

function requireString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} must be a non-empty string`);
  }
}

function requireParser(body, parserName) {
  if (body.parserName !== parserName) {
    throw new Error(`request.parserName must be ${parserName}`);
  }
}

function requireHttpsUrl(value, field, allowedDomains) {
  requireString(value, field);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${field} must be a valid URL`);
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error(`${field} must be an HTTPS URL without embedded credentials`);
  }
  const allowed = allowedDomains.some((domain) => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`));
  if (!allowed) throw new Error(`${field} uses an unsupported domain: ${parsed.hostname}`);
}

export function parseRequestJson(value) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`request must be valid JSON: ${error.message}`, { cause: error });
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('request must be a JSON object');
  }
  return parsed;
}

export function buildRequest(product, body) {
  const definition = PRODUCTS[product];
  if (!definition) {
    throw new Error(`product must be one of: ${Object.keys(PRODUCTS).join(', ')}`);
  }
  definition.validate(body);
  return {
    ...definition,
    product,
    endpoint: `${API_ORIGIN}${definition.path}`,
    body,
  };
}

export function parseInteger(value, name, minimum, maximum) {
  if (!/^\d+$/.test(String(value))) throw new Error(`${name} must be an integer`);
  const parsed = Number(value);
  if (parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

export function resolveOutputPath(workspace, outputFile) {
  if (!workspace) throw new Error('GITHUB_WORKSPACE is not available');
  if (!outputFile || path.isAbsolute(outputFile)) throw new Error('output-file must be a relative path');
  const root = path.resolve(workspace);
  const destination = path.resolve(root, outputFile);
  if (destination !== root && !destination.startsWith(`${root}${path.sep}`)) {
    throw new Error('output-file must stay inside GITHUB_WORKSPACE');
  }
  if (destination === root) throw new Error('output-file must name a file');
  return destination;
}

function retryDelay(response, attempt) {
  const retryAfter = response?.headers?.get?.('retry-after');
  if (retryAfter && /^\d+$/.test(retryAfter)) return Math.min(Number(retryAfter) * 1000, 30_000);
  return Math.min(1000 * (2 ** (attempt - 1)), 10_000);
}

function shouldRetry(status) {
  return status === 429 || status >= 500;
}

function messageForStatus(status) {
  if (status === 401 || status === 403) return 'Authentication failed. Check PANGOLINFO_TOKEN and its permissions.';
  if (status === 402) return 'The Pangolinfo account has insufficient credits or quota.';
  if (status === 429) return 'Pangolinfo rate limit exceeded after all retry attempts.';
  if (status >= 500) return 'Pangolinfo service returned a server error after all retry attempts.';
  return `Pangolinfo API returned HTTP ${status}.`;
}

async function sleep(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function callPangolinfo({ endpoint, body, token, timeoutMs, maxAttempts, fetchImpl = fetch, onRetry = () => {} }) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'pangolinfo-data-action/1.0.0',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const raw = await response.text();
      let data;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        data = { message: 'Pangolinfo returned a non-JSON response.' };
      }
      if (response.ok) {
        return {
          data,
          status: response.status,
          requestId: response.headers.get('x-request-id') || response.headers.get('request-id') || '',
          attempts: attempt,
        };
      }
      if (shouldRetry(response.status) && attempt < maxAttempts) {
        const delay = retryDelay(response, attempt);
        onRetry({ attempt, status: response.status, delay });
        await sleep(delay);
        continue;
      }
      const error = new Error(messageForStatus(response.status));
      error.status = response.status;
      throw error;
    } catch (error) {
      lastError = error;
      const retryableNetworkError = error.name === 'AbortError' || error.status === undefined;
      if (retryableNetworkError && attempt < maxAttempts) {
        const delay = Math.min(1000 * (2 ** (attempt - 1)), 10_000);
        onRetry({ attempt, status: null, delay });
        await sleep(delay);
        continue;
      }
      if (error.name === 'AbortError') {
        throw new Error(`Pangolinfo request timed out after ${timeoutMs / 1000} seconds.`, { cause: error });
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error('Pangolinfo request failed');
}

export async function writeResult(destination, value) {
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}
