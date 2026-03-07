import { type Request, type Response } from "express";
import { UserService } from "../services/UserService";
import { type ApiResponse } from "../models/types";

export class AuthController {
    private static setJWTCookie(res: Response, token: string): void {
        res.cookie("jwt", token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            maxAge: 24 * 60 * 60 * 1000,
        });
    }

    static async register(req: Request, res: Response): Promise<void> {
        try {
            const result = UserService.register(req.body);
            AuthController.setJWTCookie(res, result.token);

            const response: ApiResponse = {
                success: true,
                data: {
                    user: result.user,
                    userId: result.userId,
                },
            };

            res.status(201).json(response);
        } catch (error) {
            AuthController.handleError(error, res);
        }
    }

    static async login(req: Request, res: Response): Promise<void> {
        try {
            const { username, password } = req.body;

            if (!username || !password) {
                res.status(400).json({
                    success: false,
                    error: "Username and password are required",
                });
                return;
            }

            const result = UserService.login(username, password);
            AuthController.setJWTCookie(res, result.token);

            const response: ApiResponse = {
                success: true,
                data: {
                    user: result.user,
                    userId: result.userId,
                },
            };

            res.status(200).json(response);
        } catch (error) {
            AuthController.handleError(error, res);
        }
    }

    static async logout(req: Request, res: Response): Promise<void> {
        res.clearCookie("jwt");
        res.json({ success: true, data: { message: "Logged out successfully" } });
    }

    static async getCurrentUser(req: Request, res: Response): Promise<void> {
        try {
            if (!req.user) {
                res.status(401).json({ success: false, error: "Not authenticated" });
                return;
            }

            const user = UserService.getUserById(req.user.userId);
            res.json({ success: true, data: { user } });
        } catch (error) {
            AuthController.handleError(error, res);
        }
    }

    private static handleError(error: any, res: Response): void {
        console.error("AuthController error:", error);
        if (error.statusCode) {
            res.status(error.statusCode).json({ success: false, error: error.message });
        } else {
            res.status(500).json({ success: false, error: "Internal server error" });
        }
    }
}
