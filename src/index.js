import * as core from '@actions/core';
import {
  buildRequest,
  callPangolinfo,
  parseInteger,
  parseRequestJson,
  resolveOutputPath,
  writeResult,
} from './pangolinfo.js';

async function run() {
  try {
    const token = core.getInput('token', { required: true });
    core.setSecret(token);
    const product = core.getInput('product', { required: true }).trim();
    const body = parseRequestJson(core.getInput('request', { required: true }));
    const definition = buildRequest(product, body);
    const timeoutSeconds = parseInteger(core.getInput('timeout-seconds') || '180', 'timeout-seconds', 10, 300);
    const maxAttempts = parseInteger(core.getInput('max-attempts') || '3', 'max-attempts', 1, 5);
    const outputFormat = (core.getInput('output-format') || 'envelope').trim();
    if (!['envelope', 'raw'].includes(outputFormat)) throw new Error('output-format must be envelope or raw');
    const destination = resolveOutputPath(process.env.GITHUB_WORKSPACE, core.getInput('output-file') || 'pangolinfo-result.json');

    core.info(`Requesting ${definition.title}; response content will be written to a file, not printed to logs.`);
    const result = await callPangolinfo({
      endpoint: definition.endpoint,
      body: definition.body,
      token,
      timeoutMs: timeoutSeconds * 1000,
      maxAttempts,
      onRetry: ({ attempt, status, delay }) => core.warning(
        `Attempt ${attempt} failed${status ? ` with HTTP ${status}` : ''}; retrying in ${delay / 1000}s.`,
      ),
    });

    const output = outputFormat === 'raw' ? result.data : {
      metadata: {
        generatedAt: new Date().toISOString(),
        product,
        endpoint: definition.endpoint,
        status: result.status,
        requestId: result.requestId || null,
        attempts: result.attempts,
      },
      data: result.data,
    };
    await writeResult(destination, output);

    core.setOutput('output-file', destination);
    core.setOutput('status-code', String(result.status));
    core.setOutput('request-id', result.requestId);
    core.setOutput('product', product);
    core.setOutput('endpoint', definition.endpoint);
    await core.summary
      .addHeading('Pangolinfo data export')
      .addTable([
        [{ data: 'Field', header: true }, { data: 'Value', header: true }],
        ['Product', definition.title],
        ['HTTP status', String(result.status)],
        ['Attempts', String(result.attempts)],
        ['Output', destination],
      ])
      .addLink('Product overview', `${definition.productUrl}?utm_source=github_marketplace&utm_medium=integration&utm_campaign=${product.replaceAll('-', '_')}`)
      .addRaw(' · ')
      .addLink('API documentation', definition.docsUrl)
      .write();
    core.info(`Saved ${definition.title} response to ${destination}.`);
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

await run();
