import http from 'node:http';

export async function readJson(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 1_048_576) throw new Error('Request body is too large.');
    chunks.push(chunk);
  }
  if (length === 0) return null;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...headers,
  });
  response.end(body === null ? '' : JSON.stringify(body));
}

export function startServer(port, handler) {
  const server = http.createServer(async (request, response) => {
    try {
      await handler(request, response);
    } catch (error) {
      if (!response.headersSent) {
        sendJson(response, 500, { error: error instanceof Error ? error.message : 'Mock server error.' });
      } else {
        response.destroy(error instanceof Error ? error : undefined);
      }
    }
  });
  server.listen(port, '0.0.0.0', () => {
    process.stdout.write(`QA mock listening on 0.0.0.0:${port}\n`);
  });
  return server;
}

export function pathOf(request) {
  return new URL(request.url ?? '/', 'http://localhost').pathname;
}

export function noStore(response) {
  response.setHeader('Cache-Control', 'no-store');
}
