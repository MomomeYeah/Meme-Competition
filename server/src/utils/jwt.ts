import jwt from "jsonwebtoken";
import { type JwtPayload } from "../models/types";
import { AuthError } from "./errors";

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key-change-in-production";

export function generateToken(userId: string, username: string): string {
    const payload: JwtPayload = { userId, username };
    return jwt.sign(payload, JWT_SECRET, { expiresIn: "24h" });
}

export function verifyToken(token: string): JwtPayload {
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
        return decoded;
    } catch (error) {
        throw new AuthError("Invalid or expired token");
    }
}
