// Quick test to see if server can start
import dotenv from 'dotenv';
dotenv.config();

console.log('Testing server startup...');
console.log('PORT:', process.env.PORT || 8081);
console.log('DB_HOST:', process.env.DB_HOST || 'localhost');
console.log('DB_NAME:', process.env.DB_NAME || 'epub_db');

// Try to import and start server
try {
  const server = await import('./server.js');
  console.log('Server module loaded successfully');
} catch (error) {
  console.error('Error loading server:', error.message);
  console.error(error.stack);
  process.exit(1);
}







