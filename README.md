## AI Tools Monitor (Node + TypeScript)

Small demo-friendly app that simulates monitoring the health of AI tools like Cursor, CodeRabbit, ChatGPT, Claude, etc. It exposes a simple REST API and a lightweight HTML dashboard.

### Tech stack

- **Backend**: Node, TypeScript, Express
- **UI**: Static HTML/CSS/JS served by the same Node process
- **Monitoring**: New Relic (for logs and metrics)

### Endpoints

- **`GET /health`** – basic service health
- **`GET /tools`** – list of tool statuses
- **`GET /tools/:id`** – single tool status (`cursor`, `coderabbit`, `chatgpt`, `claude`, `copilot`)

Statuses are randomly updated every 60 seconds to keep the dashboard "alive" for demos.

### New Relic Setup (for logging and monitoring)

This app is configured to send logs and metrics to New Relic. To enable it:

1. **Get your New Relic license key:**
   - Go to https://one.newrelic.com/admin-portal/api-keys/home
   - Copy your license key

2. **Create a `.env` file** (copy from `.env.example`):
   ```bash
   cp .env.example .env
   ```

3. **Add your license key to `.env`:**
   ```bash
   NEW_RELIC_LICENSE_KEY=your_license_key_here
   NEW_RELIC_APP_NAME=AI Tools Monitor
   ```

4. **The app will automatically:**
   - Send application logs to New Relic
   - Record custom events for tool status changes
   - Track custom metrics (healthy/degraded/down counts)
   - Monitor API endpoints

5. **View logs in New Relic:**
   - Use the New Relic MCP to query logs
   - Or visit https://one.newrelic.com and navigate to Logs
   - Search for events like "ToolStatusUpdate" or filter by application name

**Note:** If you don't set up New Relic, the app will still run but won't send any data.

### Run locally

```bash
cd /home/joao/projetos/ts_monitor_ai_tools

# Install deps
npm install

# Dev mode (auto-restart on changes)
npm run dev

# or build + run
npm run build
npm start
```

By default the server listens on **http://localhost:4000**.

### Dashboard

- Open `http://localhost:4000/` in your browser.
- You’ll see cards for each AI tool with status, latency, and last check time.
- The UI auto-refreshes every 10 seconds, and you can also force a refresh.


