# PDF to EPUB Converter - Frontend

React frontend application built with Vite.

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Project Structure

```
frontend/
├── src/
│   ├── components/      # Reusable components
│   │   └── layout/     # Layout components
│   ├── pages/          # Page components
│   ├── services/       # API service calls
│   ├── App.jsx         # Main app component
│   └── main.jsx        # Entry point
├── public/             # Static assets
└── index.html          # HTML template
```

## Pages

- **Dashboard** - Overview and statistics
- **Login** - User authentication
- **PdfList** - List and manage PDFs
- **PdfUpload** - Upload PDF files
- **Conversions** - Monitor conversions
- **AudioSync** - Audio synchronization (placeholder)
- **AiConfig** - AI configuration

## API Services

All API calls are centralized in `src/services/`:
- `api.js` - Axios instance with interceptors
- `userService.js` - User operations
- `pdfService.js` - PDF operations
- `conversionService.js` - Conversion operations
- `aiConfigService.js` - AI configuration
- `audioSyncService.js` - Audio sync operations

## Environment Variables

Create `.env` file:
```env
VITE_API_URL=http://localhost:8081/api
```

## Styling

Basic CSS in `src/index.css` with utility classes. Can be replaced with Tailwind CSS or styled-components.

## Routing

React Router handles client-side routing. Protected routes can be added with authentication checks.

## State Management

Currently using React hooks (useState, useEffect). For complex state, consider Redux or Context API.




