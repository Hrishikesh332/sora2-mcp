import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { z } from 'zod';
import { writeFile, mkdir, readFile, stat } from 'fs/promises';
import { resolve, basename } from 'path';
import { homedir } from 'os';
import sharp from 'sharp';

// Load .env file from the project directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '..', '.env') });

// Check for API key
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
    console.error('Error: OPENAI_API_KEY environment variable is required');
    process.exit(1);
}

// Get download directory from env or use default
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || join(homedir(), 'Downloads');

const SORA_API_BASE = 'https://api.openai.com/v1';

// Create MCP server
const server = new McpServer({
    name: 'sora-mcp-server',
    version: '1.0.0'
});

// Tool 1: Create Video
server.registerTool(
    'create-video',
    {
        title: 'Create Video',
        description: 'Generate a video using OpenAI Sora 2 API',
        inputSchema: {
            prompt: z.string().describe('Text prompt that describes the video to generate'),
            model: z.string().optional().default('sora-2').describe('The video generation model to use'),
            seconds: z.string().optional().default('4').describe('Clip duration in seconds'),
            size: z.string().optional().default('720x1280').describe('Output resolution formatted as width x height'),
            input_reference: z.string().optional().describe('Optional absolute or relative path to an image (JPEG, PNG, WEBP) or video file to use as reference. Images will be automatically resized to match the video size parameter. Supported formats: JPEG, PNG, WEBP for images; MP4, MOV, WEBM for videos.')
        }
    },
    async ({ prompt, model = 'sora-2', seconds = '4', size = '720x1280', input_reference }) => {
        try {
            const formData = new FormData();
            formData.append('model', model);
            formData.append('prompt', prompt);
            formData.append('seconds', seconds);
            formData.append('size', size);

            // Handle input_reference if provided
            if (input_reference) {
                try {
                    // Resolve the file path (handle both absolute and relative paths)
                    const filePath = resolve(input_reference);
                    
                    // Check if file exists
                    await stat(filePath);
                    
                    // Get the filename
                    const filename = basename(filePath);
                    
                    // Determine MIME type based on file extension
                    const ext = filename.toLowerCase().split('.').pop();
                    let mimeType = 'image/jpeg'; // default
                    if (ext === 'png') mimeType = 'image/png';
                    else if (ext === 'webp') mimeType = 'image/webp';
                    else if (ext === 'jpg' || ext === 'jpeg') mimeType = 'image/jpeg';
                    else if (ext === 'mp4') mimeType = 'video/mp4';
                    else if (ext === 'mov') mimeType = 'video/quicktime';
                    else if (ext === 'webm') mimeType = 'video/webm';
                    
                    // Parse video size to get dimensions (required for Sora API)
                    const sizeParts = size.split('x');
                    if (sizeParts.length !== 2) {
                        throw new Error(`Invalid size format: ${size}. Expected format: "widthxheight" (e.g., "720x1280")`);
                    }
                    
                    const targetWidth = parseInt(sizeParts[0], 10);
                    const targetHeight = parseInt(sizeParts[1], 10);
                    
                    if (isNaN(targetWidth) || isNaN(targetHeight) || targetWidth <= 0 || targetHeight <= 0) {
                        throw new Error(`Invalid size dimensions: ${size}. Width and height must be positive numbers.`);
                    }
                    
                    // For images, ALWAYS resize to match video dimensions (Sora API requirement)
                    if (mimeType.startsWith('image/')) {
                        // Resize image to match video size using sharp (compulsory)
                        const resizedBuffer = await sharp(filePath)
                            .resize(targetWidth, targetHeight, {
                                fit: 'cover', // Cover the entire area, may crop to maintain aspect ratio
                                position: 'center' // Center the image when cropping
                            })
                            .toBuffer();
                        
                        // Create a Blob from the resized image buffer
                        const fileBlob = new Blob([resizedBuffer], { type: mimeType });
                        formData.append('input_reference', fileBlob, filename);
                    } else {
                        // For videos, read as-is (videos can't be resized easily with sharp)
                        // Note: Video input_reference must already match the size parameter
                        const fileBuffer = await readFile(filePath);
                        const fileBlob = new Blob([fileBuffer], { type: mimeType });
                        formData.append('input_reference', fileBlob, filename);
                    }
                } catch (fileError) {
                    const errorMessage = fileError instanceof Error ? fileError.message : String(fileError);
                    throw new Error(`Failed to process input_reference file: ${errorMessage}`);
                }
            }

            const response = await fetch(`${SORA_API_BASE}/videos`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${OPENAI_API_KEY}`
                },
                body: formData
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Sora API error: ${response.status} - ${errorText}`);
            }

            const output = await response.json() as Record<string, unknown>;

            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(output, null, 2)
                    }
                ],
                structuredContent: output
            };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error creating video: ${errorMessage}`
                    }
                ],
                isError: true
            };
        }
    }
);

// Tool 2: Remix Video
server.registerTool(
    'remix-video',
    {
        title: 'Remix Video',
        description: 'Create a remix of an existing video using OpenAI Sora 2 API',
        inputSchema: {
            video_id: z.string().describe('The identifier of the completed video to remix'),
            prompt: z.string().describe('Updated text prompt that directs the remix generation')
        }
    },
    async ({ video_id, prompt }) => {
        try {
            const response = await fetch(`${SORA_API_BASE}/videos/${video_id}/remix`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${OPENAI_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ prompt })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Sora API error: ${response.status} - ${errorText}`);
            }

            const output = await response.json() as Record<string, unknown>;

            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(output, null, 2)
                    }
                ],
                structuredContent: output
            };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error remixing video: ${errorMessage}`
                    }
                ],
                isError: true
            };
        }
    }
);

// Tool 3: Get Video Status
server.registerTool(
    'get-video-status',
    {
        title: 'Get Video Status',
        description: 'Check the status and details of a video generation job',
        inputSchema: {
            video_id: z.string().describe('The identifier of the video to check')
        }
    },
    async ({ video_id }) => {
        try {
            const response = await fetch(`${SORA_API_BASE}/videos/${video_id}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${OPENAI_API_KEY}`
                }
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Sora API error: ${response.status} - ${errorText}`);
            }

            const output = await response.json() as Record<string, unknown>;

            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(output, null, 2)
                    }
                ],
                structuredContent: output
            };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error getting video status: ${errorMessage}`
                    }
                ],
                isError: true
            };
        }
    }
);

// Tool 4: List Videos
server.registerTool(
    'list-videos',
    {
        title: 'List Videos',
        description: 'List all video generation jobs with pagination support',
        inputSchema: {
            limit: z.number().optional().default(20).describe('Number of videos to retrieve'),
            after: z.string().optional().describe('Identifier for pagination - get videos after this ID'),
            order: z.enum(['asc', 'desc']).optional().default('desc').describe('Sort order by timestamp')
        }
    },
    async ({ limit = 20, after, order = 'desc' }) => {
        try {
            const params = new URLSearchParams();
            params.append('limit', String(limit));
            if (after) params.append('after', after);
            params.append('order', order);

            const response = await fetch(`${SORA_API_BASE}/videos?${params.toString()}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${OPENAI_API_KEY}`
                }
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Sora API error: ${response.status} - ${errorText}`);
            }

            const output = await response.json() as Record<string, unknown>;

            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(output, null, 2)
                    }
                ],
                structuredContent: output
            };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error listing videos: ${errorMessage}`
                    }
                ],
                isError: true
            };
        }
    }
);

// Tool 5: Download Video
server.registerTool(
    'download-video',
    {
        title: 'Download Video',
        description: 'Get the download instructions and authenticated URL for a completed video',
        inputSchema: {
            video_id: z.string().describe('The identifier of the video to download'),
            variant: z.string().optional().describe('Which downloadable asset to return (defaults to MP4)')
        }
    },
    async ({ video_id, variant }) => {
        try {
            // First check if video is completed
            const statusResponse = await fetch(`${SORA_API_BASE}/videos/${video_id}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${OPENAI_API_KEY}`
                }
            });

            if (!statusResponse.ok) {
                const errorText = await statusResponse.text();
                throw new Error(`Sora API error: ${statusResponse.status} - ${errorText}`);
            }

            const statusData = await statusResponse.json() as { status: string };

            if (statusData.status !== 'completed') {
                const output = {
                    video_id,
                    status: statusData.status,
                    message: `Video is not ready yet. Current status: ${statusData.status}`,
                    download_instructions: 'Video is not ready for download yet.',
                    curl_command: ''
                };
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(output, null, 2)
                        }
                    ],
                    structuredContent: output
                };
            }

            // Video is completed, provide download instructions
            const params = variant ? `?variant=${variant}` : '';
            const downloadUrl = `${SORA_API_BASE}/videos/${video_id}/content${params}`;
            
            const curlCommand = `curl -H "Authorization: Bearer ${OPENAI_API_KEY}" "${downloadUrl}" -o "${video_id}.mp4"`;
            
            const output = {
                video_id,
                status: 'completed',
                message: 'Video is ready for download! Use the curl command below to download it.',
                download_instructions: 'The video requires authentication. Use the provided curl command or add Authorization header with your API key.',
                curl_command: curlCommand
            };

            return {
                content: [
                    {
                        type: 'text',
                        text: `Video ${video_id} is ready for download!\n\nTo download the video, run this command in your terminal:\n\n${curlCommand}\n\nThis will save the video as "${video_id}.mp4" in your current directory.`
                    }
                ],
                structuredContent: output
            };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error preparing video download: ${errorMessage}`
                    }
                ],
                isError: true
            };
        }
    }
);

// Tool 6: Save Video
server.registerTool(
    'save-video',
    {
        title: 'Save Video',
        description: 'Automatically download and save a completed video to your computer',
        inputSchema: {
            video_id: z.string().describe('The identifier of the video to save'),
            output_path: z.string().optional().describe('Directory to save the video (defaults to Downloads folder)'),
            filename: z.string().optional().describe('Custom filename (defaults to video_id.mp4)')
        }
    },
    async ({ video_id, output_path, filename }) => {
        try {
            // First check if video is completed
            const statusResponse = await fetch(`${SORA_API_BASE}/videos/${video_id}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${OPENAI_API_KEY}`
                }
            });

            if (!statusResponse.ok) {
                const errorText = await statusResponse.text();
                throw new Error(`Sora API error: ${statusResponse.status} - ${errorText}`);
            }

            const statusData = await statusResponse.json() as { status: string };

            if (statusData.status !== 'completed') {
                const output = {
                    video_id,
                    status: statusData.status,
                    file_path: '',
                    message: `Video is not ready yet. Current status: ${statusData.status}`
                };
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(output, null, 2)
                        }
                    ],
                    structuredContent: output
                };
            }

            // Download the video
            const downloadUrl = `${SORA_API_BASE}/videos/${video_id}/content`;
            const videoResponse = await fetch(downloadUrl, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${OPENAI_API_KEY}`
                }
            });

            if (!videoResponse.ok) {
                const errorText = await videoResponse.text();
                throw new Error(`Failed to download video: ${videoResponse.status} - ${errorText}`);
            }

            // Get video content as buffer
            const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());

            // Determine save path
            const saveDir = output_path ? resolve(output_path) : DOWNLOAD_DIR;
            const saveFilename = filename || `${video_id}.mp4`;
            const fullPath = join(saveDir, saveFilename);

            // Ensure directory exists
            await mkdir(saveDir, { recursive: true });

            // Save the file
            await writeFile(fullPath, videoBuffer);

            const output = {
                video_id,
                status: 'saved',
                file_path: fullPath,
                message: `Video saved successfully to ${fullPath}`
            };

            return {
                content: [
                    {
                        type: 'text',
                        text: `✅ Video downloaded successfully!\n\nSaved to: ${fullPath}\n\nYou can now open and watch your video!`
                    }
                ],
                structuredContent: output
            };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error saving video: ${errorMessage}`
                    }
                ],
                isError: true
            };
        }
    }
);

// Tool 7: Delete Video
server.registerTool(
    'delete-video',
    {
        title: 'Delete Video',
        description: 'Delete a video job and its assets',
        inputSchema: {
            video_id: z.string().describe('The identifier of the video to delete')
        }
    },
    async ({ video_id }) => {
        try {
            const response = await fetch(`${SORA_API_BASE}/videos/${video_id}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${OPENAI_API_KEY}`
                }
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Sora API error: ${response.status} - ${errorText}`);
            }

            const data = await response.json() as Record<string, unknown>;

            const output = {
                id: video_id,
                deleted: true,
                message: `Successfully deleted video ${video_id}`,
                ...data
            };

            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(output, null, 2)
                    }
                ],
                structuredContent: output
            };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error deleting video: ${errorMessage}`
                    }
                ],
                isError: true
            };
        }
    }
);

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

const port = parseInt(process.env.PORT || '3000');
app.listen(port, () => {
    console.log(`Sora MCP Server running on http://localhost:${port}/mcp`);
    console.log('Connect using MCP Inspector: npx @modelcontextprotocol/inspector');
    console.log(`Or connect to: http://localhost:${port}/mcp`);
}).on('error', error => {
    console.error('Server error:', error);
    process.exit(1);
});

