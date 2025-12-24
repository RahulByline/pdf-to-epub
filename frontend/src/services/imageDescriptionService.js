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
        const response = await fetch(image);
        const blob = await response.blob();
        formData.append('image', blob, 'image.png');
      } else if (image instanceof File || image instanceof Blob) {
        formData.append('image', image, image.name || 'image.png');
      } else {
        throw new Error('Invalid image format. Expected File, Blob, or URL string.');
      }

      const response = await api.post('/ai/describe-image', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });

      return response.data.data.description;
    } catch (error) {
      console.error('Error describing image:', error);
      throw new Error(error.response?.data?.message || error.message || 'Failed to describe image');
    }
  }
};

