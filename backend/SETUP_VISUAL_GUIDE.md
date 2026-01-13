# 🎨 Visual Setup Guide - Environment Configuration

## 🎯 Goal
Configure your backend to work with your hosted database: `bylinelm_epub`

---

## 📊 Setup Flow Diagram

```
START
  ↓
┌─────────────────────────────────────────────┐
│  Step 1: Create .env file                   │
│  ────────────────────────────────────────   │
│  Option A: Run .\create-env.ps1             │
│  Option B: Copy from env-template.txt       │
└──────────────────┬──────────────────────────┘
                   ↓
┌─────────────────────────────────────────────┐
│  Step 2: Edit .env file                     │
│  ────────────────────────────────────────   │
│  ✏️ Change JWT_SECRET                       │
│  ✏️ Update CORS_ORIGIN                      │
│  ✏️ Add API keys (optional)                 │
└──────────────────┬──────────────────────────┘
                   ↓
┌─────────────────────────────────────────────┐
│  Step 3: Setup Database                     │
│  ────────────────────────────────────────   │
│  📦 Import schema.sql to bylinelm_epub      │
└──────────────────┬──────────────────────────┘
                   ↓
┌─────────────────────────────────────────────┐
│  Step 4: Start Server                       │
│  ────────────────────────────────────────   │
│  🚀 npm start                               │
└──────────────────┬──────────────────────────┘
                   ↓
                 DONE ✅
```

---

## 🎬 Step-by-Step Visual Guide

### Step 1: Create .env File

**Method A: Using Script (Easiest)**

```
📂 Open PowerShell in backend folder
   ↓
💻 Type: .\create-env.ps1
   ↓
⏎ Press Enter
   ↓
✅ .env file created!
```

**Method B: Manual Creation**

```
📂 Open backend folder
   ↓
📄 Create new file named: .env
   ↓
📋 Copy content from: env-template.txt
   ↓
💾 Save the file
   ↓
✅ .env file created!
```

---

### Step 2: Edit .env File

**Open the .env file and update these 3 things:**

```
┌─────────────────────────────────────────────────────────┐
│ .env file                                               │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ NODE_ENV=production                          ← Keep    │
│ PORT=5000                                    ← Keep    │
│                                                         │
│ DB_HOST=localhost                            ← Keep    │
│ DB_PORT=3306                                 ← Keep    │
│ DB_USER=bylinelm_epub                        ← Keep    │
│ DB_PASSWORD=admin@Byline25                   ← Keep    │
│ DB_NAME=bylinelm_epub                        ← Keep    │
│                                                         │
│ JWT_SECRET=CHANGE-THIS-NOW ←────────────────── ⚠️ CHANGE│
│                                                         │
│ GOOGLE_API_KEY=your-key-here ←──────────────── Add if  │
│ GEMINI_API_KEY=your-key-here ←──────────────── needed  │
│                                                         │
│ CORS_ORIGIN=http://localhost:3000 ←─────────── ⚠️ UPDATE│
│                                                         │
│ MAX_FILE_SIZE=52428800                       ← Keep    │
│ UPLOAD_DIR=./uploads                         ← Keep    │
│ TEMP_DIR=./temp                              ← Keep    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**What to change:**

```
1. JWT_SECRET
   ❌ Bad:  JWT_SECRET=CHANGE-THIS-NOW
   ✅ Good: JWT_SECRET=myS3cur3JWT$ecr3t!2026@Random#Key123

2. CORS_ORIGIN
   ❌ Bad:  CORS_ORIGIN=http://localhost:3000  (if deploying)
   ✅ Good: CORS_ORIGIN=https://yourdomain.com

3. API Keys (if using)
   ❌ Bad:  GOOGLE_API_KEY=your-key-here
   ✅ Good: GOOGLE_API_KEY=AIzaSyD...actual-key...xyz
```

---

### Step 3: Setup Database

**Visual Flow:**

```
┌──────────────────────────────────────────────┐
│  1. Log into Hosting Control Panel          │
└────────────────┬─────────────────────────────┘
                 ↓
┌──────────────────────────────────────────────┐
│  2. Find Database Section                    │
│     (phpMyAdmin, cPanel, etc.)               │
└────────────────┬─────────────────────────────┘
                 ↓
┌──────────────────────────────────────────────┐
│  3. Select Database: bylinelm_epub           │
└────────────────┬─────────────────────────────┘
                 ↓
┌──────────────────────────────────────────────┐
│  4. Import File: database/schema.sql         │
└────────────────┬─────────────────────────────┘
                 ↓
┌──────────────────────────────────────────────┐
│  5. Execute/Import                           │
└────────────────┬─────────────────────────────┘
                 ↓
               ✅ Done!
```

**Expected Result:**

```
Tables Created:
  ✅ users
  ✅ jobs
  ✅ job_pages
  ✅ ai_configs
  ✅ audio_sync_configs
  ✅ tts_configs
  ✅ transcripts
  ✅ chapters
```

---

### Step 4: Start Server

**Command Flow:**

```
📂 Open PowerShell/Terminal
   ↓
📁 cd backend
   ↓
💻 npm start
   ↓
⏳ Wait for...
   ↓
✅ "Server is running on port 5000"
✅ "Connected to MySQL database"
```

**Test It:**

```
Open new terminal
   ↓
💻 curl http://localhost:5000/health
   ↓
📄 Should return:
   {
     "status": "OK",
     "database": "connected",
     "timestamp": "..."
   }
```

---

## 🔄 Environment Switching Diagram

### Production ↔ Local Switching

```
┌─────────────────────────────────────────────┐
│  PRODUCTION ENVIRONMENT                     │
│  ─────────────────────────────────────────  │
│  Database: bylinelm_epub                    │
│  User: bylinelm_epub                        │
│  File: .env                                 │
└──────────────────┬──────────────────────────┘
                   │
                   │  .\switch-to-local.ps1
                   ↓
┌─────────────────────────────────────────────┐
│  Backup: .env → .env.production             │
│  Load: .env.local → .env                    │
└──────────────────┬──────────────────────────┘
                   ↓
┌─────────────────────────────────────────────┐
│  LOCAL DEVELOPMENT ENVIRONMENT              │
│  ─────────────────────────────────────────  │
│  Database: epub_db                          │
│  User: root                                 │
│  File: .env                                 │
└──────────────────┬──────────────────────────┘
                   │
                   │  .\switch-to-production.ps1
                   ↓
┌─────────────────────────────────────────────┐
│  Backup: .env → .env.local                  │
│  Load: .env.production → .env               │
└──────────────────┬──────────────────────────┘
                   ↓
┌─────────────────────────────────────────────┐
│  PRODUCTION ENVIRONMENT                     │
│  ─────────────────────────────────────────  │
│  Database: bylinelm_epub                    │
│  User: bylinelm_epub                        │
│  File: .env                                 │
└─────────────────────────────────────────────┘
```

---

## 📁 File Structure Visual

```
pdf-to-epub-converter/
│
└── backend/
    │
    ├── .env ←──────────────────────────── 📝 YOU CREATE THIS
    ├── .env.production ←───────────────── 💾 Auto backup
    ├── .env.local ←────────────────────── 💾 Auto backup
    │
    ├── create-env.ps1 ←────────────────── 🔧 Run this first!
    ├── create-env-local.ps1 ←──────────── 🔧 For local dev
    ├── switch-to-production.ps1 ←──────── 🔄 Switch script
    ├── switch-to-local.ps1 ←───────────── 🔄 Switch script
    │
    ├── env-template.txt ←──────────────── 📋 Template
    │
    ├── START_HERE_ENV_SETUP.md ←───────── 📖 Read this first!
    ├── QUICK_ENV_SETUP.md
    ├── ENV_SETUP_INSTRUCTIONS.md
    ├── ENV_CONFIGURATION_SUMMARY.md
    ├── README_ENV_SETUP.md
    ├── ENVIRONMENT_SETUP_COMPLETE.md
    ├── README_ENVIRONMENT.md
    ├── SETUP_VISUAL_GUIDE.md ←─────────── 📖 You are here!
    │
    ├── server.js ←─────────────────────── ✅ Enhanced
    ├── src/
    │   └── config/
    │       └── database.js ←───────────── ✅ Uses env vars
    │
    └── database/
        └── schema.sql ←────────────────── 📦 Import this
```

---

## 🎯 Quick Decision Tree

```
                    START
                      │
                      ↓
        ┌─────────────────────────┐
        │  First time setup?      │
        └──────┬──────────┬───────┘
               │          │
             YES          NO
               │          │
               ↓          ↓
    ┌──────────────┐  ┌──────────────┐
    │ Production?  │  │ Switch env?  │
    └──┬────────┬──┘  └──┬────────┬──┘
       │        │        │        │
     YES       NO      YES       NO
       │        │        │        │
       ↓        ↓        ↓        ↓
  create-env  create-  switch-  Just start
     .ps1     env-     to-xxx    npm start
              local     .ps1
              .ps1
```

---

## 📊 Configuration Comparison Table

```
┌──────────────┬─────────────────────┬─────────────────────┐
│  Setting     │  Production         │  Local Development  │
├──────────────┼─────────────────────┼─────────────────────┤
│  Database    │  bylinelm_epub      │  epub_db            │
│  DB User     │  bylinelm_epub      │  root               │
│  DB Pass     │  admin@Byline25     │  (empty)            │
│  Host        │  localhost          │  localhost          │
│  Port        │  3306               │  3306               │
│  Node Env    │  production         │  development        │
│  CORS        │  yourdomain.com     │  localhost:3000     │
└──────────────┴─────────────────────┴─────────────────────┘
```

---

## ✅ Checklist Visual

### Before Starting Server

```
□ .env file exists
□ JWT_SECRET changed
□ CORS_ORIGIN updated
□ API keys added (if needed)
□ Database schema loaded
□ npm install completed
```

### After Starting Server

```
□ Server starts without errors
□ "Connected to MySQL database" message shown
□ Health endpoint returns OK
□ Can access http://localhost:5000/health
□ Frontend can connect
```

---

## 🎨 Color-Coded Priority

### 🔴 CRITICAL - Must Do
- Create `.env` file
- Change `JWT_SECRET`
- Load database schema

### 🟡 IMPORTANT - Should Do
- Update `CORS_ORIGIN`
- Add API keys (if using features)
- Test connection

### 🟢 OPTIONAL - Nice to Have
- Setup local development environment
- Read all documentation
- Configure additional settings

---

## 🚀 One-Command Setup (If You're Feeling Lucky)

```powershell
# Production Quick Setup
cd backend && .\create-env.ps1 && npm start

# Then manually:
# 1. Edit .env (JWT_SECRET, CORS_ORIGIN)
# 2. Import schema.sql to database
# 3. Restart: npm start
```

---

## 📞 Help Decision Tree

```
                  NEED HELP?
                      │
                      ↓
        ┌─────────────────────────┐
        │  What's the issue?      │
        └──────┬──────────┬───────┘
               │          │
         Setup Issue   Error
               │          │
               ↓          ↓
    START_HERE_ENV    ENV_SETUP
      _SETUP.md      _INSTRUCTIONS.md
                         │
                         ↓
                  Troubleshooting
                      Section
```

---

## 🎉 Success Indicators

### You Know It's Working When:

```
✅ Terminal shows:
   "Server is running on port 5000"
   "Connected to MySQL database"

✅ Health check returns:
   { "status": "OK", "database": "connected" }

✅ No error messages

✅ Can access endpoints

✅ Frontend connects successfully
```

---

## 📖 Next Steps After Setup

```
1. ✅ Backend running
   ↓
2. 🎨 Deploy frontend
   ↓
3. 🔗 Connect frontend to backend
   ↓
4. 🧪 Test all features
   ↓
5. 🚀 Go live!
```

---

**Need detailed instructions?** → Read `START_HERE_ENV_SETUP.md`

**Want complete reference?** → Read `README_ENVIRONMENT.md`

**Just want to start?** → Run `.\create-env.ps1` and go!

---

🎨 **Visual guide complete!** You're ready to set up your environment.
