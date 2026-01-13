import axios from 'axios';

// Determine API URL based on environment and current location
const getApiBaseUrl = () => {
  // Environment variable override (highest priority)
  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl) {
    console.log('Using API URL from environment:', envUrl);
    return envUrl;
  }

  // Check if we're in development mode (Vite dev server)
  const isDev = import.meta.env.DEV;

  // Check if we're running on localhost (development)
  const isLocalhost = window.location.hostname === 'localhost' ||
                      window.location.hostname === '127.0.0.1';

  // Check if we're on the production domain (supports subdomains)
  const isProductionDomain = window.location.hostname === 'epub.bylinelms.com' ||
                            window.location.hostname.endsWith('.epub.bylinelms.com') ||
                            window.location.hostname === 'www.epub.bylinelms.com';

  console.log('Environment detection:', {
    isDev,
    isLocalhost,
    isProductionDomain,
    hostname: window.location.hostname,
    protocol: window.location.protocol,
    fullUrl: window.location.href
  });

  if (isDev || isLocalhost) {
    // In development, use local backend with /api prefix
    const localUrl = 'http://localhost:8082/api';
    console.log('Development mode detected, using local API:', localUrl);
    return localUrl;
  }

  if (isProductionDomain) {
    // Production - use the production API URL with HTTPS
    const prodUrl = 'https://epub.bylinelms.com/api';
    console.log('Production domain detected, using API:', prodUrl);
    return prodUrl;
  }

  // Fallback for other environments (staging, etc.)
  const fallbackUrl = `${window.location.protocol}//${window.location.host}/api`;
  console.log('Unknown environment, using fallback API:', fallbackUrl);
  return fallbackUrl;
};

const API_BASE_URL = getApiBaseUrl();
console.log('Final API Base URL:', API_BASE_URL);

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json'
  },
  // Add timeout and credentials for production
  timeout: 180000, // 3 minute timeout for AI operations
  withCredentials: false // Disable credentials for CORS
});

// Request interceptor for adding auth token
api.interceptors.request.use(
  (config) => {
    const fullUrl = config.baseURL + config.url;
    console.log('Making API request to:', fullUrl);
    console.log('Environment:', import.meta.env.DEV ? 'Development' : 'Production');

    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    // If data is FormData, remove Content-Type header to let axios set it with boundary
    if (config.data instanceof FormData) {
      delete config.headers['Content-Type'];
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for handling errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('API Error:', error);

    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    } else if (error.response?.status === 404) {
      console.error('API endpoint not found:', error.config?.url);
    } else if (error.response?.status >= 500) {
      console.error('Server error:', error.response?.status, error.response?.data);
    } else if (!error.response) {
      console.error('Network error - check if backend server is running');
    }

    return Promise.reject(error);
  }
);

export default api;
export { API_BASE_URL };






