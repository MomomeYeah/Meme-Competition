import { type User, type AuthRequest } from "../models/types";
import { readJsonFile, writeJsonFile, findByProperty } from "../utils/json-db";
import { hashPassword, verifyPassword, validatePassword } from "../utils/password";
import { generateToken } from "../utils/jwt";
import { AuthError, ValidationError, ConflictError } from "../utils/errors";
import { generateId } from "../utils/generate-id";

const USERS_FILE = "users.json";

export class UserService {
    static register(req: AuthRequest): { userId: string; token: string; user: User } {
        const { username, email, password } = req;

        // Validate input
        if (!username || !email || !password) {
            throw new ValidationError("Username, email, and password are required");
        }

        const passwordValidation = validatePassword(password);
        if (!passwordValidation.valid) {
            throw new ValidationError(passwordValidation.error || "Invalid password");
        }

        const users = readJsonFile<User>(USERS_FILE);

        // Check if user already exists
        if (findByProperty(users, "username", username)) {
            throw new ConflictError("Username already exists");
        }

        if (findByProperty(users, "email", email)) {
            throw new ConflictError("Email already exists");
        }

        // Create new user
        const userId = generateId();
        const user: User = {
            id: userId,
            username,
            email,
            passwordHash: hashPassword(password),
            createdAt: new Date().toISOString(),
        };

        users.push(user);
        writeJsonFile(USERS_FILE, users);

        const token = generateToken(userId, username);

        return {
            userId,
            token,
            user: { ...user, passwordHash: undefined } as any,
        };
    }

    static login(
        username: string,
        password: string
    ): { userId: string; token: string; user: User } {
        const users = readJsonFile<User>(USERS_FILE);
        const user = findByProperty(users, "username", username);

        if (!user || !verifyPassword(password, user.passwordHash)) {
            throw new AuthError("Invalid username or password");
        }

        const token = generateToken(user.id, user.username);

        return {
            userId: user.id,
            token,
            user: { ...user, passwordHash: undefined } as any,
        };
    }

    static getUserById(userId: string): User {
        const users = readJsonFile<User>(USERS_FILE);
        const user = users.find((u) => u.id === userId);

        if (!user) {
            throw new AuthError("User not found");
        }

        const userCopy = { ...user };
        delete (userCopy as any).passwordHash;
        return userCopy;
    }
}
