<template>
    <v-container class="fill-height d-flex align-center justify-center">
        <v-card class="w-100" max-width="400">
            <v-card-title class="text-center mb-6">Sign In</v-card-title>

            <v-card-text>
                <form @submit.prevent="handleLogin">
                    <v-text-field
                        v-model="formData.username"
                        label="Username"
                        type="text"
                        outlined
                        density="compact"
                        class="mb-4"
                        :error="!!errors.username"
                        :error-messages="errors.username"
                        required
                    />

                    <v-text-field
                        v-model="formData.password"
                        label="Password"
                        type="password"
                        outlined
                        density="compact"
                        class="mb-6"
                        :error="!!errors.password"
                        :error-messages="errors.password"
                        required
                    />

                    <v-alert v-if="authStore.error" type="error" class="mb-4">
                        {{ authStore.error }}
                    </v-alert>

                    <v-btn
                        type="submit"
                        block
                        color="primary"
                        :loading="authStore.loading"
                        class="mb-4"
                    >
                        Sign In
                    </v-btn>

                    <v-divider class="my-4" />

                    <div class="text-center">
                        <p class="text-body2 mb-2">Don't have an account?</p>
                        <v-btn variant="text" to="/register" size="small"> Create one </v-btn>
                    </div>
                </form>
            </v-card-text>
        </v-card>
    </v-container>
</template>

<script setup lang="ts">
    import { ref, reactive } from "vue";
    import { useRouter } from "vue-router";
    import { useAuthStore } from "../stores/auth";

    const router = useRouter();
    const authStore = useAuthStore();

    const formData = reactive({
        username: "",
        password: "",
    });

    const errors = reactive({
        username: "",
        password: "",
    });

    async function handleLogin() {
        errors.username = "";
        errors.password = "";

        if (!formData.username) {
            errors.username = "Username is required";
            return;
        }

        if (!formData.password) {
            errors.password = "Password is required";
            return;
        }

        try {
            await authStore.login(formData.username, formData.password);
            // redirect back if a 'redirect' query parameter was provided
            const redirectTo = (router.currentRoute.value.query.redirect as string) || "/dashboard";
            router.push(redirectTo);
        } catch (error) {
            // Error is handled by AuthStore
        }
    }
</script>

<style scoped></style>
