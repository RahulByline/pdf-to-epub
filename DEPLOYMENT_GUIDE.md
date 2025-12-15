# Deployment Guide - A2 Hosting

Complete guide for deploying the PDF to EPUB Converter application on A2 Hosting.

## Prerequisites

1. A2 Hosting account with:
   - Node.js support (Shared, VPS, or Dedicated)
   - MySQL database
   - SSH access (recommended)

2. Domain name configured (optional)

## Step 1: Prepare Files

### On Local Machine

```bash
# Clone or prepare your project
cd pdf-to-epub-converter

# Build frontend
cd frontend
npm install
npm run build
cd ..

# Prepare backend
cd backend
npm install --production
cd ..
```

## Step 2: Upload Files

### Using FTP/SFTP (FileZilla, WinSCP, etc.)

1. Connect to your A2 Hosting account via SFTP
2. Upload backend folder to: `/home/username/backend`
3. Upload frontend/dist folder to: `/home/username/public_html`

### Using SSH (Recommended)

```bash
# Connect via SSH
ssh username@your-domain.com

# Create project directory
mkdir -p ~/pdf-epub-converter
cd ~/pdf-epub-converter

# Upload files (from local machine)
scp -r backend username@your-domain.com:~/pdf-epub-converter/
scp -r frontend/dist username@your-domain.com:~/pdf-epub-converter/frontend/
```

## Step 3: Database Setup

### Via cPanel

1. Log into cPanel
2. Go to MySQL Databases
3. Create new database: `epub_db`
4. Create new user and grant privileges
5. Note down database credentials

### Via SSH

```bash
mysql -u root -p

CREATE DATABASE epub_db;
CREATE USER 'epub_user'@'localhost' IDENTIFIED BY 'strong_password';
GRANT ALL PRIVILEGES ON epub_db.* TO 'epub_user'@'localhost';
FLUSH PRIVILEGES;
EXIT;

# Import schema
mysql -u epub_user -p epub_db < ~/pdf-epub-converter/backend/database/schema.sql
```

## Step 4: Backend Configuration

```bash
cd ~/pdf-epub-converter/backend

# Create .env file
nano .env
```

Add configuration:
```env
PORT=8081
NODE_ENV=production

DB_HOST=localhost
DB_PORT=3306
DB_USER=epub_user
DB_PASSWORD=your_database_password
DB_NAME=epub_db

JWT_SECRET=your-very-secure-secret-key-change-this
JWT_EXPIRES_IN=24h

UPLOAD_DIR=/home/username/pdf-epub-converter/uploads
MAX_FILE_SIZE=52428800
EPUB_OUTPUT_DIR=/home/username/pdf-epub-converter/epub_output
HTML_INTERMEDIATE_DIR=/home/username/pdf-epub-converter/html_intermediate

GEMINI_API_KEY=your-gemini-api-key
GEMINI_API_ENABLED=true
GEMINI_API_MODEL=gemini-2.5-flash
```

## Step 5: Create Required Directories

```bash
mkdir -p ~/pdf-epub-converter/uploads
mkdir -p ~/pdf-epub-converter/epub_output
mkdir -p ~/pdf-epub-converter/html_intermediate

# Set permissions
chmod 755 ~/pdf-epub-converter/uploads
chmod 755 ~/pdf-epub-converter/epub_output
chmod 755 ~/pdf-epub-converter/html_intermediate
```

## Step 6: Install PM2 (Process Manager)

```bash
npm install -g pm2

# Start backend with PM2
cd ~/pdf-epub-converter/backend
pm2 start server.js --name pdf-epub-api

# Save PM2 configuration
pm2 save

# Setup PM2 to start on server reboot
pm2 startup
```

## Step 7: Configure Web Server

### Option A: Nginx (if available)

Create/edit `/etc/nginx/sites-available/pdf-epub`:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # Frontend
    location / {
        root /home/username/public_html;
        try_files $uri $uri/ /index.html;
    }

    # Backend API
    location /api {
        proxy_pass http://localhost:8081;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable site and restart Nginx:
```bash
sudo ln -s /etc/nginx/sites-available/pdf-epub /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### Option B: Apache with .htaccess

In `public_html/.htaccess`:

```apache
RewriteEngine On

# API proxy
RewriteCond %{REQUEST_URI} ^/api
RewriteRule ^api/(.*)$ http://localhost:8081/api/$1 [P,L]

# React routing
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule . /index.html [L]
```

### Option C: Using A2 Hosting's Node.js App Setup

1. Log into cPanel
2. Go to Node.js Selector
3. Create new Node.js application:
   - Node.js version: Latest LTS
   - Application mode: Production
   - Application root: `backend`
   - Application URL: `/api` (or subdomain)
   - Application startup file: `server.js`
4. Install npm modules via cPanel interface
5. Set environment variables in cPanel
6. Start the application

## Step 8: SSL Certificate (HTTPS)

### Via cPanel

1. Go to SSL/TLS Status
2. Install Let's Encrypt certificate
3. Force HTTPS redirect

### Via Certbot (SSH)

```bash
sudo certbot --nginx -d your-domain.com
```

## Step 9: Firewall Configuration

Ensure port 8081 is accessible internally (if using proxy) or externally (if direct access).

For cPanel users, this is usually handled automatically.

## Step 10: Testing

1. Test backend API:
   ```bash
   curl http://localhost:8081/api/health
   ```

2. Test frontend: Visit `http://your-domain.com`

3. Test API through frontend:
   ```bash
   curl http://your-domain.com/api/health
   ```

## Monitoring & Maintenance

### Check PM2 Status

```bash
pm2 status
pm2 logs pdf-epub-api
pm2 monit
```

### Restart Application

```bash
pm2 restart pdf-epub-api
```

### Update Application

```bash
cd ~/pdf-epub-converter/backend
git pull  # or upload new files
npm install --production
pm2 restart pdf-epub-api
```

### Backup Database

```bash
# Via cron job (add to crontab)
mysqldump -u epub_user -p epub_db > ~/backups/epub_db_$(date +%Y%m%d).sql
```

## Troubleshooting

### Backend won't start

1. Check logs: `pm2 logs pdf-epub-api`
2. Verify database connection in `.env`
3. Check file permissions on upload directories
4. Verify Node.js version: `node --version`

### 502 Bad Gateway

1. Check if backend is running: `pm2 status`
2. Verify proxy configuration
3. Check backend logs

### Database connection errors

1. Verify database credentials in `.env`
2. Check if MySQL is running
3. Verify user has proper permissions
4. Check firewall rules

### File upload errors

1. Check directory permissions
2. Verify MAX_FILE_SIZE in `.env`
3. Check disk space: `df -h`
4. Verify upload directory exists

## Performance Optimization

1. **Enable Gzip compression** in web server config
2. **Setup CDN** for static assets
3. **Use Redis** for session storage (optional)
4. **Implement caching** for frequently accessed data
5. **Setup database indexes** (already in schema.sql)
6. **Use connection pooling** (already configured in database.js)

## Security Checklist

- [ ] Change JWT_SECRET to strong random value
- [ ] Use HTTPS (SSL certificate)
- [ ] Set proper file permissions (755 for directories, 644 for files)
- [ ] Keep Node.js and dependencies updated
- [ ] Use strong database passwords
- [ ] Enable firewall rules
- [ ] Regular database backups
- [ ] Monitor logs for suspicious activity
- [ ] Implement rate limiting (optional)
- [ ] Validate all user inputs

## Support

For A2 Hosting specific issues, contact A2 Hosting support.
For application issues, check logs and error messages.



