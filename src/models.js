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
    if (config.mode === 'single-model') {
      const modelName = config.singleModelName;
      logger.debug('Single-model mode, returning static model list', { model: modelName });
      return {
        object: 'list',
        data: modelName ? [{ id: modelName, object: 'model' }] : []
      };
    }

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
    
    const newMap = new Map();
    const seenModels = new Set();
    const uniqueModels = [];
    
    allModelsArrays.forEach((models, index) => {
      const endpoint = healthyEndpoints[index];
      
      for (const model of models) {
        const modelId = model.id || model.name;
        if (modelId && !seenModels.has(modelId)) {
          seenModels.add(modelId);
          uniqueModels.push(model);
          newMap.set(modelId, [endpoint]);
        } else if (modelId && seenModels.has(modelId)) {
          const endpoints = newMap.get(modelId);
          if (endpoints && !endpoints.some(e => e.name === endpoint.name)) {
            endpoints.push(endpoint);
          }
        }
      }
    });

    this.modelToEndpointMap = newMap;
    
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
    this.modelToEndpointMap = new Map();
    logger.info('Cache cleared');
  }

  getCachedModels() {
    return this.cache;
  }

  incrementConnection(endpoint) {
    const weight = endpoint.weight || 1;
    const current = this.activeConnections.get(endpoint.name) || 0;
    this.activeConnections.set(endpoint.name, current + weight);
    logger.debug(`Incremented connection for ${endpoint.name}`, { count: current + weight, weight });
  }

  decrementConnection(endpoint) {
    const weight = endpoint.weight || 1;
    const current = this.activeConnections.get(endpoint.name) || 0;
    if (current > 0) {
      const next = Math.max(0, current - weight);
      this.activeConnections.set(endpoint.name, next);
      logger.debug(`Decremented connection for ${endpoint.name}`, { count: next, weight });
    }
  }

  getLeastConnectedEndpoint(endpoints) {
    return endpoints.reduce((min, endpoint) => {
      const connections = this.activeConnections.get(endpoint.name) || 0;
      const minConnections = this.activeConnections.get(min.name) || 0;
      return connections < minConnections ? endpoint : min;
    });
  }

  getLeastConnectedHealthyEndpoint() {
    const healthyEndpoints = healthChecker.getHealthyEndpoints();

    if (healthyEndpoints.length === 0) {
      logger.warn('No healthy endpoints available');
      return null;
    }

    const endpoint = this.getLeastConnectedEndpoint(healthyEndpoints);
    logger.debug(`Selected endpoint ${endpoint.name} from ${healthyEndpoints.length} healthy endpoints`, {
      endpoint: endpoint.name,
      totalEndpoints: healthyEndpoints.length,
      activeConnections: this.activeConnections.get(endpoint.name) || 0
    });
    return endpoint;
  }

  getConnectionStats() {
    const stats = {};
    for (const [endpointName, count] of this.activeConnections.entries()) {
      stats[endpointName] = count;
    }
    return stats;
  }

  getEndpointForModel(modelName) {
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

    return null;
  }

  addModelEndpointMapping(modelName, endpoint) {
    const existing = this.modelToEndpointMap.get(modelName);
    if (existing) {
      if (!existing.some(e => e.name === endpoint.name)) {
        existing.push(endpoint);
      }
    } else {
      this.modelToEndpointMap.set(modelName, [endpoint]);
    }
  }
}

module.exports = new ModelsAggregator();
