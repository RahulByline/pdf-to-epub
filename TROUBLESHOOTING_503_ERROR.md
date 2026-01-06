# Troubleshooting 503 Service Unavailable Error

## Common Causes of 503 Errors

A 503 error means your backend server is not responding. Here are the most common causes and solutions:

## 1. Check if Server Process is Running

### If using PM2 (Process Manager):
```bash
# SSH into your server
ssh user@epub.legatolxp.online

# Check PM2 status
pm2 list

# Check PM2 logs
pm2 logs

# If server is not running, start it
cd /path/to/your/backend
pm2 start server.js --name "epub-backend"

# Or restart if it's already running
pm2 restart epub-backend
```

### If using systemd:
```bash
# Check service status
sudo systemctl status epub-backend

# Start service if stopped
sudo systemctl start epub-backend

# Check logs
sudo journalctl -u epub-backend -f
```

### If running directly with Node:
```bash
# Check if process is running
ps aux | grep node

# Check if port is in use
netstat -tulpn | grep 8081
# or
lsof -i :8081

# Start server manually
cd backend
node server.js
```

## 2. Check Server Logs

```bash
# Check application logs
tail -f /var/log/epub-backend/error.log
# or
pm2 logs epub-backend --err

# Check system logs
tail -f /var/log/syslog
```

## 3. Database Connection Issues

The 503 error might be caused by database connection failures. Check:

```bash
# Test database connection
mysql -h YOUR_DB_HOST -u YOUR_DB_USER -p

# Check if database exists
mysql -u root -p -e "SHOW DATABASES;"
```

### Verify Environment Variables

Make sure your `.env` file on the server has correct database credentials:

```env
DB_HOST=your_database_host
DB_PORT=3306
DB_USER=your_database_user
DB_PASSWORD=your_database_password
DB_NAME=epub_db
PORT=8081
NODE_ENV=production
```

## 4. Check Server Resources

```bash
# Check memory usage
free -h

# Check disk space
df -h

# Check CPU usage
top
# or
htop
```

If resources are exhausted, the server might be crashing.

## 5. Check Port Configuration

Verify the server is listening on the correct port:

```bash
# Check what's listening on port 8081
netstat -tulpn | grep 8081
# or
ss -tulpn | grep 8081

# Check if reverse proxy (nginx/apache) is configured correctly
```

## 6. Reverse Proxy Configuration (Nginx/Apache)

If you're using a reverse proxy, check its configuration:

### Nginx Example:
```nginx
server {
    listen 80;
    server_name epub.legatolxp.online;

    location /api {
        proxy_pass http://localhost:8081;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

Check nginx status:
```bash
sudo systemctl status nginx
sudo nginx -t  # Test configuration
sudo systemctl reload nginx
```

## 7. Quick Health Check

Add this endpoint to test if server is responding:

The server already has a `/health` endpoint. Test it:

```bash
curl https://epub.legatolxp.online/health
# or
curl http://localhost:8081/health
```

## 8. Common Fixes

### Restart Everything:
```bash
# If using PM2
pm2 restart all

# If using systemd
sudo systemctl restart epub-backend
sudo systemctl restart nginx  # if using nginx

# If running manually, kill and restart
pkill -f "node.*server.js"
cd /path/to/backend
node server.js
```

### Check for Error in Code:
```bash
# Try running server directly to see errors
cd backend
node server.js
```

### Verify Dependencies:
```bash
cd backend
npm install  # Reinstall dependencies
```

## 9. Monitoring Setup

Consider setting up monitoring to catch issues early:

### PM2 Monitoring:
```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
```

### Add Health Check Endpoint Monitoring:
Set up a cron job or monitoring service to check `/health` endpoint regularly.

## 10. Emergency Recovery

If nothing works, try this step-by-step recovery:

```bash
# 1. Stop all processes
pm2 stop all
# or
sudo systemctl stop epub-backend

# 2. Check for port conflicts
lsof -i :8081
# Kill any conflicting processes if needed

# 3. Verify environment
cd backend
cat .env  # Check environment variables

# 4. Test database connection
node -e "require('./src/config/database.js').default.getConnection().then(c => {console.log('DB OK'); c.release(); process.exit(0);}).catch(e => {console.error('DB Error:', e); process.exit(1);})"

# 5. Start server in foreground to see errors
node server.js

# 6. If it works, start with PM2
pm2 start server.js --name epub-backend
pm2 save
```

## Debugging Checklist

- [ ] Server process is running
- [ ] Port 8081 is not blocked by firewall
- [ ] Database is accessible and credentials are correct
- [ ] Environment variables are set correctly
- [ ] Dependencies are installed (`npm install`)
- [ ] Reverse proxy (if used) is configured correctly
- [ ] Server has enough resources (memory, disk space)
- [ ] No syntax errors in code (check logs)
- [ ] Health endpoint responds: `/health`

## Get More Information

To get detailed error information, check:

1. **Application logs**: `pm2 logs` or your log files
2. **System logs**: `journalctl -u your-service` or `/var/log/syslog`
3. **Browser console**: Check for specific error messages
4. **Network tab**: Check the actual HTTP response from the server

## Still Having Issues?

If the problem persists, check:
- Server firewall rules
- Cloud provider security groups
- SSL certificate issues (if using HTTPS)
- DNS configuration
- Load balancer configuration (if using one)






