import { UserModel } from '../models/User.js';

export class UserService {
  static async getAllUsers() {
    const users = await UserModel.findAll();
    return users.map(user => this.convertToDTO(user));
  }

  static async getUserById(id) {
    const user = await UserModel.findById(id);
    if (!user) {
      throw new Error('User not found with id: ' + id);
    }
    return this.convertToDTO(user);
  }

  static async createUser(userDTO) {
    if (await UserModel.existsByEmail(userDTO.email)) {
      throw new Error('Email already exists');
    }
    const user = await UserModel.create(userDTO);
    return this.convertToDTO(user);
  }

  static async updateUser(id, userDTO) {
    const existingUser = await UserModel.findById(id);
    if (!existingUser) {
      throw new Error('User not found with id: ' + id);
    }

    // Check if email is being changed and if it already exists
    if (userDTO.email && userDTO.email !== existingUser.email) {
      if (await UserModel.existsByEmail(userDTO.email)) {
        throw new Error('Email already exists');
      }
    }

    const updatedUser = await UserModel.update(id, userDTO);
    return this.convertToDTO(updatedUser);
  }

  static async deleteUser(id) {
    const user = await UserModel.findById(id);
    if (!user) {
      throw new Error('User not found with id: ' + id);
    }
    await UserModel.delete(id);
  }

  static convertToDTO(user) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phoneNumber: user.phone_number,
      createdAt: user.created_at
    };
  }
}





