import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { parse } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, existsSync } from 'fs';
import { registerTools } from './tools/index.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = join(__dirname, '..', '.env');

if (existsSync(envPath)) {
  try {
    const envFile = readFileSync(envPath, 'utf-8');
    const parsed = parse(envFile);
    // Set environment variables without any console output
    for (const [key, value] of Object.entries(parsed)) {
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch (error) {
    // Silently fail if .env file can't be read
  }
}

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

