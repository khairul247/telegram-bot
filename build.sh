#!/bin/bash
set -e
echo "Installing root dependencies..."
npm install
echo "Installing dashboard dependencies..."
cd dashboard
npm install
echo "Building dashboard..."
npm run build
echo "Build complete."
