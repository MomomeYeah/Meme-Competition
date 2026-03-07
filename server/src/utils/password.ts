/**
 * Simple password validation for MVP.
 * In production, use bcrypt for hashing passwords.
 */

export function hashPassword(password: string): string {
    // For MVP, just use a simple hash. In production, use bcrypt.
    // This is NOT secure for production!
    return Buffer.from(password).toString("base64");
}

export function verifyPassword(password: string, hash: string): boolean {
    // Simple comparison for MVP
    return hashPassword(password) === hash;
}

export function validatePassword(password: string): { valid: boolean; error?: string } {
    if (!password || password.length < 4) {
        return { valid: false, error: "Password must be at least 4 characters" };
    }
    return { valid: true };
}
