const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const logger = require('./utils/logger');

class Config {
  constructor() {
    this.config = null;
    this.configPath = path.join(__dirname, '../config/endpoints.yml');
    this.load();
  }

  load() {
    try {
      const fileContents = fs.readFileSync(this.configPath, 'utf8');
      this.config = yaml.load(fileContents);
      logger.info('Configuration loaded successfully', { endpoints: this.config.endpoints.length });
    } catch (e) {
      logger.error('Failed to load configuration', { error: e.message });
      throw e;
    }
  }

  reload() {
    logger.info('Reloading configuration');
    this.load();
  }

  get endpoints() {
    const enabledEndpoints = this.config.endpoints.filter(ep => ep.enabled);
    const expandedEndpoints = [];
    
    enabledEndpoints.forEach(ep => {
      const ports = Array.isArray(ep.port) ? ep.port : [ep.port];
      
      ports.forEach((port, index) => {
        const newEndpoint = { ...ep, port };
        
        if (ports.length > 1) {
          newEndpoint.name = `${ep.name}-${port}`;
        }
        
        expandedEndpoints.push(newEndpoint);
      });
    });
    
    return expandedEndpoints;
  }

  get healthCheck() {
    return this.config.healthCheck;
  }

  get serverPort() {
    return this.config.server.port;
  }

  get cacheTTL() {
    const { ttlMs, ttlMultiplier } = this.config.cache;
    const healthCheckInterval = this.config.healthCheck.interval;
    
    const ttlOptions = [];
    
    if (ttlMs !== null && ttlMs !== undefined) {
      ttlOptions.push({ value: ttlMs, source: 'ttlMs' });
    }
    
    if (ttlMultiplier !== null && ttlMultiplier !== undefined) {
      ttlOptions.push({ value: healthCheckInterval * ttlMultiplier, source: `ttlMultiplier (${ttlMultiplier} × ${healthCheckInterval}ms)` });
    }
    
    if (ttlOptions.length === 0) {
      return healthCheckInterval;
    }
    
    if (ttlOptions.length > 1) {
      const minOption = ttlOptions.reduce((a, b) => a.value < b.value ? a : b);
      logger.info('Multiple cache TTL options specified, using smallest', {
        options: ttlOptions.map(opt => `${opt.source} = ${opt.value}ms`),
        selected: `${minOption.source} = ${minOption.value}ms`
      });
      return minOption.value;
    }
    
    return ttlOptions[0].value;
  }
}

module.exports = new Config();
