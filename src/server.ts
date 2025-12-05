// Load environment variables FIRST (before New Relic)
import dotenv from 'dotenv';
dotenv.config();

// New Relic must be required/imported AFTER dotenv but BEFORE other modules
import 'newrelic';

import express, { type Request, type Response } from 'express';
import cors from 'cors';
import path from 'path';
import newrelic from 'newrelic';

type ToolId = 'cursor' | 'chatgpt' | 'claude';

interface ToolStatus {
  id: ToolId;
  name: string;
  status: 'healthy' | 'degraded' | 'down' | 'unknown';
  lastChecked: string;
  latencyMs: number | null;
  error?: string;
}

interface ToolConfig {
  id: ToolId;
  name: string;
  statusUrl: string;
}

const toolConfigs: ToolConfig[] = [
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    statusUrl: 'https://status.openai.com/api/v2/status.json',
  },
  {
    id: 'claude',
    name: 'Claude',
    statusUrl: 'https://status.claude.com/api/v2/status.json',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    statusUrl: 'https://status.cursor.com/api/v2/status.json',
  },
];

const app = express();
const port = process.env.PORT || 4000;

const publicDir = path.join(__dirname, '../public');

app.use(cors());
app.use(express.json());
app.use(express.static(publicDir));

// In-memory status store
let tools: ToolStatus[] = toolConfigs.map((config) => ({
  id: config.id,
  name: config.name,
  status: 'unknown' as const,
  lastChecked: new Date().toISOString(),
  latencyMs: null,
}));

// Rate limiting: delay between checks (in ms) to avoid being blocked
const CHECK_DELAY_MS = 2000; // 2 seconds between each tool check
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // Check every 5 minutes (instead of 60 seconds)
const REQUEST_TIMEOUT_MS = 10000; // 10 second timeout per request
const MAX_RETRIES = 2; // Retry failed checks up to 2 times

// Helper to sleep/delay
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Check a single tool's status with retry logic
async function checkToolStatus(config: ToolConfig, retryCount = 0): Promise<{
  status: ToolStatus['status'];
  latencyMs: number | null;
  error?: string;
}> {
  const startTime = Date.now();
  const url = config.statusUrl;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'AI-Tools-Monitor/1.0',
        'Accept': 'application/json, text/html, */*',
      },
    });

    clearTimeout(timeoutId);
    const latencyMs = Date.now() - startTime;

    // Parse JSON status API response
    if (response.ok) {
      try {
        const data = await response.json();
        
        // StatusPage.io API format - check status indicator
        const indicator = data.status?.indicator;
        const description = data.status?.description || '';
        
        if (indicator === 'none') {
          // All systems operational - check latency
          return { status: latencyMs > 2000 ? 'degraded' : 'healthy', latencyMs };
        } else if (indicator === 'minor') {
          // Minor service outage
          return { 
            status: 'degraded', 
            latencyMs, 
            error: description || 'Minor service outage' 
          };
        } else if (indicator === 'major' || indicator === 'critical') {
          // Major or critical issues
          return { 
            status: 'down', 
            latencyMs, 
            error: description || `Service status: ${indicator}` 
          };
        } else if (indicator === 'partial') {
          // Partial outage
          return { 
            status: 'degraded', 
            latencyMs, 
            error: description || 'Partial outage detected' 
          };
        }
        
        // If indicator is not recognized but response is OK, treat as healthy
        return { status: latencyMs > 2000 ? 'degraded' : 'healthy', latencyMs };
      } catch (error) {
        // If JSON parsing fails, log error and treat as unknown
        return { 
          status: 'unknown', 
          latencyMs, 
          error: 'Failed to parse status API response' 
        };
      }
    } else if (response.status === 429) {
      // Rate limited - mark as degraded instead of down
      return {
        status: 'degraded',
        latencyMs,
        error: 'Rate limited - too many requests',
      };
    } else if (response.status >= 500) {
      return { status: 'down', latencyMs, error: `Server error: ${response.status}` };
    } else {
      return { status: 'down', latencyMs, error: `HTTP ${response.status}` };
    }
  } catch (error: unknown) {
    const latencyMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Handle specific error types
    let lastError: string;
    if (errorMessage.includes('aborted') || errorMessage.includes('timeout')) {
      lastError = 'Request timeout';
    } else if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('ENOTFOUND')) {
      lastError = 'Connection failed';
    } else {
      lastError = errorMessage;
    }

    // Retry with exponential backoff if we haven't exceeded max retries
    if (retryCount < MAX_RETRIES) {
      await delay(1000 * (retryCount + 1)); // Exponential backoff: 1s, 2s
      return checkToolStatus(config, retryCount + 1);
    }

    // If we got rate limited, mark as degraded instead of down
    if (lastError.includes('Rate limited') || lastError.includes('429')) {
      return { status: 'degraded', latencyMs: null, error: lastError };
    }

    return { status: 'down', latencyMs: null, error: lastError };
  }
}

// Check all tools sequentially with delays to avoid rate limiting
async function checkAllToolsStatus() {
  for (let i = 0; i < toolConfigs.length; i++) {
    const config = toolConfigs[i];
    const existingTool = tools.find((t) => t.id === config.id);

    try {
      const result = await checkToolStatus(config);
      const oldStatus = existingTool?.status || 'unknown';

      const updatedTool: ToolStatus = {
        id: config.id,
        name: config.name,
        status: result.status,
        lastChecked: new Date().toISOString(),
        latencyMs: result.latencyMs,
        error: result.error,
      };

      // Update the tool in the array
      const toolIndex = tools.findIndex((t) => t.id === config.id);
      if (toolIndex >= 0) {
        tools[toolIndex] = updatedTool;
      } else {
        tools.push(updatedTool);
      }

      // Log to New Relic
      newrelic.recordCustomEvent('ToolStatusUpdate', {
        toolId: updatedTool.id,
        toolName: updatedTool.name,
        status: updatedTool.status,
        latencyMs: updatedTool.latencyMs ?? 0,
        hasError: !!updatedTool.error,
      });

      // Only log errors
      if (result.status === 'down' || result.error) {
        console.error(`Error checking ${updatedTool.name}:`, {
          toolId: updatedTool.id,
          toolName: updatedTool.name,
          status: result.status,
          error: result.error,
          latencyMs: updatedTool.latencyMs,
        });

        // Report errors to New Relic Error Inbox when tools go down
        if (result.status === 'down') {
          const error = new Error(`Tool ${updatedTool.name} is down: ${updatedTool.error || 'Unknown error'}`);
          error.name = 'ToolDownError';
          newrelic.noticeError(error, {
            toolId: updatedTool.id,
            toolName: updatedTool.name,
            previousStatus: oldStatus,
            errorType: 'ToolDown',
            latencyMs: updatedTool.latencyMs ?? 0,
            errorMessage: updatedTool.error,
          });
        }
      }

      // Delay before checking next tool to avoid rate limiting
      if (i < toolConfigs.length - 1) {
        await delay(CHECK_DELAY_MS);
      }
    } catch (error) {
      console.error(`Error checking ${config.name}:`, error);
      // Update tool with error status
      const toolIndex = tools.findIndex((t) => t.id === config.id);
      if (toolIndex >= 0) {
        tools[toolIndex] = {
          ...tools[toolIndex],
          status: 'unknown',
          lastChecked: new Date().toISOString(),
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  }
}

// Initial check on startup
checkAllToolsStatus().catch((err) => {
  console.error('Error during initial status check:', err);
});

// Periodic checks
setInterval(() => {
  checkAllToolsStatus().catch((err) => {
    console.error('Error during periodic status check:', err);
  });
}, CHECK_INTERVAL_MS);

app.get('/health', (_req: Request, res: Response) => {
  newrelic.recordCustomEvent('HealthCheck', {
    timestamp: new Date().toISOString(),
  });
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.get('/tools', (_req: Request, res: Response) => {
  const healthyCount = tools.filter((t) => t.status === 'healthy').length;
  const degradedCount = tools.filter((t) => t.status === 'degraded').length;
  const downCount = tools.filter((t) => t.status === 'down').length;

  // Record custom metric
  newrelic.recordMetric('Custom/Tools/Healthy', healthyCount);
  newrelic.recordMetric('Custom/Tools/Degraded', degradedCount);
  newrelic.recordMetric('Custom/Tools/Down', downCount);

  // Log using console (picked up by New Relic application_logging)
  console.log('Tools status retrieved', {
    healthyCount,
    degradedCount,
    downCount,
    totalTools: tools.length,
  });

  res.json({ tools });
});

app.get('/tools/:id', (req: Request, res: Response) => {
  const tool = tools.find((t) => t.id === req.params.id);
  if (!tool) {
    console.warn('Tool not found', { toolId: req.params.id });
    return res.status(404).json({ error: 'Tool not found' });
  }

  console.log('Tool status retrieved', {
    toolId: tool.id,
    toolName: tool.name,
    status: tool.status,
    latencyMs: tool.latencyMs,
  });

  res.json(tool);
});

// Test endpoint to generate errors for demo purposes
app.get('/test-error', (req: Request, res: Response) => {
  const errorType = (req.query.type as string) || 'generic';
  const toolName = (req.query.tool as string) || 'unknown';

  let error: Error;

  switch (errorType) {
    case 'tool-error':
      error = new Error(`Simulated tool monitoring error: ${toolName}`);
      error.name = 'ToolMonitoringError';
      break;
    case 'timeout':
      error = new Error('Simulated timeout error');
      error.name = 'TimeoutError';
      break;
    case 'validation':
      error = new Error('Simulated validation error');
      error.name = 'ValidationError';
      break;
    default:
      error = new Error('Simulated generic error');
      error.name = 'GenericError';
  }

  // Report to New Relic with custom attributes
  newrelic.noticeError(error, {
    errorType: errorType,
    endpoint: '/test-error',
    toolName: toolName,
    customAttribute: 'demo-error',
  });

  throw error; // This will be caught by error middleware
});

// Endpoint to simulate deployment error - runtime error that compiles fine
// This simulates a common deployment issue where code compiles but fails at runtime
app.get('/deploy-error', (_req: Request, _res: Response) => {
  // Simulate a runtime error: trying to access a property on undefined
  // This compiles fine but throws TypeError at runtime
  const config: any = undefined;
  const serviceName = config.service.name; // TypeError: Cannot read property 'name' of undefined
  
  // This line will never execute, but TypeScript doesn't know that
  return { service: serviceName };
});

// Fallback to index.html for root.
app.get('/', (_req: Request, res: Response) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Error handling middleware - must be after all routes
app.use((err: Error, req: Request, res: Response, _next: Function) => {
  // Report error to New Relic
  newrelic.noticeError(err, {
    route: req.path,
    method: req.method,
    statusCode: res.statusCode || 500,
    errorName: err.name,
  });

  // Log error using console (picked up by New Relic application_logging)
  console.error('Error occurred', {
    errorName: err.name,
    errorMessage: err.message,
    stack: err.stack,
    route: req.path,
    method: req.method,
    statusCode: res.statusCode || 500,
  });

  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// Catch unhandled promise rejections
process.on('unhandledRejection', (reason: unknown) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  newrelic.noticeError(error, {
    errorType: 'UnhandledRejection',
  });
  console.error('Unhandled Rejection:', error);
});

// Catch uncaught exceptions
process.on('uncaughtException', (error: Error) => {
  newrelic.noticeError(error, {
    errorType: 'UncaughtException',
  });
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

app.listen(port, () => {
  console.log(`AI tools monitor API listening on http://localhost:${port}`, {
    port,
    environment: process.env.NODE_ENV || 'development',
  });
});


