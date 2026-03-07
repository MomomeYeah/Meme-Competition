export class AppError extends Error {
    public statusCode: number;

    constructor(message: string, statusCode: number = 500) {
        super(message);
        this.name = this.constructor.name;
        this.statusCode = statusCode;
    }
}

export class AuthError extends AppError {
    constructor(message: string = "Authentication failed") {
        super(message, 401);
    }
}

export class ValidationError extends AppError {
    constructor(message: string = "Validation failed") {
        super(message, 400);
    }
}

export class NotFoundError extends AppError {
    constructor(message: string = "Resource not found") {
        super(message, 404);
    }
}

export class ConflictError extends AppError {
    constructor(message: string = "Resource already exists") {
        super(message, 409);
    }
}

export class ServerError extends AppError {
    constructor(message: string = "Internal server error") {
        super(message, 500);
    }
}
