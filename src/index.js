const express = require('express');
const config = require('./config');
const healthChecker = require('./health');
const modelsAggregator = require('./models');
const proxy = require('./proxy');
const logger = require('./utils/logger');

const app = express();
const PORT = config.serverPort;

app.use((req, res, next) => {
  logger.info('Incoming request', {
    method: req.method,
    path: req.path,
    ip: req.ip
  });
  next();
});

app.get('/v1/models', async (req, res) => {
  try {
    const models = await modelsAggregator.getAllModels(false);
    res.json(models);
    logger.info('Retrieved all models', { modelCount: models.data.length });
  } catch (error) {
    logger.error('Error fetching models', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch models' });
  }
});

app.post('/v1/chat/completions', async (req, res) => {
  const chunks = [];
  
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', async () => {
    req.body = Buffer.concat(chunks);
    await proxy.proxyChatCompletions(req, res);
  });
  req.on('error', (error) => {
    logger.error('Request error', { error: error.message });
    if (!res.headersSent) {
      res.status(400).json({ error: 'Request error' });
    }
  });
});

app.get('/health', (req, res) => {
  const healthStatus = healthChecker.getStatus();
  const healthyCount = Object.values(healthStatus).filter(s => s.healthy).length;
  
  res.json({
    status: healthyCount > 0 ? 'healthy' : 'unhealthy',
    endpoints: healthStatus,
    healthy_endpoints: healthyCount,
    total_endpoints: Object.keys(healthStatus).length
  });
});

app.post('/health/force-check', async (req, res) => {
  await healthChecker.checkAll();
  modelsAggregator.clearCache();
  const models = await modelsAggregator.getAllModels(true);
  const healthStatus = healthChecker.getStatus();
  const healthyCount = Object.values(healthStatus).filter(s => s.healthy).length;
  
  res.json({
    status: healthyCount > 0 ? 'healthy' : 'unhealthy',
    endpoints: healthStatus,
    healthy_endpoints: healthyCount,
    total_endpoints: Object.keys(healthStatus).length
  });
});

app.use((req, res) => {
  logger.warn('Route not found', { method: req.method, path: req.path });
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

function start() {
  logger.info('Starting LLM Reverse Proxy', { port: PORT });
  
  healthChecker.start();
  
  const server = app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
    logger.info(`Health check endpoint: http://localhost:${PORT}/health`);
    logger.info(`Models endpoint: http://localhost:${PORT}/v1/models`);
    logger.info(`Chat completions endpoint: http://localhost:${PORT}/v1/chat/completions`);
  });

  server.timeout = 0;
  server.keepAliveTimeout = 0;
}

function shutdown() {
  logger.info('Shutting down...');
  healthChecker.stop();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

if (require.main === module) {
  start();
}

module.exports = { app, start };
