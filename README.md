# Spring Boot Demo Application

A complete Spring Boot REST API application with MySQL database integration.

## Project Structure

```
demo/
├── src/
│   ├── main/
│   │   ├── java/com/example/demo/
│   │   │   ├── config/          # Configuration classes
│   │   │   ├── controller/      # REST controllers
│   │   │   ├── dto/             # Data Transfer Objects
│   │   │   ├── exception/       # Exception handlers
│   │   │   ├── model/           # Entity classes
│   │   │   ├── repository/      # JPA repositories
│   │   │   ├── service/         # Business logic
│   │   │   └── DemoApplication.java
│   │   └── resources/
│   │       ├── application.properties
│   │       ├── application-dev.properties
│   │       └── application-prod.properties
│   └── test/
└── pom.xml
```

## Technologies Used

- Java 17
- Spring Boot 3.2.0
- Spring Data JPA
- MySQL Database
- Lombok
- Maven

## Prerequisites

- JDK 17 or higher
- Maven 3.6+
- MySQL 8.0+

## Database Setup

1. Install MySQL
2. Create database (auto-created if using default config):
```sql
CREATE DATABASE demo_db;
```

3. Update credentials in `application.properties`:
```properties
spring.datasource.username=root
spring.datasource.password=your_password
```

## Running the Application

```bash
mvn spring-boot:run
```

The application will start on `http://localhost:8080`

## API Endpoints

### User Management

- `GET /api/users` - Get all users
- `GET /api/users/{id}` - Get user by ID
- `POST /api/users` - Create new user
- `PUT /api/users/{id}` - Update user
- `DELETE /api/users/{id}` - Delete user

### Sample Request (Create User)

```json
POST /api/users
{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "password123",
  "phoneNumber": "1234567890"
}
```

## Build

```bash
mvn clean install
```

## Run Tests

```bash
mvn test
```
