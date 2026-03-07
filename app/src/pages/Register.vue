<template>
    <v-container class="fill-height d-flex align-center justify-center">
        <v-card class="w-100" max-width="400">
            <v-card-title class="text-center mb-6">Create Account</v-card-title>

            <v-card-text>
                <form @submit.prevent="handleRegister">
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
                        v-model="formData.email"
                        label="Email"
                        type="email"
                        outlined
                        density="compact"
                        class="mb-4"
                        :error="!!errors.email"
                        :error-messages="errors.email"
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
                        Create Account
                    </v-btn>

                    <v-divider class="my-4" />

                    <div class="text-center">
                        <p class="text-body2 mb-2">Already have an account?</p>
                        <v-btn variant="text" to="/login" size="small"> Sign in </v-btn>
                    </div>
                </form>
            </v-card-text>
        </v-card>
    </v-container>
</template>

<script setup lang="ts">
    import { reactive } from "vue";
    import { useRouter } from "vue-router";
    import { useAuthStore } from "../stores/auth";

    const router = useRouter();
    const authStore = useAuthStore();

    const formData = reactive({
        username: "",
        email: "",
        password: "",
    });

    const errors = reactive({
        username: "",
        email: "",
        password: "",
    });

    async function handleRegister() {
        errors.username = "";
        errors.email = "";
        errors.password = "";

        if (!formData.username) {
            errors.username = "Username is required";
        }

        if (!formData.email) {
            errors.email = "Email is required";
        }

        if (!formData.password) {
            errors.password = "Password is required";
            return;
        }

        if (errors.username || errors.email || errors.password) {
            return;
        }

        try {
            await authStore.register(formData.username, formData.email, formData.password);
            router.push("/dashboard");
        } catch (error) {
            // Error is handled by AuthStore
        }
    }
</script>
