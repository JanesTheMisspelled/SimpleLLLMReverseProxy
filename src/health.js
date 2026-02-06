const axios = require('axios');
const config = require('./config');
const logger = require('./utils/logger');

class HealthChecker {
  constructor() {
    this.endpointStatus = new Map();
    this.checkInterval = null;
    this.initializeStatus();
  }

  initializeStatus() {
    config.endpoints.forEach(endpoint => {
      this.endpointStatus.set(endpoint.name, {
        healthy: true,
        lastCheck: null,
        errorCount: 0,
        lastError: null
      });
    });
  }

  getHealthyEndpoints() {
    return config.endpoints.filter(endpoint => {
      const status = this.endpointStatus.get(endpoint.name);
      return status && status.healthy;
    });
  }

  getEndpointUrl(endpoint) {
    return `http://${endpoint.address}:${endpoint.port}`;
  }

  async checkEndpoint(endpoint) {
    const url = this.getEndpointUrl(endpoint);
    const healthCheckPath = endpoint.healthCheckPath || config.healthCheck.path;
    const status = this.endpointStatus.get(endpoint.name);
    
    try {
      const response = await axios.get(`${url}${healthCheckPath}`, {
        timeout: config.healthCheck.timeout
      });

      status.healthy = true;
      status.errorCount = 0;
      status.lastError = null;
      status.lastCheck = new Date().toISOString();

      logger.debug(`Health check passed for ${endpoint.name}`, { 
        endpoint: endpoint.name,
        status: response.status 
      });
    } catch (error) {
      status.errorCount++;
      status.lastError = null;
      status.lastCheck = new Date().toISOString();

      if (status.errorCount >= config.healthCheck.failureThreshold) {
        status.healthy = false;
        logger.warn(`Endpoint marked unhealthy: ${endpoint.name}`, { 
          endpoint: endpoint.name,
          errorCount: config.healthCheck.failureThreshold,
          error: error.message 
        });
      } else {
        logger.warn(`Health check failed for ${endpoint.name}`, { 
          endpoint: endpoint.name,
          errorCount: status.errorCount,
          error: error.message 
        });
      }
    }
  }

  async checkAll() {
    const checks = config.endpoints.map(endpoint => this.checkEndpoint(endpoint));
    await Promise.all(checks);
  }

  start() {
    logger.info('Starting health checker', { 
      interval: config.healthCheck.interval,
      endpoints: config.endpoints.length 
    });
    
    this.checkAll();
    this.checkInterval = setInterval(() => {
      this.checkAll();
    }, config.healthCheck.interval);
  }

  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      logger.info('Health checker stopped');
    }
  }

  getStatus() {
    const status = {};
    this.endpointStatus.forEach((value, key) => {
      status[key] = value;
    });
    return status;
  }
}

module.exports = new HealthChecker();
