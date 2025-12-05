# Quick Start Guide

Get the PDF to EPUB Converter running in 5 minutes!

## Prerequisites Check

- [ ] Node.js 18+ installed (`node --version`)
- [ ] MySQL 8.0+ installed and running
- [ ] npm installed (`npm --version`)

## Step-by-Step Setup

### 1. Database Setup (2 minutes)

```bash
# Open MySQL
mysql -u root -p

# Create database
CREATE DATABASE epub_db;
EXIT;

# Import schema
mysql -u root -p epub_db < backend/database/schema.sql
```

### 2. Backend Setup (2 minutes)

```bash
cd backend

# Install dependencies
npm install

# Create .env file (copy from .env.example and update)
# Edit DB_PASSWORD and other values

# Start server
npm start
```

Backend should now be running on `http://localhost:8081`

### 3. Frontend Setup (1 minute)

```bash
# In a new terminal
cd frontend

# Install dependencies
npm install

# Start dev server
npm run dev
```

Frontend should now be running on `http://localhost:3000`

### 4. Test It!

1. Open browser to `http://localhost:3000`
2. Upload a PDF file
3. Start a conversion
4. Download the EPUB!

## Common Issues

**Database connection error?**
- Check MySQL is running: `mysql -u root -p`
- Verify credentials in `backend/.env`
- Ensure database `epub_db` exists

**Port already in use?**
- Change PORT in `backend/.env`
- Change port in `frontend/vite.config.js`

**File upload fails?**
- Check `backend/uploads` directory exists
- Verify write permissions: `chmod 755 backend/uploads`

**Frontend can't connect to backend?**
- Verify backend is running on port 8081
- Check `VITE_API_URL` in `frontend/.env`

## Next Steps

- Read [README.md](README.md) for full documentation
- See [API_DOCUMENTATION.md](API_DOCUMENTATION.md) for API details
- Check [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) for production deployment

## Need Help?

Check the logs:
- Backend: Console output
- Frontend: Browser console
- Database: MySQL error log

Happy converting! 🚀

