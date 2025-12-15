#!/bin/bash
# Bash script to stop any process using port 8081 (Linux/Mac)

PORT=${1:-8081}

echo "Checking for processes on port $PORT..."

# Find process ID
PID=$(lsof -ti:$PORT)

if [ -z "$PID" ]; then
    echo "No process found on port $PORT"
else
    echo "Found process: PID $PID"
    kill -9 $PID
    echo "✓ Stopped process $PID"
    echo "Port $PORT is now free!"
fi




