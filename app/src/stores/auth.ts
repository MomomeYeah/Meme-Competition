import { defineStore } from "pinia";
import { ref, computed } from "vue";
import * as authApi from "../api/auth.api";

export interface AuthUser {
    id: string;
    username: string;
    email: string;
    createdAt: string;
}

export const useAuthStore = defineStore("auth", () => {
    const user = ref<AuthUser | null>(null);
    const loading = ref(false);
    const error = ref<string | null>(null);

    const isAuthenticated = computed(() => !!user.value);

    async function login(username: string, password: string) {
        loading.value = true;
        error.value = null;
        try {
            const response = await authApi.login(username, password);
            user.value = response.user as AuthUser;
            return response;
        } catch (err: any) {
            error.value = err.response?.data?.error || "Login failed";
            throw err;
        } finally {
            loading.value = false;
        }
    }

    async function register(username: string, email: string, password: string) {
        loading.value = true;
        error.value = null;
        try {
            const response = await authApi.register(username, email, password);
            user.value = response.user as AuthUser;
            return response;
        } catch (err: any) {
            error.value = err.response?.data?.error || "Registration failed";
            throw err;
        } finally {
            loading.value = false;
        }
    }

    async function checkAuth() {
        loading.value = true;
        try {
            const currentUser = await authApi.getCurrentUser();
            user.value = currentUser as AuthUser;
        } catch (err) {
            user.value = null;
        } finally {
            loading.value = false;
        }
    }

    async function logout() {
        try {
            await authApi.logout();
        } finally {
            user.value = null;
            error.value = null;
        }
    }

    return {
        user,
        loading,
        error,
        isAuthenticated,
        login,
        register,
        checkAuth,
        logout,
    };
});
