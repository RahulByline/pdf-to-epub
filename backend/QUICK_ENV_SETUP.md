# 🚀 Quick Environment Setup (2 Minutes)

## For Production (Hosted Database)

**Option 1: Using PowerShell Script (Easiest)**
```powershell
cd backend
.\create-env.ps1
```

**Option 2: Manual Creation**
1. Create a file named `.env` in the `backend` folder
2. Copy this content into it:

```env
NODE_ENV=production
PORT=5000
DB_HOST=localhost
DB_PORT=3306
DB_USER=bylinelm_epub
DB_PASSWORD=admin@Byline25
DB_NAME=bylinelm_epub
JWT_SECRET=your-super-secret-jwt-key-change-this
GOOGLE_API_KEY=your-google-api-key-here
GEMINI_API_KEY=your-gemini-api-key-here
CORS_ORIGIN=http://localhost:3000
MAX_FILE_SIZE=52428800
UPLOAD_DIR=./uploads
TEMP_DIR=./temp
```

3. **Important:** Change `JWT_SECRET` to a random string!

## For Local Development

**Using PowerShell Script:**
```powershell
cd backend
.\create-env-local.ps1
```

This will:
- Backup your production `.env` to `.env.production`
- Create a new `.env` for local development
- Use local database `epub_db` with user `root`

## Switch Between Environments

```powershell
# Switch to production
.\switch-to-production.ps1

# Switch to local
.\switch-to-local.ps1
```

## Test Your Setup

```bash
cd backend
npm start
```

You should see:
```
✅ Server is running on port 5000
✅ Connected to MySQL database
```

## Hosted Database Note

⚠️ **Important:** Your hosting provider may require:
- Different `DB_HOST` (not localhost) - ask your hosting provider
- IP whitelisting for remote connections
- SSL/TLS connection settings

If you can't connect, check with your hosting provider for:
1. Actual database host address
2. Remote access permissions
3. Port number (may not be 3306)
4. SSL requirements

## Need Help?

See `ENV_SETUP_INSTRUCTIONS.md` for detailed troubleshooting.

---

✨ **That's it!** Your backend is now configured to work in both environments.
