export interface User {
    id: string;
    username: string;
    email: string;
    passwordHash: string;
    createdAt: string;
}

export interface CompetitionFile {
    id: string;
    name: string;
    uploaderId: string;
    uploadedAt: string;
    rating: number | null;
    s3Key: string;
}

export interface Competition {
    id: string;
    title: string;
    // owner id; null indicates no current owner (competition open for claim)
    owner: string | null;
    createdAt: string;
    members: string[];
    files: CompetitionFile[];
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
