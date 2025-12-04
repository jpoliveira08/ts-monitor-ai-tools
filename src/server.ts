// Load environment variables FIRST (before New Relic)
import dotenv from 'dotenv';
dotenv.config();

// New Relic must be required/imported AFTER dotenv but BEFORE other modules
import 'newrelic';

import express, { type Request, type Response } from 'express';
import cors from 'cors';
import path from 'path';
import newrelic from 'newrelic';

type ToolId = 'cursor' | 'coderabbit' | 'chatgpt' | 'claude' | 'copilot';

interface ToolStatus {
  id: ToolId;
  name: string;
  status: 'healthy' | 'degraded' | 'down' | 'unknown';
  lastChecked: string;
  latencyMs: number | null;
  error?: string;
}

const app = express();
const port = process.env.PORT || 4000;

const publicDir = path.join(__dirname, '../public');

app.use(cors());
app.use(express.json());
app.use(express.static(publicDir));

// In-memory status store (for demo purposes).
let tools: ToolStatus[] = [
  {
    id: 'cursor',
    name: 'Cursor',
    status: 'healthy',
    lastChecked: new Date().toISOString(),
    latencyMs: 120,
  },
  {
    id: 'coderabbit',
    name: 'CodeRabbit',
    status: 'degraded',
    lastChecked: new Date().toISOString(),
    latencyMs: 450,
    error: 'Slow responses from API',
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    status: 'healthy',
    lastChecked: new Date().toISOString(),
    latencyMs: 200,
  },
  {
    id: 'claude',
    name: 'Claude',
    status: 'healthy',
    lastChecked: new Date().toISOString(),
    latencyMs: 180,
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot',
    status: 'unknown',
    lastChecked: new Date().toISOString(),
    latencyMs: null,
  },
];

// Simulate status changes every 60 seconds so the UI looks "alive".
function randomizeStatuses() {
  const statuses: ToolStatus['status'][] = ['healthy', 'degraded', 'down'];
  tools = tools.map((t): ToolStatus => {
    const status = statuses[Math.floor(Math.random() * statuses.length)] ?? 'unknown';
    const latency =
      status === 'down'
        ? null
        : Math.floor(100 + Math.random() * (status === 'degraded' ? 800 : 300));

    const updatedTool = {
      ...t,
      status,
      latencyMs: latency,
      lastChecked: new Date().toISOString(),
      error:
        status === 'down'
          ? 'No response from service'
          : status === 'degraded'
          ? 'Elevated latency'
          : undefined,
    };

    // Log to New Relic
    newrelic.recordCustomEvent('ToolStatusUpdate', {
      toolId: updatedTool.id,
      toolName: updatedTool.name,
      status: updatedTool.status,
      latencyMs: updatedTool.latencyMs ?? 0,
      hasError: !!updatedTool.error,
    });

    // Log status changes
    if (t.status !== status) {
      const logLevel = status === 'down' ? 'ERROR' : status === 'degraded' ? 'WARN' : 'INFO';
      const logMessage = `Tool status changed: ${updatedTool.name} is now ${status}`;
      
      // Use console logging (picked up by New Relic application_logging)
      if (status === 'down') {
        console.error(logMessage, {
          toolId: updatedTool.id,
          toolName: updatedTool.name,
          oldStatus: t.status,
          newStatus: status,
          latencyMs: updatedTool.latencyMs,
        });
      } else if (status === 'degraded') {
        console.warn(logMessage, {
          toolId: updatedTool.id,
          toolName: updatedTool.name,
          oldStatus: t.status,
          newStatus: status,
          latencyMs: updatedTool.latencyMs,
        });
      } else {
        console.log(logMessage, {
          toolId: updatedTool.id,
          toolName: updatedTool.name,
          oldStatus: t.status,
          newStatus: status,
          latencyMs: updatedTool.latencyMs,
        });
      }

      // Report errors to New Relic Error Inbox when tools go down
      if (status === 'down') {
        const error = new Error(`Tool ${updatedTool.name} is down`);
        error.name = 'ToolDownError';
        newrelic.noticeError(error, {
          toolId: updatedTool.id,
          toolName: updatedTool.name,
          previousStatus: t.status,
          errorType: 'ToolDown',
          latencyMs: updatedTool.latencyMs ?? 0,
        });
      }
    }

    return updatedTool;
  });
}

setInterval(randomizeStatuses, 60_000);

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


