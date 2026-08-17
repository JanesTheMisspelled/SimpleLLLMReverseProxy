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

      if (this.config.mode === undefined) {
        this.config.mode = 'model-lookup';
      } else if (this.config.mode !== 'model-lookup' && this.config.mode !== 'single-model') {
        logger.warn(`Unknown mode "${this.config.mode}", falling back to "model-lookup"`);
        this.config.mode = 'model-lookup';
      }

      logger.info('Configuration loaded successfully', { endpoints: this.config.endpoints.length, mode: this.config.mode });
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
      const weight = Number.isInteger(ep.weight) && ep.weight > 0 ? ep.weight : 1;

      if (ep.weight !== undefined && ep.weight !== null && weight !== ep.weight) {
        logger.warn(`Invalid weight "${ep.weight}" for endpoint ${ep.name}, must be a positive integer, defaulting to 1`);
      }

      const priority = Number.isInteger(ep.priority) ? ep.priority : 0;

      if (ep.priority !== undefined && ep.priority !== null && priority !== ep.priority) {
        logger.warn(`Invalid priority "${ep.priority}" for endpoint ${ep.name}, must be an integer, defaulting to 0`);
      }

      ports.forEach((port, index) => {
        const newEndpoint = { ...ep, port, weight, priority };
        
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

  get mode() {
    return this.config.mode;
  }

  get singleModelName() {
    return this.config.model || null;
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
