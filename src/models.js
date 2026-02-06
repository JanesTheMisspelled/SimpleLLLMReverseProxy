const axios = require('axios');
const healthChecker = require('./health');
const logger = require('./utils/logger');
const config = require('./config');

class ModelsAggregator {
  constructor() {
    this.cache = null;
    this.cacheTimestamp = null;
    this.modelToEndpointMap = new Map();
    this.activeConnections = new Map();
  }

  async fetchModelsFromEndpoint(endpoint) {
    const url = `http://${endpoint.address}:${endpoint.port}/v1/models`;
    
    try {
      const response = await axios.get(url, { timeout: 10000 });
      
      const models = response.data.data || [];
      return models;
    } catch (error) {
      logger.error(`Failed to fetch models from ${endpoint.name}`, { 
        endpoint: endpoint.name,
        error: error.message 
      });
      return [];
    }
  }

  async getAllModels(force) {
    const now = Date.now();
    
    if (force==false && this.cache && (now - this.cacheTimestamp) < config.cacheTTL) {
      logger.debug('Returning cached models', { modelCount: this.cache.data.length });
      return this.cache;
    }
    
    const healthyEndpoints = healthChecker.getHealthyEndpoints();
    logger.debug(`Fetching models from ${healthyEndpoints.length} healthy endpoints`);
    
    const modelPromises = healthyEndpoints.map(endpoint => 
      this.fetchModelsFromEndpoint(endpoint)
    );
    
    const allModelsArrays = await Promise.all(modelPromises);
    
    this.modelToEndpointMap.clear();
    
    const seenModels = new Set();
    const uniqueModels = [];
    
    allModelsArrays.forEach((models, index) => {
      const endpoint = healthyEndpoints[index];
      
      for (const model of models) {
        const modelId = model.id || model.name;
        if (modelId && !seenModels.has(modelId)) {
          seenModels.add(modelId);
          uniqueModels.push(model);
          this.modelToEndpointMap.set(modelId, [endpoint]);
        } else if (modelId && seenModels.has(modelId)) {
          const endpoints = this.modelToEndpointMap.get(modelId);
          if (endpoints && !endpoints.some(e => e.name === endpoint.name)) {
            endpoints.push(endpoint);
          }
        }
      }
    });
    
    logger.info(`Returning ${uniqueModels.length} unique models`);
    
    this.cache = {
      object: 'list',
      data: uniqueModels
    };
    this.cacheTimestamp = now;
    
    return this.cache;
  }

  clearCache() {
    this.cache = null;
    this.cacheTimestamp = null;
    logger.info('Cache cleared');
  }

  getCachedModels() {
    return this.cache;
  }

  incrementConnection(endpointName) {
    const current = this.activeConnections.get(endpointName) || 0;
    this.activeConnections.set(endpointName, current + 1);
    logger.debug(`Incremented connection for ${endpointName}`, { count: current + 1 });
  }

  decrementConnection(endpointName) {
    const current = this.activeConnections.get(endpointName) || 0;
    if (current > 0) {
      this.activeConnections.set(endpointName, current - 1);
      logger.debug(`Decremented connection for ${endpointName}`, { count: current - 1 });
    }
  }

  getLeastConnectedEndpoint(endpoints) {
    return endpoints.reduce((min, endpoint) => {
      const connections = this.activeConnections.get(endpoint.name) || 0;
      const minConnections = this.activeConnections.get(min.name) || 0;
      return connections < minConnections ? endpoint : min;
    });
  }

  getConnectionStats() {
    const stats = {};
    for (const [endpointName, count] of this.activeConnections.entries()) {
      stats[endpointName] = count;
    }
    return stats;
  }

  getEndpointForModel(modelName) {
    const cachedModels = this.getCachedModels();
    
    if (cachedModels) {
      const endpoints = this.modelToEndpointMap.get(modelName);
      
      if (endpoints && endpoints.length > 0) {
        const endpoint = this.getLeastConnectedEndpoint(endpoints);
        logger.debug(`Model ${modelName} found at endpoint ${endpoint.name} using cache (${endpoints.length} available)`, {
          model: modelName,
          endpoint: endpoint.name,
          totalEndpoints: endpoints.length,
          activeConnections: this.activeConnections.get(endpoint.name) || 0
        });
        return endpoint;
      }
    }
    
    return null;
  }
}

module.exports = new ModelsAggregator();
