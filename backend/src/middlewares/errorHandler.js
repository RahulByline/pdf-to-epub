export const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);

  // Default error
  let status = err.statusCode || 500;
  let message = err.message || 'Internal server error';

  // Validation errors
  if (err.name === 'ValidationError') {
    status = 400;
    message = err.message;
  }

  // Database errors
  if (err.code === 'ER_DUP_ENTRY') {
    status = 409;
    message = 'Duplicate entry';
  }

  // Not found errors
  if (err.name === 'NotFoundError' || err.message?.includes('not found')) {
    status = 404;
    message = err.message || 'Resource not found';
  }

  res.status(status).json({
    status,
    message,
    timestamp: new Date().toISOString(),
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};



