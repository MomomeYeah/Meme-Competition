import apiClient from './client';

export interface User {
    id: string;
    username: string;
    email: string;
    createdAt: string;
}

export interface LoginResponse {
    user: User;
    userId: string;
}

export interface RegisterResponse {
    user: User;
    userId: string;
}

export async function login(username: string, password: string): Promise<LoginResponse> {
    const response = await apiClient.post<{ success: boolean; data: LoginResponse }>('/auth/login', {
        username,
        password,
    });
    return response.data.data;
}

export async function register(
    username: string,
    email: string,
    password: string,
): Promise<RegisterResponse> {
    const response = await apiClient.post<{ success: boolean; data: RegisterResponse }>('/auth/register', {
        username,
        email,
        password,
    });
    return response.data.data;
}

export async function getCurrentUser(): Promise<User> {
    const response = await apiClient.get<{ success: boolean; data: { user: User } }>('/auth/me');
    return response.data.data.user;
}

export async function logout(): Promise<void> {
    await apiClient.post('/auth/logout');
}
