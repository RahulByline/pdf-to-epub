# How to Start the Backend Server

## Quick Start

1. **Open a new terminal/PowerShell window**

2. **Navigate to the backend directory:**
   ```powershell
   cd C:\Users\ADMIN\Desktop\pdf-to-epub-converter\backend
   ```

3. **Start the server:**
   ```powershell
   npm start
   ```
   
   OR for development with auto-reload:
   ```powershell
   npm run dev
   ```

4. **You should see:**
   ```
   Server is running on port 8081
   Environment: development
   Connected to MySQL database
   ```

## Troubleshooting

### If you see "Database connection error":
- Make sure MySQL is running
- Check if the database `epub_db` exists
- Create a `.env` file in the `backend` folder with your database credentials:
  ```
  DB_HOST=localhost
  DB_USER=root
  DB_PASSWORD=your_password
  DB_NAME=epub_db
  PORT=8081
  ```

### If you see "Port 8081 is already in use":
- Another process is using port 8081
- Run: `npm run stop-port` to kill the process
- Or change the PORT in `.env` file

### If the server starts but you still get connection errors:
- Wait a few seconds for the server to fully initialize
- Check the terminal output for any error messages
- Verify the server is listening: Open `http://localhost:8081/health` in your browser

## Verify Server is Running

Open your browser and go to: `http://localhost:8081/health`

You should see:
```json
{"status":"OK","timestamp":"2024-..."}
```

