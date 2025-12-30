# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Project Overview

This is a Hugging Face Space keep-alive tool that periodically sends HTTP
requests to prevent the space from going dormant. It's a TypeScript project
using ES Modules with undici as the HTTP client, deployed via Docker.

## Development Commands

- `pnpm install` - Install dependencies
- `pnpm build` - Compile TypeScript to `dist/` directory
- `pnpm dev` - Run directly from TypeScript source using tsx
- `pnpm start` - Run the compiled JavaScript from `dist/index.js`

For Docker deployment:

- `docker build -t hf-keep-alive .` - Build Docker image
- `docker run -d -e TARGET_URL=... -e CURRENT_COOKIE=... hf-keep-alive` - Run
  container

## Architecture

### Core Components

The application is a single-file TypeScript program
([src/index.ts](src/index.ts)) with these key sections:

1. **Configuration Management** ([src/index.ts:20-30](src/index.ts#L20-L30))
   - Reads `TARGET_URL` and `CURRENT_COOKIE` from environment variables
   - Default interval: 30 seconds
   - Validates URL format and required env vars on startup

2. **Cookie Handling** ([src/index.ts:67-127](src/index.ts#L67-L127))
   - Uses the `cookie` package (v1.1.1) with ESM syntax:
     `import * as cookie from 'cookie'`
   - Key methods from cookie package:
     - `cookie.parseCookie()` - Parses Cookie header string
     - `cookie.stringifyCookie()` - Serializes cookie object to header format
     - `cookie.parseSetCookie()` - Parses Set-Cookie headers for updates
   - Maintains in-memory `cookieData` object that updates with server responses

3. **Keep-Alive Logic** ([src/index.ts:150-203](src/index.ts#L150-L203))
   - Uses undici's `request` function to send GET requests
   - Processes Set-Cookie headers to refresh session
   - Detects failure markers in response body:
     - `"Sorry, we can't find the page you are looking for."`
     - `"https://huggingface.co/front/assets/huggingface_logo.svg"`
   - Logs status with timestamps
   - Handles undici-specific errors (HeadersTimeoutError, BodyTimeoutError,
     UND_ERR_CONNECT)

4. **Main Loop** ([src/index.ts:210-237](src/index.ts#L210-L237))
   - Validates configuration on startup
   - Executes one immediate keep-alive request
   - Runs on 30-second interval using `setInterval`

## Module System

**Important**: This project uses ES Modules exclusively:

- `package.json` has `"type": "module"`
- `tsconfig.json` uses `"module": "NodeNext"` and
  `"moduleResolution": "NodeNext"`
- All imports use ES6 syntax: `import { request } from 'undici'`
- No `require()` or CommonJS syntax

The `tsx` package (not `ts-node`) is used for development mode because it
properly supports ESM.

## HTTP Client: Undici

This project uses **undici** instead of axios:

- Undici is Node.js's native HTTP/1.1 client, written in TypeScript
- It's faster and more efficient than axios
- Uses streaming API for response body: `await response.body.text()`
- Timeout configuration uses `headersTimeout` and `bodyTimeout` options
- Error types: `HeadersTimeoutError`, `BodyTimeoutError`, `UND_ERR_CONNECT`

See [undici.md](undici.md) for complete undici documentation.

## Environment Variables

Required:

- `TARGET_URL` - Full Hugging Face Space URL including query parameters
- `CURRENT_COOKIE` - Cookie string (typically `spaces-jwt=...` format)

Optional:

- `INTERVAL` - Request interval in milliseconds (default: 30000)
- `EXPECTED_STATUS_CODES` - Comma-separated list of expected HTTP status codes (default: "200")

Example: `EXPECTED_STATUS_CODES=200,301,302`

## Docker Deployment

The Dockerfile ([Dockerfile](Dockerfile)) uses pnpm:

1. Base: `node:24-alpine`
2. Installs pnpm globally
3. Copies `package.json` and `pnpm-lock.yaml`
4. Runs `pnpm install --frozen-lockfile`
5. Compiles TypeScript with `pnpm build`
6. Prunes dev dependencies with `pnpm prune --prod`
7. Runs with `pnpm start` (executes `node dist/index.js`)

## Dependencies

Runtime:

- `undici` (^7.16.0) - HTTP/1.1 client (Node.js native)
- `cookie` (1.1.1) - Cookie parsing/serialization

Development:

- `tsx` (^4.19.0) - TypeScript executor for ESM
- `typescript` (^5.0.0) - Compiler
- `@types/node` (^20.19.27) - Node.js type definitions
- `@types/cookie` (^0.6.0) - Cookie type definitions
