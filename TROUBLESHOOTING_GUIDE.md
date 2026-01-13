# JavaScript Errors Troubleshooting Guide

## 🚨 Issues Fixed

### 1. Missing vite.svg (404 Error)
**Error:** `GET https://epub.bylinelms.com/vite.svg 404 (Not Found)`

**Solution:** Created `/frontend/public/vite.svg` file with the Vite logo SVG.

### 2. Cannot read properties of undefined (reading 'length')
**Error:** `TypeError: Cannot read properties of undefined (reading 'length')`

**Causes & Solutions:**
- **Dashboard:** API calls returning undefined instead of arrays
- **Components:** Accessing properties of undefined objects
- **API responses:** Missing error handling for failed requests

**Solutions Applied:**
- Added `.catch(() => [])` to all conversionService API calls
- Added defensive checks in Dashboard component
- Added proper error handling in PdfList component
- Added ErrorBoundary component to catch unhandled errors

### 3. API Connection Issues
**Error:** API calls failing due to wrong port configuration

**Solution:**
- Fixed Vite proxy configuration: `http://localhost:8081` (not 8082)
- Updated API base URL to use `/api` (proxied correctly)
- Added better error logging in API interceptors

## 🔧 Debugging Tools Added

### Error Boundary
- Catches unhandled React errors
- Shows user-friendly error messages
- Displays error details in development mode
- Prevents app crashes

### Health Check Component
- Shows backend API status in navbar
- Checks database connectivity
- Provides real-time system health monitoring

### Enhanced Error Handling
- Better error messages in PdfUpload component
- File validation (size, type) before upload
- Network error detection and logging

## 🚀 How to Test the Fixes

### 1. Start Backend Server
```bash
cd backend
node server.js
```
Backend should run on `http://localhost:8081`

### 2. Start Frontend Development Server
```bash
cd frontend
npm run dev
```
Frontend should run on `http://localhost:3000`

### 3. Check System Health
- Look at the navbar - should show "Backend: Healthy"
- Green indicator means backend API is responding
- Red indicator means backend is not accessible

### 4. Test PDF Upload
- Go to "Upload PDF" page
- Select a PDF file
- Should upload successfully without JavaScript errors
- Should redirect to PDFs list after successful upload

### 5. Test Dashboard
- Dashboard should load without errors
- Statistics should display correctly
- No "Cannot read properties of undefined" errors

## 🔍 Common Issues & Solutions

### Backend Server Not Running
**Symptoms:** Health check shows red, API calls fail
**Solution:**
```bash
cd backend
node server.js
```
Make sure MySQL is running and database is configured.

### Port Conflicts
**Symptoms:** Backend won't start, port already in use
**Solution:**
- Kill process using port 8081: `netstat -ano | findstr :8081`
- Change port in `backend/server.js` if needed

### CORS Issues
**Symptoms:** API calls blocked by CORS policy
**Solution:** Backend already has CORS enabled. Check browser console for details.

### Database Connection Issues
**Symptoms:** Health check shows database unhealthy
**Solution:**
- Ensure MySQL is running
- Check `.env` file has correct database credentials
- Verify `epub_db` database exists

### File Upload Issues
**Symptoms:** PDF upload fails with validation errors
**Solution:**
- Check file size (max 50MB)
- Ensure file is actually a PDF
- Check backend upload directory permissions

## 🛠️ Development Debugging

### Browser Console Logs
Check browser developer tools console for:
- API error details
- Network request failures
- JavaScript stack traces

### Backend Logs
Check terminal where backend is running for:
- Server startup messages
- Database connection errors
- API request logs

### Network Tab
Use browser dev tools network tab to:
- Verify API calls are going to correct URLs
- Check response status codes
- Inspect request/response payloads

## 📋 Error Prevention Checklist

- ✅ Always handle API errors with `.catch()`
- ✅ Check array/object existence before accessing properties
- ✅ Use optional chaining (`?.`) for nested properties
- ✅ Validate user inputs before API calls
- ✅ Provide fallback values for undefined data
- ✅ Test with network failures (disable internet)
- ✅ Test with backend server stopped

## 🚨 Emergency Recovery

If app is completely broken:

1. **Hard Refresh:** `Ctrl+Shift+R` (or `Cmd+Shift+R` on Mac)
2. **Clear Browser Cache:** Browser dev tools → Application → Storage → Clear all
3. **Restart Dev Servers:**
   ```bash
   # Terminal 1 - Backend
   cd backend && node server.js

   # Terminal 2 - Frontend
   cd frontend && npm run dev
   ```
4. **Check Ports:** Ensure nothing else is using ports 3000 or 8081

## 📞 Support

If issues persist:
1. Check browser console for specific error messages
2. Verify backend server is running and accessible
3. Check database connectivity
4. Review server logs for detailed error information

The enhanced error handling should now prevent most JavaScript crashes and provide clear feedback about what went wrong.