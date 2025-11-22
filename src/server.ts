import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { createServer } from './server-setup.js';

// Create server instance
const server = createServer();

// Set up Express and HTTP transport
const app = express();
app.use(express.json());

app.post('/mcp', async (req, res) => {
  // Create a new transport for each request to prevent request ID collisions
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });

  res.on('close', () => {
    transport.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

const port = parseInt(process.env.PORT || '3001', 10);
const host = process.env.HOST || '0.0.0.0';

app.listen(port, host, () => {
  console.log(`Sora MCP Server running on http://${host}:${port}`);
  console.log(`HTTP endpoint: http://${host}:${port}/mcp`);
  console.log('Connect using MCP Inspector: npx @modelcontextprotocol/inspector');
}).on('error', error => {
  console.error('Server error:', error);
  process.exit(1);
});
