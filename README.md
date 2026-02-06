# Simple LLM Reverse Proxy

A simple reverse proxy manager for local LLM endpoints that aggregates models from multiple servers and routes requests based on model names.

## Features

- **Model Aggregation**: Combines models from all healthy endpoints into a single `/v1/models` response
- **Request Routing**: Routes `/v1/chat/completions` requests to the appropriate endpoint based on the model name
- **Streaming Support**: Handles streaming responses from endpoints to clients
- **Health Checking**: Monitors endpoint availability and auto-failover with custom health check paths per endpoint
- **Force Health Checks**: Manually trigger health checks on all endpoints via API
- **Configuration**: Simple YAML-based endpoint configuration

## Installation

```bash
npm install
```

## Configuration

Edit `config/endpoints.yml` to configure your endpoints:

```yaml
endpoints:
  - name: server1
    address: 127.0.0.1
    port: 8001
    enabled: true
    healthCheckPath: /health  # Optional: override global health check path, for example /health for llama-server
  - name: server2
    address: 127.0.0.1
    port: 8002
    enabled: true

healthCheck:
  interval: 30000              # Check every 30 seconds
  timeout: 5000                # Request timeout in ms
  path: /v1/models
  failureThreshold: 3          # Mark unhealthy after 3 failures

cache:
  ttlMs: 30000                 # Cache TTL in milliseconds (optional)
  ttlMultiplier: null          # Cache TTL as multiplier of healthCheck interval (optional)
                              # If both specified, the smaller value is used

server:
  port: 8080
```

## Usage

Start the server:

```bash
npm start
```

## API Endpoints

### GET /v1/models

Returns a list of all available models from healthy endpoints.

Response format:
```json
{
  "object": "list",
  "data": [
    {
      "id": "model-name",
      "object": "model",
      "provider": "server1",
      "endpoint": "127.0.0.1:8001"
    }
  ]
}
```

### POST /v1/chat/completions

Proxies chat completion requests to the appropriate endpoint based on the `model` field.

Request format:
```json
{
  "model": "model-name",
  "messages": [
    { "role": "user", "content": "Hello!" }
  ],
  "stream": true
}
```

### GET /health

Returns health status of all endpoints.

Response format:
```json
{
  "status": "healthy",
  "endpoints": {
    "server1": {
      "healthy": true,
      "lastCheck": "2024-01-31T22:00:00.000Z",
      "errorCount": 0,
      "lastError": null
    }
  },
  "healthy_endpoints": 2,
  "total_endpoints": 2
}
```

### POST /health/force-check

Forces an immediate health check on all endpoints and returns the updated status.

Response format:
```json
{
  "status": "healthy",
  "endpoints": {
    "server1": {
      "healthy": true,
      "lastCheck": "2024-01-31T22:00:00.000Z",
      "errorCount": 0,
      "lastError": null
    }
  },
  "healthy_endpoints": 2,
  "total_endpoints": 2
}
```

## How It Works

1. **Health Checking**: The proxy periodically checks each endpoint's `/v1/models` endpoint to verify availability
2. **Model Discovery**: When `/v1/models` is called, it fetches models from all healthy endpoints and combines them
3. **Request Routing**: When `/v1/chat/completions` is called, it checks which endpoint supports the requested model and routes the request there
4. **Streaming**: The proxy streams responses directly from the endpoint to the client without buffering
5. **Caching**: The model list is cached according to the configured TTL. TTL can be specified as milliseconds (`ttlMs`) or as a multiplier of the health check interval (`ttlMultiplier`). If both are specified, the smaller value is used.

## Requirements

Each underlying endpoint must:
- Respond to `GET /v1/models` with a list of available models
- Support `POST /v1/chat/completions` with the standard OpenAI API format
- Include a `model` field in the request body for routing

## AI
Primary vibe code

## License

MIT
