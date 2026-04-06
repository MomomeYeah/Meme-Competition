import { hash, verify } from '@node-rs/argon2';

export async function hashPassword(password: string): Promise<string> {
    return hash(password);
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
    return verify(storedHash, password);
}

export function validatePassword(password: string): { valid: boolean; error?: string } {
    if (!password || password.length < 4) {
        return { valid: false, error: 'Password must be at least 4 characters' };
    }
    return { valid: true };
}
