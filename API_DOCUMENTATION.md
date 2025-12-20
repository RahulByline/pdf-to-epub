# API Documentation

Complete API reference for PDF to EPUB Converter Backend.

Base URL: `http://localhost:8081/api`

## Authentication

Most endpoints don't require authentication in the current implementation. JWT authentication middleware is available for future use.

### Headers
```
Authorization: Bearer <token>
Content-Type: application/json
```

## User Endpoints

### Get All Users
```
GET /users
```
Response:
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "John Doe",
      "email": "john@example.com",
      "phoneNumber": "1234567890",
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

### Get User by ID
```
GET /users/:id
```

### Create User
```
POST /users
Body:
{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "password123",
  "phoneNumber": "1234567890"
}
```

### Update User
```
PUT /users/:id
Body: { same as create }
```

### Delete User
```
DELETE /users/:id
```

## PDF Endpoints

### Get All PDFs
```
GET /pdfs
```

### Get PDF by ID
```
GET /pdfs/:id
```

### Get PDFs Grouped by ZIP
```
GET /pdfs/grouped
```

### Upload PDF
```
POST /pdfs/upload
Content-Type: multipart/form-data
Body:
  - file: PDF file (required)
  - audioFile: Audio file (optional)
```

### Bulk Upload PDFs
```
POST /pdfs/upload/bulk
Content-Type: multipart/form-data
Body:
  - files: Array of PDF files
```

### Download PDF
```
GET /pdfs/:id/download
Response: PDF file binary
```

### Download Audio
```
GET /pdfs/:id/audio
Response: Audio file binary (supports Range header for streaming)
```

### Delete PDF
```
DELETE /pdfs/:id
```

## Conversion Endpoints

### Start Conversion
```
POST /conversions/start/:pdfDocumentId
Response:
{
  "success": true,
  "data": {
    "id": 1,
    "pdfDocumentId": 1,
    "status": "PENDING",
    "currentStep": "STEP_0_CLASSIFICATION",
    "progressPercentage": 0,
    ...
  }
}
```

### Start Bulk Conversion
```
POST /conversions/start/bulk
Body:
{
  "pdfIds": [1, 2, 3]
}
```

### Get Conversion Job
```
GET /conversions/:jobId
```

### Get Conversions by PDF
```
GET /conversions/pdf/:pdfDocumentId
```

### Get Conversions by Status
```
GET /conversions/status/:status
Status values: PENDING, IN_PROGRESS, COMPLETED, FAILED, REVIEW_REQUIRED, CANCELLED
```

### Get Review Required
```
GET /conversions/review-required
```

### Mark as Reviewed
```
PUT /conversions/:jobId/review?reviewedBy=username
```

### Stop Conversion
```
POST /conversions/:jobId/stop
```

### Retry Conversion
```
POST /conversions/:jobId/retry
```

### Download EPUB
```
GET /conversions/:jobId/download
Response: EPUB file binary
```

### Delete Conversion Job
```
DELETE /conversions/:jobId
```

## AI Configuration Endpoints

### Get Current Configuration
```
GET /ai/config/current
Response:
{
  "success": true,
  "data": {
    "id": 1,
    "apiKey": "AIza****Ic",
    "modelName": "gemini-pro",
    "isActive": true,
    "description": "Production config"
  }
}
```

### Save Configuration
```
POST /ai/config
Body:
{
  "apiKey": "your-api-key",
  "modelName": "gemini-pro",
  "isActive": true,
  "description": "Optional description"
}
```

### Get AI Status
```
GET /ai/status
```

### Get Available Models
```
GET /ai/models
```

### Test Connection
```
POST /ai/test
Body:
{
  "apiKey": "your-api-key",
  "modelName": "gemini-pro"
}
```

## Audio Sync Endpoints

### Get Audio Syncs by PDF
```
GET /audio-sync/pdf/:pdfId
```

### Get Audio Syncs by Job
```
GET /audio-sync/job/:jobId
```

### Get Audio Syncs by PDF and Job
```
GET /audio-sync/pdf/:pdfId/job/:jobId
```

### Create Audio Sync
```
POST /audio-sync
Body:
{
  "pdfDocumentId": 1,
  "conversionJobId": 1,
  "pageNumber": 1,
  "blockId": "block-1",
  "startTime": 0.0,
  "endTime": 5.5,
  "audioFilePath": "/path/to/audio.mp3",
  "notes": "Optional notes",
  "customText": "Optional custom text",
  "isCustomSegment": false
}
```

### Update Audio Sync
```
PUT /audio-sync/:id
Body: { same as create }
```

### Delete Audio Sync
```
DELETE /audio-sync/:id
```

### Delete Audio Syncs by Job
```
DELETE /audio-sync/job/:jobId
```

## Error Responses

All errors follow this format:
```json
{
  "success": false,
  "error": "Error message",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

Status Codes:
- 200: Success
- 201: Created
- 204: No Content
- 400: Bad Request
- 401: Unauthorized
- 404: Not Found
- 500: Internal Server Error





