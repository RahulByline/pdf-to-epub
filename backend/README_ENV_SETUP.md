# Environment Configuration Guide

## Overview
This guide explains how to configure your environment variables for both local development and production deployment.

## Files

### `.env`
- **Purpose**: Active configuration file used by the application
- **Location**: `backend/.env`
- **Status**: ⚠️ Already configured for **PRODUCTION** with hosted database credentials
- **Note**: This file is git-ignored for security

### `.env.local.example`
- **Purpose**: Template for local development
- **Usage**: Copy this file to `.env` when developing locally

### `.env.example`
- **Purpose**: General template showing all available environment variables
- **Usage**: Reference for setting up new environments

## Setup Instructions

### For Local Development

1. **Backup the current production `.env` file:**
   ```bash
   copy .env .env.production
   ```

2. **Copy the local template:**
   ```bash
   copy .env.local.example .env
   ```

3. **Update the `.env` file with your local database credentials:**
   ```env
   DB_HOST=localhost
   DB_PORT=3306
   DB_USER=root
   DB_PASSWORD=your_local_password
   DB_NAME=epub_db
   ```

4. **Set up your local database:**
   - Create the database: `CREATE DATABASE epub_db;`
   - Run the schema: `mysql -u root -p epub_db < database/schema.sql`
   - (Optional) Seed data: `mysql -u root -p epub_db < database/seed.sql`

### For Production Deployment

1. **Use the production `.env` file (already configured):**
   ```env
   DB_HOST=localhost
   DB_PORT=3306
   DB_USER=bylinelm_epub
   DB_PASSWORD=admin@Byline25
   DB_NAME=bylinelm_epub
   ```

2. **Update additional settings:**
   - Set `NODE_ENV=production`
   - Update `CORS_ORIGIN` with your frontend domain
   - Add your API keys (GOOGLE_API_KEY, GEMINI_API_KEY)
   - Generate a secure JWT_SECRET

3. **Database Setup on Host:**
   - Your database is already created with name: `bylinelm_epub`
   - Run the schema: Upload and execute `database/schema.sql`
   - (Optional) Seed data: Execute `database/seed.sql`

## Environment Variables Reference

| Variable | Description | Example |
|----------|-------------|---------|
| `NODE_ENV` | Environment mode | `development` or `production` |
| `PORT` | Server port | `5000` |
| `DB_HOST` | Database host | `localhost` or IP address |
| `DB_PORT` | Database port | `3306` |
| `DB_USER` | Database username | `bylinelm_epub` |
| `DB_PASSWORD` | Database password | `admin@Byline25` |
| `DB_NAME` | Database name | `bylinelm_epub` |
| `JWT_SECRET` | Secret for JWT tokens | Random secure string |
| `GOOGLE_API_KEY` | Google Cloud API key | Your API key |
| `GEMINI_API_KEY` | Gemini AI API key | Your API key |
| `CORS_ORIGIN` | Allowed frontend origin | `http://localhost:3000` |
| `MAX_FILE_SIZE` | Max upload size (bytes) | `52428800` (50MB) |

## Switching Between Environments

### Method 1: Multiple .env files (Recommended)

Keep separate environment files:
- `.env.local` - Local development settings
- `.env.production` - Production settings

Switch between them:
```bash
# For local development
copy .env.local .env

# For production
copy .env.production .env
```

### Method 2: Environment-specific scripts

Update `package.json` scripts:
```json
{
  "scripts": {
    "start": "node server.js",
    "start:prod": "NODE_ENV=production node server.js",
    "dev": "NODE_ENV=development nodemon server.js"
  }
}
```

## Security Best Practices

1. ✅ Never commit `.env` files to git (already in `.gitignore`)
2. ✅ Use strong, unique passwords for production
3. ✅ Generate a secure random JWT_SECRET
4. ✅ Keep API keys confidential
5. ✅ Regularly rotate credentials
6. ✅ Use different credentials for development and production

## Troubleshooting

### Connection Issues
- Verify database credentials are correct
- Check if MySQL service is running
- Ensure firewall allows connection to port 3306
- For hosted databases, check if your IP is whitelisted

### Environment Not Loading
- Ensure `dotenv` package is installed
- Check that `.env` file is in the `backend` directory
- Verify `dotenv.config()` is called before using environment variables

## Current Configuration Status

✅ **Production database configured:**
- Host: localhost
- Database: bylinelm_epub
- User: bylinelm_epub
- Password: admin@Byline25

📝 **Next steps:**
1. Add your API keys to `.env`
2. Update CORS_ORIGIN with your frontend URL
3. Generate and set a secure JWT_SECRET
4. Run database schema on production database

## Support

For issues or questions, refer to:
- Main README: `../README.md`
- API Documentation: `../API_DOCUMENTATION.md`
- Deployment Guide: `../DEPLOYMENT_GUIDE.md`
