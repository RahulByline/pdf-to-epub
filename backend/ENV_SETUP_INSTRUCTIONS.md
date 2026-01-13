# 🚀 Quick Environment Setup Instructions

## Current Status
Your backend is configured to work with environment variables, but you need to create the `.env` file manually.

## Step-by-Step Setup

### 1. Create the `.env` file

Navigate to the `backend` directory and create a new file called `.env`:

```bash
cd backend
# On Windows PowerShell:
New-Item -Path ".env" -ItemType File

# Or simply create the file using your text editor
```

### 2. Add Production Configuration

Copy and paste the following content into your `backend/.env` file:

```env
# Environment
NODE_ENV=production

# Server Configuration
PORT=5000

# Database Production
DB_HOST=localhost
DB_PORT=3306
DB_USER=bylinelm_epub
DB_PASSWORD=admin@Byline25
DB_NAME=bylinelm_epub

# JWT Secret (CHANGE THIS to a random secure string!)
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production

# API Keys (Add your actual API keys here)
GOOGLE_API_KEY=your-google-api-key-here
GEMINI_API_KEY=your-gemini-api-key-here

# CORS Settings (Update with your frontend URL)
CORS_ORIGIN=http://localhost:3000

# File Upload Settings
MAX_FILE_SIZE=52428800
UPLOAD_DIR=./uploads
TEMP_DIR=./temp
```

### 3. For Local Development

If you want to work locally (not on the hosted database), create a `.env.local` file with these settings:

```env
# Environment
NODE_ENV=development

# Server Configuration
PORT=5000

# Database Local Development
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=epub_db

# JWT Secret
JWT_SECRET=your-local-jwt-secret-key

# API Keys
GOOGLE_API_KEY=your-google-api-key-here
GEMINI_API_KEY=your-gemini-api-key-here

# CORS Settings
CORS_ORIGIN=http://localhost:3000

# File Upload Settings
MAX_FILE_SIZE=52428800
UPLOAD_DIR=./uploads
TEMP_DIR=./temp
```

## Switching Between Environments

### Option 1: Rename Files (Simple)
```bash
# Switch to local development
ren .env .env.production
ren .env.local .env

# Switch back to production
ren .env .env.local
ren .env.production .env
```

### Option 2: Use Different Environment Variables
Keep both files and manually change which one is active by renaming it to `.env`.

## Important Security Notes

⚠️ **CRITICAL:**
1. Never commit `.env` files to Git (already protected in `.gitignore`)
2. Change the `JWT_SECRET` to a random secure string
3. Add your actual API keys before running
4. For production, update `CORS_ORIGIN` with your actual frontend domain

## Generate Secure JWT Secret

Use this command to generate a secure random string:

**On Windows PowerShell:**
```powershell
-join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | % {[char]$_})
```

**On Node.js:**
```javascript
require('crypto').randomBytes(64).toString('hex')
```

## Verify Configuration

After creating the `.env` file, test your configuration:

```bash
cd backend
npm start
```

You should see:
```
Server is running on port 5000
Connected to MySQL database
```

## Database Setup on Hosted Server

Since you're using the hosted database `bylinelm_epub`, make sure to:

1. **Run the schema:**
   - Upload `backend/database/schema.sql` to your hosting control panel
   - Execute it in phpMyAdmin or your database manager

2. **Verify tables are created:**
   ```sql
   USE bylinelm_epub;
   SHOW TABLES;
   ```

3. **(Optional) Seed initial data:**
   - Upload and execute `backend/database/seed.sql`

## Troubleshooting

### ❌ "Database connection error"
- Check if database credentials are correct
- Verify the database server is running
- For hosted databases, check if your server IP is whitelisted
- Test connection using MySQL client

### ❌ ".env file not found"
- Make sure the file is named exactly `.env` (with the dot)
- Ensure it's in the `backend` directory, not the root
- Check file is not hidden by your OS

### ❌ "Cannot connect to production database from local"
- You may need to use a different `DB_HOST` (not localhost)
- Check with your hosting provider for:
  - Actual database host address
  - Port number (might not be 3306)
  - IP whitelist requirements
  - SSL/TLS requirements

## Next Steps

1. ✅ Create `.env` file with production credentials
2. ✅ Update JWT_SECRET with a secure random string
3. ✅ Add your API keys (if using Google Cloud TTS or Gemini AI)
4. ✅ Update CORS_ORIGIN with your frontend domain
5. ✅ Test the connection by starting the server
6. ✅ Run database schema on hosted database

## Questions?

Check these files for more info:
- `README_ENV_SETUP.md` - Detailed environment configuration
- `API_DOCUMENTATION.md` - API endpoints documentation
- `DEPLOYMENT_GUIDE.md` - Full deployment instructions
