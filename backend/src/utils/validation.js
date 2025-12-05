export const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

export const validateUserDTO = (userDTO) => {
  const errors = [];

  if (!userDTO.name || userDTO.name.trim().length < 2 || userDTO.name.trim().length > 100) {
    errors.push('Name must be between 2 and 100 characters');
  }

  if (!userDTO.email || !validateEmail(userDTO.email)) {
    errors.push('Valid email is required');
  }

  if (!userDTO.password || userDTO.password.length < 6) {
    errors.push('Password must be at least 6 characters');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

