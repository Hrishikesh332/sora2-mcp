import { z } from 'zod';
import { writeFile, mkdir, readFile, stat } from 'fs/promises';
import { resolve, basename, join } from 'path';
import { homedir } from 'os';
import sharp from 'sharp';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const SORA_API_BASE = 'https://api.openai.com/v1';

// Standard video dimensions for orientations
const ORIENTATION_SIZES = {
  vertical: '720x1280',    // 9:16 aspect ratio (portrait)
  landscape: '1280x720'    // 16:9 aspect ratio (landscape)
} as const;

// Get download directory from env or use default
const getDownloadDir = () => {
  return process.env.DOWNLOAD_DIR || join(homedir(), 'Downloads');
};

// Get API key from environment
const getApiKey = () => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is required');
  }
  return apiKey;
};

// Convert orientation to size, or use provided size
// Defaults to vertical (720x1280) when orientation is not specified
const getVideoSize = (orientation?: 'vertical' | 'landscape', size?: string): string => {
  // If orientation is explicitly provided, use it
  if (orientation) {
    return ORIENTATION_SIZES[orientation];
  }
  // If no orientation but custom size is provided, use custom size
  if (size) {
    return size;
  }
  // Default to vertical when orientation is not defined
  return ORIENTATION_SIZES.vertical;
};

/**
 * Register all Sora MCP tools with the server
 */
export function registerTools(server: McpServer) {
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
        orientation: z.enum(['vertical', 'landscape']).optional().describe('Video orientation - "vertical" for portrait (9:16) or "landscape" for widescreen (16:9). If not specified, defaults to vertical. This is easier than specifying exact dimensions.'),
        size: z.string().optional().describe('Output resolution formatted as width x height (e.g., "720x1280"). If orientation is provided, this parameter is ignored and the orientation\'s standard dimensions are used.'),
        input_reference: z.string().optional().describe('Optional absolute or relative path to an image (JPEG, PNG, WEBP) or video file to use as reference. Images will be automatically resized to match the video size parameter. Supported formats: JPEG, PNG, WEBP for images; MP4, MOV, WEBM for videos.')
      }
    },
    async ({ prompt, model = 'sora-2', seconds = '4', orientation, size, input_reference }) => {
      try {
        const apiKey = getApiKey();
        
        // Determine the final size based on orientation or provided size
        const finalSize = getVideoSize(orientation, size);
        
        const formData = new FormData();
        formData.append('model', model);
        formData.append('prompt', prompt);
        formData.append('seconds', seconds);
        formData.append('size', finalSize);

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
            const sizeParts = finalSize.split('x');
            if (sizeParts.length !== 2) {
              throw new Error(`Invalid size format: ${finalSize}. Expected format: "widthxheight" (e.g., "720x1280")`);
            }
            
            const targetWidth = parseInt(sizeParts[0], 10);
            const targetHeight = parseInt(sizeParts[1], 10);
            
            if (isNaN(targetWidth) || isNaN(targetHeight) || targetWidth <= 0 || targetHeight <= 0) {
              throw new Error(`Invalid size dimensions: ${finalSize}. Width and height must be positive numbers.`);
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
            'Authorization': `Bearer ${apiKey}`
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
        const apiKey = getApiKey();
        const response = await fetch(`${SORA_API_BASE}/videos/${video_id}/remix`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
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
        const apiKey = getApiKey();
        const response = await fetch(`${SORA_API_BASE}/videos/${video_id}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${apiKey}`
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
        const apiKey = getApiKey();
        const params = new URLSearchParams();
        params.append('limit', String(limit));
        if (after) params.append('after', after);
        params.append('order', order);

        const response = await fetch(`${SORA_API_BASE}/videos?${params.toString()}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${apiKey}`
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
        const apiKey = getApiKey();
        // First check if video is completed
        const statusResponse = await fetch(`${SORA_API_BASE}/videos/${video_id}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${apiKey}`
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
        
        const curlCommand = `curl -H "Authorization: Bearer ${apiKey}" "${downloadUrl}" -o "${video_id}.mp4"`;
        
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
        const apiKey = getApiKey();
        // First check if video is completed
        const statusResponse = await fetch(`${SORA_API_BASE}/videos/${video_id}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${apiKey}`
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
            'Authorization': `Bearer ${apiKey}`
          }
        });

        if (!videoResponse.ok) {
          const errorText = await videoResponse.text();
          throw new Error(`Failed to download video: ${videoResponse.status} - ${errorText}`);
        }

        // Get video content as buffer
        const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());

        // Determine save path
        const saveDir = output_path ? resolve(output_path) : getDownloadDir();
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
        const apiKey = getApiKey();
        const response = await fetch(`${SORA_API_BASE}/videos/${video_id}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${apiKey}`
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
}

