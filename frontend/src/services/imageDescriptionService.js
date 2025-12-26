import api from './api';

export const imageDescriptionService = {
  /**
   * Get description of an image using AI
   * @param {File|Blob|string} image - Image file, blob, or URL
   * @returns {Promise<string>} Image description
   */
  describeImage: async (image) => {
    try {
      let formData = new FormData();
      
      // Handle different image input types
      if (typeof image === 'string') {
        // If it's a URL, fetch it first
        // Check if it's an absolute URL (starts with http)
        if (image.startsWith('http://') || image.startsWith('https://')) {
          // For API URLs, use axios with proper auth headers
          const token = localStorage.getItem('token');
          const headers = {
            'Accept': 'image/*',
          };
          if (token) {
            headers['Authorization'] = `Bearer ${token}`;
          }
          
          try {
            const fetchResponse = await fetch(image, { headers });
            if (!fetchResponse.ok) {
              throw new Error(`Failed to fetch image: ${fetchResponse.status} ${fetchResponse.statusText}`);
            }
            const blob = await fetchResponse.blob();
            
            // Determine file extension from URL or blob type
            const urlPath = new URL(image).pathname;
            const extension = urlPath.match(/\.(jpg|jpeg|png|gif|webp)$/i)?.[1] || 'png';
            const fileName = `image.${extension}`;
            
            formData.append('image', blob, fileName);
          } catch (fetchError) {
            console.error('Error fetching image from URL:', fetchError);
            throw new Error(`Failed to fetch image from URL: ${fetchError.message}`);
          }
        } else {
          // Relative URL - use api service
          try {
            const response = await api.get(image, {
              responseType: 'blob',
            });
            const blob = response.data;
            const fileName = image.split('/').pop() || 'image.png';
            formData.append('image', blob, fileName);
          } catch (apiError) {
            console.error('Error fetching image via API:', apiError);
            throw new Error(`Failed to fetch image: ${apiError.message}`);
          }
        }
      } else if (image instanceof File || image instanceof Blob) {
        // Determine filename
        const fileName = image instanceof File 
          ? image.name 
          : (image.name || 'image.png');
        formData.append('image', image, fileName);
      } else {
        throw new Error('Invalid image format. Expected File, Blob, or URL string.');
      }

      // Don't set Content-Type header - let axios set it automatically with boundary
      // Axios will automatically detect FormData and set the correct Content-Type with boundary
      const response = await api.post('/ai/describe-image', formData);

      return response.data.data.description;
    } catch (error) {
      console.error('Error describing image:', error);
      console.error('Error response data:', error.response?.data);
      console.error('Error response status:', error.response?.status);
      console.error('Error response headers:', error.response?.headers);
      
      // Try to extract more detailed error message
      let errorMessage = 'Failed to describe image';
      if (error.response?.data) {
        if (error.response.data.message) {
          errorMessage = error.response.data.message;
        } else if (error.response.data.error) {
          errorMessage = error.response.data.error;
        } else if (typeof error.response.data === 'string') {
          errorMessage = error.response.data;
        } else {
          errorMessage = JSON.stringify(error.response.data);
        }
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      throw new Error(errorMessage);
    }
  }
};

