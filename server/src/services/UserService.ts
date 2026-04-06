import { type User, type PublicUser, type AuthRequest } from '../models/types';
import { usersCollection } from '../db/collections';
import { hashPassword, verifyPassword, validatePassword } from '../utils/password';
import { generateToken } from '../utils/jwt';
import { AuthError, ValidationError, ConflictError } from '../utils/errors';
import { generateId } from '../utils/generate-id';

export class UserService {
    static async register(req: AuthRequest): Promise<{ userId: string; token: string; user: PublicUser }> {
        const { username, email, password } = req;

        if (!username || !email || !password) {
            throw new ValidationError('Username, email, and password are required');
        }

        const passwordValidation = validatePassword(password);
        if (!passwordValidation.valid) {
            throw new ValidationError(passwordValidation.error || 'Invalid password');
        }

        const users = usersCollection();

        if (await users.findOne({ username })) {
            throw new ConflictError('Username already exists');
        }

        if (await users.findOne({ email })) {
            throw new ConflictError('Email already exists');
        }

        const userId = generateId();
        const doc = {
            _id: userId,
            id: userId,
            username,
            email,
            passwordHash: await hashPassword(password),
            createdAt: new Date().toISOString(),
        };

        await users.insertOne(doc);

        const token = generateToken(userId, username);
        const { passwordHash: _, ...user } = doc;
        return { userId, token, user };
    }

    static async login(username: string, password: string): Promise<{ userId: string; token: string; user: PublicUser }> {
        const doc = await usersCollection().findOne({ username });

        if (!doc || !(await verifyPassword(password, doc.passwordHash))) {
            throw new AuthError('Invalid username or password');
        }

        const token = generateToken(doc.id, doc.username);
        const { passwordHash: _, ...user } = doc;
        return { userId: doc.id, token, user };
    }

    static async getUserById(userId: string): Promise<PublicUser> {
        const doc = await usersCollection().findOne({ _id: userId });

        if (!doc) {
            throw new AuthError('User not found');
        }

        const { passwordHash: _, ...user } = doc;
        return user;
    }
}
