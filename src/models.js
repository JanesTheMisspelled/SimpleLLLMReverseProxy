const axios = require('axios');
const healthChecker = require('./health');
const logger = require('./utils/logger');
const config = require('./config');

class ModelsAggregator {
  constructor() {
    this.cache = null;
    this.cacheTimestamp = null;
    this.modelToEndpointMap = new Map();
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

  async getAllModels() {
    const now = Date.now();
    
    if (this.cache && (now - this.cacheTimestamp) < config.cacheTTL) {
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

  getCachedModels() {
    return this.cache;
  }

  getEndpointForModel(modelName) {
    const cachedModels = this.getCachedModels();
    
    if (cachedModels) {
      const endpoints = this.modelToEndpointMap.get(modelName);
      
      if (endpoints && endpoints.length > 0) {
        const endpoint = endpoints[0]; //change to round robin?
        logger.debug(`Model ${modelName} found at endpoint ${endpoint.name} using cache (${endpoints.length} available)`, {
          model: modelName,
          endpoint: endpoint.name,
          totalEndpoints: endpoints.length
        });
        return endpoint;
      }
    }
    
    return null;
  }
}

module.exports = new ModelsAggregator();
