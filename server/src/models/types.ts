export interface User {
    id: string;
    username: string;
    email: string;
    passwordHash: string;
    createdAt: string;
}

export interface Competition {
    id: string;
    title: string;
    owner: string;
    createdAt: string;
    members: string[];
}

export interface JwtPayload {
    userId: string;
    username: string;
}

export interface ApiResponse<T = any> {
    success: boolean;
    data?: T;
    error?: string;
}

export interface AuthRequest {
    username: string;
    email?: string;
    password: string;
}

export interface CreateCompetitionRequest {
    title: string;
}
