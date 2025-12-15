# PDF to EPUB Converter - Backend API

Node.js/Express REST API backend for PDF to EPUB conversion system.

## Quick Start

```bash
# Install dependencies
npm install

# Setup environment
cp .env.example .env
# Edit .env with your database credentials

# Setup database
mysql -u root -p < database/schema.sql

# Start server
npm start
```

## API Documentation

See main README.md for complete API endpoint documentation.

## Project Structure

```
backend/
├── src/
│   ├── config/          # Database, file storage config
│   ├── models/          # Database query models
│   ├── services/        # Business logic
│   ├── routes/          # Express routes
│   ├── middlewares/     # Auth, error handling
│   └── utils/           # Helper functions
├── database/            # SQL schema files
└── server.js           # Entry point
```

## Environment Variables

See `.env.example` for all required environment variables.

## Database Models

- **UserModel** - User management
- **PdfDocumentModel** - PDF file metadata
- **ConversionJobModel** - Conversion job tracking
- **AudioSyncModel** - Audio synchronization
- **AiConfigurationModel** - AI service configuration

## Services

- **UserService** - User CRUD operations
- **PdfService** - PDF upload, download, management
- **ConversionService** - EPUB conversion orchestration
- **AudioSyncService** - Audio sync management
- **AiConfigService** - AI configuration management

## Error Handling

Global error handler in `src/middlewares/errorHandler.js` catches and formats all errors consistently.

## Authentication

JWT-based authentication middleware in `src/middlewares/auth.js`. Currently optional - can be added to protected routes.




