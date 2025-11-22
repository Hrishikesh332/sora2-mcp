# Sora MCP Server

A Model Context Protocol (MCP) server that integrates with OpenAI's Sora 2 API for video generation and remixing.

## Features

- **Create Videos**: Generate videos from text prompts using Sora 2
- **Remix Videos**: Create variations of existing videos with new prompts
- **Video Status**: Check the status and progress of video generation jobs

### 1. Create Environment File

Create a `.env` file in the project root with your OpenAI API key:

```bash
# Create .env file
cat > .env << EOF
OPENAI_API_KEY=your-openai-api-key-here
DOWNLOAD_DIR=your_download_DIR
PORT=3000
EOF
```


**Get your API key from:** https://platform.openai.com/api-keys

### 2. Configure for Claude Desktop (Optional)

If you want to use this with Claude Desktop:

1. Copy the example config:
   ```bash
   cp claude_desktop_config.example.json ~/Library/Application\ Support/Claude/claude_desktop_config.json
   ```

2. Edit the config file and update:
   - `args`: Change `/ABSOLUTE/PATH/TO/sora-mcp/dist/stdio-server.js`
   - `OPENAI_API_KEY`: Add your actual API key
   - `DOWNLOAD_DIR`: Set your preferred download folder (optional)

3. Restart Claude Desktop

### 3. Test the Server

#### HTTP Mode (for testing with MCP Inspector):

```bash
npm run dev
```

Then in another terminal:
```bash
npx @modelcontextprotocol/inspector
```

Connect to: `http://localhost:3000/mcp`

#### Production Mode:

```bash
npm start
```

## Available Commands

- `npm run dev` - Run in development mode (auto-reload)
- `npm run build` - Compile TypeScript to JavaScript
- `npm start` - Run the compiled server

## Project Structure

```
new sora2/
├── src/
│   ├── server.ts          # HTTP server (for MCP Inspector, web clients)
│   └── stdio-server.ts    # stdio server (for Claude Desktop)
├── dist/                  # Compiled JavaScript
├── package.json
├── tsconfig.json
└── .env                   # Create this file with your API key
```

## Usage

### For Claude Desktop (stdio mode)

Claude Desktop will automatically start the server when configured. Just make sure:
1. Your `.env` file has your `OPENAI_API_KEY`
2. Restart Claude Desktop after updating the config

The config uses `src/stdio-server.ts` which communicates via stdio.

### For HTTP Mode (MCP Inspector, web clients)

Run the server in development mode with auto-reload:

```bash
npm run dev
```

Or in production mode:

```bash
npm run build
npm start
```

## Connecting to MCP Clients

### Claude Desktop

The server is already configured! 

**Setup:**
The configuration is at: `~/Library/Application Support/Claude/claude_desktop_config.json`

It uses the compiled server and passes your API key via environment variables:
```json
{
  "mcpServers": {
    "sora-server": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/sora-mcp/dist/stdio-server.js"],
      "env": {
        "OPENAI_API_KEY": "your-openai-api-key-here",
        "DOWNLOAD_DIR": "/Users/yourname/Downloads/sora"
      }
    }
  }
}
```

See `claude_desktop_config.example.json` for a complete example.

**Environment Variables:**
- `OPENAI_API_KEY` (required) - Your OpenAI API key
- `DOWNLOAD_DIR` (optional) - Custom download folder (defaults to ~/Downloads)

**To use:**
1. Restart Claude Desktop (Cmd+Q then relaunch)
2. The Sora tools will appear automatically!

### MCP Inspector (for testing)

Test your server with the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector
```

Then connect to: `http://localhost:3000/mcp`

### Claude Code

```bash
claude mcp add --transport http sora-server http://localhost:3000/mcp
```

### VS Code

```bash
code --add-mcp '{"name":"sora-server","type":"http","url":"http://localhost:3000/mcp"}'
```
