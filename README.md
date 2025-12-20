# PDF to EPUB Converter - MERN Stack Application 

A modern full-stack PDF to EPUB conversion system built with Node.js, Express, React, and MySQL.

## Project Structure

```
pdf-to-epub-converter/
├── backend/                 # Node.js/Express Backend
│   ├── src/
│   │   ├── config/         # Configuration files
│   │   ├── controllers/    # Route handlers
│   │   ├── models/         # Database models
│   │   ├── routes/         # API routes
│   │   ├── services/       # Business logic
│   │   ├── middlewares/    # Express middlewares
│   │   └── utils/          # Utility functions
│   ├── database/           # SQL schema and migrations
│   ├── server.js           # Entry point
│   └── package.json
│
└── frontend/               # React Frontend (Vite)
    ├── src/
    │   ├── components/     # React components
    │   ├── pages/          # Page components
    │   ├── services/       # API service calls
    │   └── App.jsx         # Main app component
    ├── package.json
    └── vite.config.js
```

## Technologies Used

### Backend
- **Node.js** - Runtime environment
- **Express.js** - Web framework
- **MySQL** - Database (using mysql2)
- **JWT** - Authentication
- **Multer** - File upload handling
- **bcryptjs** - Password hashing

### Frontend
- **React 18** - UI library
- **React Router** - Routing
- **Axios** - HTTP client
- **Vite** - Build tool

## Prerequisites

- Node.js 18+ and npm
- MySQL 8.0+
- Git

## Installation & Setup

### 1. Database Setup

```bash
# Login to MySQL
mysql -u root -p

# Create database and import schema
mysql -u root -p < backend/database/schema.sql

# (Optional) Load seed data
mysql -u root -p epub_db < backend/database/seed.sql
```

### 2. Backend Setup

```bash
cd backend

# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit .env file with your database credentials
# DB_HOST=localhost
# DB_USER=root
# DB_PASSWORD=your_password
# DB_NAME=epub_db

# Start backend server
npm start

# Or for development with auto-reload
npm run dev
```

The backend will run on `http://localhost:8081`

### 3. Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Start development server
npm run dev
```

The frontend will run on `http://localhost:3000`

### 4. Production Build

```bash
# Build frontend
cd frontend
npm run build

# The built files will be in frontend/dist/
# Serve them with a static file server or integrate with Express
```

## API Endpoints

### User Management
- `GET /api/users` - Get all users
- `GET /api/users/:id` - Get user by ID
- `POST /api/users` - Create new user
- `PUT /api/users/:id` - Update user
- `DELETE /api/users/:id` - Delete user

### PDF Management
- `GET /api/pdfs` - Get all PDFs
- `GET /api/pdfs/:id` - Get PDF by ID
- `GET /api/pdfs/grouped` - Get PDFs grouped by ZIP
- `POST /api/pdfs/upload` - Upload PDF (with optional audio)
- `POST /api/pdfs/upload/bulk` - Bulk upload PDFs
- `GET /api/pdfs/:id/download` - Download PDF
- `GET /api/pdfs/:id/audio` - Download audio file
- `DELETE /api/pdfs/:id` - Delete PDF

### Conversion Management
- `POST /api/conversions/start/:pdfDocumentId` - Start conversion
- `POST /api/conversions/start/bulk` - Start bulk conversion
- `GET /api/conversions/:jobId` - Get conversion job
- `GET /api/conversions/pdf/:pdfDocumentId` - Get conversions by PDF
- `GET /api/conversions/status/:status` - Get conversions by status
- `GET /api/conversions/review-required` - Get jobs requiring review
- `PUT /api/conversions/:jobId/review` - Mark as reviewed
- `POST /api/conversions/:jobId/stop` - Stop conversion
- `POST /api/conversions/:jobId/retry` - Retry conversion
- `GET /api/conversions/:jobId/download` - Download EPUB
- `DELETE /api/conversions/:jobId` - Delete conversion job

### AI Configuration
- `GET /api/ai/config/current` - Get current AI configuration
- `POST /api/ai/config` - Save AI configuration
- `GET /api/ai/status` - Get AI status
- `GET /api/ai/models` - Get available models
- `POST /api/ai/test` - Test AI connection

### Audio Synchronization
- `GET /api/audio-sync/pdf/:pdfId` - Get audio syncs by PDF
- `GET /api/audio-sync/job/:jobId` - Get audio syncs by job
- `GET /api/audio-sync/pdf/:pdfId/job/:jobId` - Get audio syncs by PDF and job
- `POST /api/audio-sync` - Create audio sync
- `PUT /api/audio-sync/:id` - Update audio sync
- `DELETE /api/audio-sync/:id` - Delete audio sync
- `DELETE /api/audio-sync/job/:jobId` - Delete audio syncs by job

## Environment Variables

### Backend (.env)

```env
# Server
PORT=8081
NODE_ENV=development

# Database
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=epub_db

# JWT
JWT_SECRET=your-secret-key-change-this-in-production
JWT_EXPIRES_IN=24h

# File Upload
UPLOAD_DIR=uploads
MAX_FILE_SIZE=52428800
EPUB_OUTPUT_DIR=epub_output
HTML_INTERMEDIATE_DIR=html_intermediate

# AI Configuration
GEMINI_API_KEY=your-api-key
GEMINI_API_ENABLED=true
GEMINI_API_MODEL=gemini-2.5-flash

# Google Cloud Text-to-Speech (Optional - for TTS audio generation)
# If not set, you can still upload human-narrated audio files
# GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json
# TTS_ENABLED=true  # Set to false to disable TTS even if credentials exist
```

### Frontend (.env)

```env
VITE_API_URL=http://localhost:8081/api
```

## Database Schema

The application uses the following main tables:

- **users** - User accounts
- **pdf_documents** - PDF files metadata
- **pdf_languages** - PDF languages (many-to-many)
- **conversion_jobs** - EPUB conversion jobs
- **ai_configurations** - AI service configurations
- **audio_syncs** - Audio synchronization data

See `backend/database/schema.sql` for complete schema.

## Features

1. **PDF Upload** - Upload single or multiple PDFs, with optional audio files
2. **ZIP Upload** - Upload ZIP files containing multiple PDFs
3. **PDF Analysis** - Analyze PDFs for document type, quality, languages
4. **EPUB Conversion** - Convert PDFs to EPUB format with multiple conversion steps
5. **Conversion Management** - Monitor, stop, retry, and download conversions
6. **Audio Synchronization** - Sync audio files with PDF content
7. **AI Integration** - Configure and use AI services for text processing
8. **User Management** - CRUD operations for users

## Development Notes

### Backend Structure
- Models handle database queries
- Services contain business logic
- Routes define API endpoints
- Middlewares handle auth, validation, error handling

### Frontend Structure
- Pages are main route components
- Services handle API communication
- Components are reusable UI elements
- Layout provides navigation structure

## Important Notes

1. **PDF Processing**: The current implementation includes placeholders for complex PDF processing features (OCR, layout analysis, EPUB generation). These would require additional Node.js libraries:
   - `pdf-parse` or `pdf-lib` for PDF parsing
   - `tesseract.js` for OCR
   - `epub-gen` or similar for EPUB generation
   - Image processing libraries

2. **File Storage**: Files are stored in the `uploads/` directory. Make sure this directory has proper write permissions.

3. **Authentication**: JWT authentication is implemented but login endpoint needs to be connected to actual user authentication.

4. **Async Processing**: For production, consider using a job queue (Bull, Agenda) instead of simple async functions.

## Deployment on A2 Hosting

### Backend Deployment

1. Upload backend files to your A2 Hosting account
2. Install Node.js modules: `npm install --production`
3. Set up environment variables in `.env`
4. Use PM2 or similar to run the Node.js server:
   ```bash
   pm2 start server.js --name pdf-epub-api
   ```

### Frontend Deployment

1. Build the frontend: `npm run build`
2. Upload the `dist/` folder to your web root
3. Configure your web server to serve the React app

### Database Setup

1. Create MySQL database via cPanel or phpMyAdmin
2. Import schema: `mysql -u username -p database_name < backend/database/schema.sql`

### Nginx Configuration (if needed)

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # Frontend
    location / {
        root /path/to/frontend/dist;
        try_files $uri $uri/ /index.html;
    }

    # Backend API
    location /api {
        proxy_pass http://localhost:8081;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## Troubleshooting

1. **Database Connection Errors**: Check MySQL credentials in `.env`
2. **File Upload Errors**: Verify directory permissions for `uploads/`
3. **CORS Errors**: Ensure CORS is configured in backend `server.js`
4. **Port Conflicts**: Change ports in `.env` and `vite.config.js`

## License

[Your License Here]

## Support

For issues or questions, please contact [your support contact].
