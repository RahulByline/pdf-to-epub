# Fixing "Port Already in Use" Error

If you see the error `EADDRINUSE: address already in use :::8081`, here are solutions:

## Quick Fix

### Option 1: Stop the Process Using the Port (Windows)

```powershell
# Run this in the backend directory
npm run stop-port

# Or manually:
netstat -ano | findstr :8081
taskkill /PID <PID> /F
```

### Option 2: Use a Different Port

Edit `backend/.env`:
```env
PORT=8082
```

Then restart the server.

### Option 3: Kill All Node Processes (Windows)

```powershell
# Kill all Node.js processes
Get-Process node | Stop-Process -Force
```

## Prevention

1. **Always stop the server properly**: Press `Ctrl+C` in the terminal where the server is running
2. **Use the stop script**: `npm run stop-port` before starting the server
3. **Check before starting**: The server now shows a helpful error message if the port is in use

## Troubleshooting

- If port keeps getting occupied, check if nodemon is running multiple instances
- Close all terminal windows running the server
- Restart your terminal/IDE
- Check Task Manager for multiple Node.js processes

