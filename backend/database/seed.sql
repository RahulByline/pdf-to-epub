-- Seed data (optional)
USE epub_db;

-- Insert sample user (password is 'password123' hashed with bcrypt)
-- In production, use proper password hashing
INSERT INTO users (name, email, password, phone_number) VALUES
('Admin User', 'admin@example.com', '$2a$10$rOzJxVJbNdOYkq5jQ3C1M.9QYqVq5q5q5q5q5q5q5q5q5q5q5q5q', '1234567890')
ON DUPLICATE KEY UPDATE email=email;

-- Insert sample AI configuration (with empty API key - user should configure)
INSERT INTO ai_configurations (api_key, model_name, is_active, description) VALUES
('', 'gemini-pro', FALSE, 'Default configuration')
ON DUPLICATE KEY UPDATE id=id;




