import express from 'express';
import { UserService } from '../services/userService.js';
import { validateUserDTO } from '../utils/validation.js';
import { successResponse, errorResponse, notFoundResponse, badRequestResponse } from '../utils/responseHandler.js';

const router = express.Router();

// GET /api/users - Get all users
router.get('/', async (req, res) => {
  try {
    const users = await UserService.getAllUsers();
    return successResponse(res, users);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/users/:id - Get user by ID
router.get('/:id', async (req, res) => {
  try {
    const user = await UserService.getUserById(parseInt(req.params.id));
    return successResponse(res, user);
  } catch (error) {
    if (error.message.includes('not found')) {
      return notFoundResponse(res, error.message);
    }
    return errorResponse(res, error.message, 500);
  }
});

// POST /api/users - Create new user
router.post('/', async (req, res) => {
  try {
    const validation = validateUserDTO(req.body);
    if (!validation.isValid) {
      return badRequestResponse(res, validation.errors.join(', '));
    }

    const user = await UserService.createUser(req.body);
    return successResponse(res, user, 201);
  } catch (error) {
    if (error.message.includes('already exists')) {
      return badRequestResponse(res, error.message);
    }
    return errorResponse(res, error.message, 500);
  }
});

// PUT /api/users/:id - Update user
router.put('/:id', async (req, res) => {
  try {
    const validation = validateUserDTO(req.body);
    if (!validation.isValid) {
      return badRequestResponse(res, validation.errors.join(', '));
    }

    const user = await UserService.updateUser(parseInt(req.params.id), req.body);
    return successResponse(res, user);
  } catch (error) {
    if (error.message.includes('not found')) {
      return notFoundResponse(res, error.message);
    }
    if (error.message.includes('already exists')) {
      return badRequestResponse(res, error.message);
    }
    return errorResponse(res, error.message, 500);
  }
});

// DELETE /api/users/:id - Delete user
router.delete('/:id', async (req, res) => {
  try {
    await UserService.deleteUser(parseInt(req.params.id));
    return res.status(204).send();
  } catch (error) {
    if (error.message.includes('not found')) {
      return notFoundResponse(res, error.message);
    }
    return errorResponse(res, error.message, 500);
  }
});

export default router;

