# 🎯 START HERE - Environment Setup for Hosted Database

## What You Need to Do (3 Simple Steps)

### ⚡ Step 1: Create the .env file

**Option A: Using PowerShell (Recommended)**
```powershell
cd backend
.\create-env.ps1
```

**Option B: Manual Creation**
1. Open the `backend` folder
2. Create a new file named `.env` (yes, it starts with a dot)
3. Copy and paste this content:

```env
NODE_ENV=production
PORT=5000
DB_HOST=localhost
DB_PORT=3306
DB_USER=bylinelm_epub
DB_PASSWORD=admin@Byline25
DB_NAME=bylinelm_epub
JWT_SECRET=CHANGE-THIS-TO-A-RANDOM-STRING-12345
GOOGLE_API_KEY=your-google-api-key-here
GEMINI_API_KEY=your-gemini-api-key-here
CORS_ORIGIN=http://localhost:3000
MAX_FILE_SIZE=52428800
UPLOAD_DIR=./uploads
TEMP_DIR=./temp
```

4. Save the file

### ⚡ Step 2: Update Critical Settings

Open the `.env` file you just created and change:

1. **JWT_SECRET**: Replace with a random string (at least 32 characters)
   - Example: `myS3cur3JWT$ecr3tK3y!2026@Byline#Random123`

2. **CORS_ORIGIN**: Change to your frontend URL
   - For local testing: `http://localhost:3000`
   - For production: `https://yourdomain.com`

3. **API Keys** (if you're using these features):
   - Add your Google Cloud API key
   - Add your Gemini AI API key

### ⚡ Step 3: Setup Database on Host

1. Log into your hosting control panel (cPanel, phpMyAdmin, etc.)
2. Open the database: `bylinelm_epub`
3. Import/Execute the file: `backend/database/schema.sql`
4. Verify tables are created

## 🚀 Start the Server

```bash
cd backend
npm install
npm start
```

You should see:
```
✅ Server is running on port 5000
✅ Connected to MySQL database
```

## ✅ That's It!

Your backend is now configured to work with your hosted database.

---

## 📚 Additional Information

### For Local Development

If you want to work with a local database instead:

```powershell
cd backend
.\create-env-local.ps1
```

This will:
- Save your production config to `.env.production`
- Create a new `.env` for local development
- Use a local database named `epub_db`

### Switch Between Environments

```powershell
# Switch to production
.\switch-to-production.ps1

# Switch to local
.\switch-to-local.ps1
```

### Important Notes

**If you're accessing the database remotely** (not from the same server):
- Contact your hosting provider for the actual `DB_HOST` address
- It might not be `localhost`
- You may need to whitelist your IP address

**If your backend is on the same server as the database**:
- ✅ `DB_HOST=localhost` is correct
- ✅ No additional configuration needed

### Files Reference

- `QUICK_ENV_SETUP.md` - Quick 2-minute guide
- `ENV_SETUP_INSTRUCTIONS.md` - Detailed instructions with troubleshooting
- `ENV_CONFIGURATION_SUMMARY.md` - Complete configuration reference
- `README_ENV_SETUP.md` - Full environment documentation

### Need Help?

Check `ENV_SETUP_INSTRUCTIONS.md` for detailed troubleshooting.

---

🎉 **Your backend is ready to go!**
