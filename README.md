# AIMeetingAgent

## Prerequisites

- Docker installed
- Working directory is `meeting-assistant-frontend`, containing package.json, Dockerfile, src/, etc.

## Quick Start

1. Build the Docker image  
Run in the project root:

docker build -t meeting-assistant-frontend .

2. Run the container and map the port:

docker run -p 5173:5173 meeting-assistant-frontend

Then open http://localhost:5173 in your browser.

## How to Apply Code Changes

Rebuild and restart the container after changes



