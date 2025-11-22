import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server-setup.js';

// Create server instance
const server = createServer();

// Connect with stdio transport for Claude Desktop
const transport = new StdioServerTransport();
await server.connect(transport);

console.error('Sora MCP Server running via stdio');
