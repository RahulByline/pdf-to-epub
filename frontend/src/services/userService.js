import api from './api';

export const userService = {
  getAllUsers: () => api.get('/users').then(res => res.data.data),
  
  getUserById: (id) => api.get(`/users/${id}`).then(res => res.data.data),
  
  createUser: (userData) => api.post('/users', userData).then(res => res.data.data),
  
  updateUser: (id, userData) => api.put(`/users/${id}`, userData).then(res => res.data.data),
  
  deleteUser: (id) => api.delete(`/users/${id}`)
};










