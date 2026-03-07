/**
 * Generate a random ID using Node.js/Bun's crypto module
 */
export function generateId(): string {
    return crypto.randomUUID();
}
