import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { registerTools } from './tools/index.js';

// Load .env file from the project directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '..', '.env') });

export function createServer(): McpServer {
  // Check for API key
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    console.error('Error: OPENAI_API_KEY environment variable is required');
    process.exit(1);
  }

  // Create MCP server
  const server = new McpServer({
    name: 'sora-mcp-server',
    version: '1.0.0'
  });

  // Register all tools
  registerTools(server);

  return server;
}

