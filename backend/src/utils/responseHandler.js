export const successResponse = (res, data, statusCode = 200) => {
  return res.status(statusCode).json({
    success: true,
    data,
    timestamp: new Date().toISOString()
  });
};

export const errorResponse = (res, message, statusCode = 500) => {
  return res.status(statusCode).json({
    success: false,
    error: message,
    timestamp: new Date().toISOString()
  });
};

export const notFoundResponse = (res, message = 'Resource not found') => {
  return res.status(404).json({
    success: false,
    error: message,
    timestamp: new Date().toISOString()
  });
};

export const badRequestResponse = (res, message = 'Bad request') => {
  return res.status(400).json({
    success: false,
    error: message,
    timestamp: new Date().toISOString()
  });
};





