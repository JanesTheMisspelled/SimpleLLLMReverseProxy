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
    return this.config.endpoints.filter(ep => ep.enabled);
  }

  get healthCheck() {
    return this.config.healthCheck;
  }

  get serverPort() {
    return this.config.server.port;
  }

  get cacheTTL() {
    return this.config.cache.ttl;
  }
}

module.exports = new Config();
