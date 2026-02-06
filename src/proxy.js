const http = require('http');
const https = require('https');
const modelsAggregator = require('./models');
const healthChecker = require('./health');
const logger = require('./utils/logger');

class Proxy {
  getEndpointUrl(endpoint) {
    return `${endpoint.address}:${endpoint.port}`;
  }

  async proxyChatCompletions(req, res) {
    let endpoint;
    try {
      let body;
      try {
        body = JSON.parse(req.body.toString());
      } catch (e) {
        res.status(400).json({ error: 'Invalid JSON in request body' });
        return;
      }

      const modelName = body.model;

      if (!modelName) {
        res.status(400).json({ error: 'Missing "model" field in request body' });
        return;
      }

      endpoint = await this.findEndpointForModel(modelName);
      if (!endpoint) {
        const allModels = await modelsAggregator.getAllModels(false);
        const availableModels = allModels.data.map(m => m.id || m.name).join(', ');
        
        res.status(404).json({ 
          error: `Model "${modelName}" not found on any healthy endpoint`,
          available_models: availableModels
        });
        return;
      }

      modelsAggregator.incrementConnection(endpoint.name);

      logger.info(`Proxying request for model ${modelName} to ${endpoint.name}`, {
        model: modelName,
        endpoint: endpoint.name,
        stream: body.stream || false
      });

      const options = {
        hostname: endpoint.address,
        port: endpoint.port,
        path: '/v1/chat/completions',
        method: 'POST',
        timeout: 0,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(req.body),
          'Accept': 'application/json, text/event-stream'
        }
      };

      const proxyReq = http.request(options, (proxyRes) => {
        logger.info('Received response from upstream', {
          statusCode: proxyRes.statusCode,
          headers: proxyRes.headers
        });

        const headers = { ...proxyRes.headers };
        res.writeHead(proxyRes.statusCode, headers);
        
        let dataCount = 0;
        proxyRes.on('data', (chunk) => {
          dataCount++;
          if (dataCount === 1) {
            logger.info('First chunk received from upstream', { size: chunk.length });
          }
        });

        proxyRes.pipe(res, { end: false });

        proxyRes.on('error', (error) => {
          logger.warn('Upstream response error', { error: error.message });
        });

        proxyRes.on('end', () => {
          logger.info('Upstream response ended', { totalChunks: dataCount });
          modelsAggregator.decrementConnection(endpoint.name);
          if (!res.writableEnded) {
            res.end();
          }
        });
      });

      proxyReq.on('error', (error) => {
        logger.error(`Proxy request error for ${endpoint.name}`, { 
          endpoint: endpoint.name,
          error: error.message 
        });
        modelsAggregator.decrementConnection(endpoint.name);
        if (!res.headersSent) {
          res.status(502).json({ error: 'Bad gateway: Failed to reach endpoint' });
        }
      });

      res.on('close', () => {
        logger.info('Client connection closed');
        modelsAggregator.decrementConnection(endpoint.name);
      });

      req.on('close', () => {
        logger.info('Request closed');
        modelsAggregator.decrementConnection(endpoint.name);
      });

      logger.info('Writing request body to upstream', { size: req.body.length });
      proxyReq.write(req.body);
      proxyReq.end();
      logger.info('Request sent to upstream');

    } catch (error) {
      logger.error('Error in proxy chat completions', { error: error.message });
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
      if (endpoint) {
        modelsAggregator.decrementConnection(endpoint.name);
      }
    }
  }

  async findEndpointForModel(modelName) {
    const endpoint = modelsAggregator.getEndpointForModel(modelName);
    
    if (endpoint) {
      return endpoint;
    }
    
    const healthyEndpoints = healthChecker.getHealthyEndpoints();
    
    for (const endpoint of healthyEndpoints) {
      try {
        const url = `http://${endpoint.address}:${endpoint.port}/v1/models`;
        const axios = require('axios');
        const response = await axios.get(url, { timeout: 5000 });
        const models = response.data.data || [];
        
        if (models.some(m => m.id === modelName || m.name === modelName)) {
          return endpoint;
        }
      } catch (error) {
        logger.warn(`Failed to check endpoint ${endpoint.name} for model ${modelName}`, {
          endpoint: endpoint.name,
          model: modelName,
          error: error.message
        });
      }
    }
    
    return null;
  }
}

module.exports = new Proxy();
