<template>
    <div class="bt-screen">
        <div class="bt-grid-bg"></div>
        <div class="bt-top-line"></div>
        <div class="bt-vignette"></div>

        <main class="page-main">
            <section class="panel-section">
                <div class="bt-console-frame">
                    <div class="bt-scanner-line"></div>

                    <div class="bt-panel-header">
                        <span>Direct Access Authentication</span>
                        <i class="mdi mdi-key-variant"></i>
                    </div>

                    <div class="panel-content">
                        <!-- Branding -->
                        <div class="branding">
                            <div>
                                <h1 class="brand-name">
                                    <span class="brand-meme">Meme</span>Battle
                                </h1>
                                <p class="brand-version">v4.0.2</p>
                            </div>
                            <div class="brand-tagline">
                                <h2 class="brand-subtitle">
                                    The Ultimate War for
                                    <span class="brand-highlight">Internet Clout</span>
                                </h2>
                                <p class="brand-subtext">Establish secure connection</p>
                            </div>
                        </div>

                        <!-- Social login -->
                        <div class="social-grid">
                            <button class="bt-social-btn" type="button">
                                <i class="mdi mdi-google"></i>
                                <span>Google</span>
                            </button>
                            <button class="bt-social-btn" type="button">
                                <i class="mdi mdi-facebook"></i>
                                <span>Facebook</span>
                            </button>
                        </div>

                        <!-- Divider -->
                        <div class="bt-manual-divider">
                            <div class="bt-divider-line"></div>
                            <span class="bt-divider-label">Manual Access</span>
                            <div class="bt-divider-line"></div>
                        </div>

                        <!-- Form -->
                        <form @submit.prevent="handleSubmit">
                            <!-- Login / Signup toggle -->
                            <div class="bt-tab-toggle">
                                <button
                                    type="button"
                                    :class="['bt-tab-btn', activeTab === 'login' && 'bt-tab-active']"
                                    @click="switchTab('login')"
                                >
                                    Login
                                </button>
                                <button
                                    type="button"
                                    :class="['bt-tab-btn', activeTab === 'signup' && 'bt-tab-active']"
                                    @click="switchTab('signup')"
                                >
                                    Register
                                </button>
                            </div>

                            <div class="fields">
                                <!-- Username -->
                                <div class="bt-field-group">
                                    <label class="bt-field-label" for="username">
                                        User Identifier
                                    </label>
                                    <div
                                        :class="['bt-field-wrapper', errors.username && 'bt-field-error-state']"
                                    >
                                        <div class="bt-field-accent"></div>
                                        <i class="mdi mdi-at bt-field-icon"></i>
                                        <input
                                            id="username"
                                            v-model="formData.username"
                                            class="bt-field-input"
                                            type="text"
                                            placeholder="OPERATOR@SYSTEM.NODE"
                                        />
                                    </div>
                                    <span v-if="errors.username" class="bt-field-error-msg">
                                        {{ errors.username }}
                                    </span>
                                </div>

                                <!-- Email (signup only) -->
                                <div v-if="activeTab === 'signup'" class="bt-field-group">
                                    <label class="bt-field-label" for="email">
                                        Signal Address
                                    </label>
                                    <div
                                        :class="['bt-field-wrapper', errors.email && 'bt-field-error-state']"
                                    >
                                        <div class="bt-field-accent"></div>
                                        <i class="mdi mdi-email-outline bt-field-icon"></i>
                                        <input
                                            id="email"
                                            v-model="formData.email"
                                            class="bt-field-input"
                                            type="email"
                                            placeholder="OPERATOR@DOMAIN.NET"
                                        />
                                    </div>
                                    <span v-if="errors.email" class="bt-field-error-msg">
                                        {{ errors.email }}
                                    </span>
                                </div>

                                <!-- Password -->
                                <div class="bt-field-group">
                                    <label class="bt-field-label" for="password">
                                        Encryption Key
                                    </label>
                                    <div
                                        :class="['bt-field-wrapper', errors.password && 'bt-field-error-state']"
                                    >
                                        <div class="bt-field-accent"></div>
                                        <i class="mdi mdi-console bt-field-icon"></i>
                                        <input
                                            id="password"
                                            v-model="formData.password"
                                            class="bt-field-input"
                                            type="password"
                                            placeholder="••••••••"
                                        />
                                    </div>
                                    <span v-if="errors.password" class="bt-field-error-msg">
                                        {{ errors.password }}
                                    </span>
                                </div>
                            </div>

                            <div v-if="authStore.error" class="bt-auth-error">
                                {{ authStore.error }}
                            </div>

                            <button class="bt-submit-btn" type="submit" :disabled="authStore.loading">
                                <span>{{ submitLabel }}</span>
                                <i :class="['mdi', activeTab === 'login' ? 'mdi-rocket-launch' : 'mdi-account-plus']"></i>
                            </button>
                        </form>
                    </div>
                </div>
            </section>
        </main>

        <div class="bt-status-bar">
            <div class="bt-status-item">
                <span class="bt-status-key">SYSTEM:</span>
                <span>STABLE</span>
            </div>
            <div class="bt-status-item">
                <span class="bt-status-key">ENCRYPTION:</span>
                <span>X-AES-512</span>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
    import { computed, reactive, watch } from "vue";
    import { useRoute, useRouter } from "vue-router";
    import { useAuthStore } from "../stores/auth";

    const route = useRoute();
    const router = useRouter();
    const authStore = useAuthStore();

    const activeTab = computed(() => (route.path === "/register" ? "signup" : "login"));

    const submitLabel = computed(() =>
        authStore.loading
            ? "Connecting..."
            : activeTab.value === "login"
              ? "Deploy to Battle"
              : "Enlist Now"
    );

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

    function switchTab(tab: "login" | "signup") {
        if (tab === activeTab.value) return;
        clearForm();
        router.push(tab === "login" ? "/login" : "/register");
    }

    function clearForm() {
        formData.username = "";
        formData.email = "";
        formData.password = "";
        errors.username = "";
        errors.email = "";
        errors.password = "";
        authStore.error = null;
    }

    // Clear form whenever the route changes between login and register
    watch(activeTab, clearForm);

    async function handleSubmit() {
        errors.username = "";
        errors.email = "";
        errors.password = "";

        let valid = true;

        if (!formData.username) {
            errors.username = "Username is required";
            valid = false;
        }

        if (activeTab.value === "signup" && !formData.email) {
            errors.email = "Email is required";
            valid = false;
        }

        if (!formData.password) {
            errors.password = "Password is required";
            valid = false;
        }

        if (!valid) return;

        try {
            if (activeTab.value === "login") {
                await authStore.login(formData.username, formData.password);
            } else {
                await authStore.register(formData.username, formData.email, formData.password);
            }
            const redirectTo =
                (router.currentRoute.value.query.redirect as string) || "/dashboard";
            router.push(redirectTo);
        } catch {
            // Error is handled by authStore
        }
    }
</script>

<style scoped>
    .page-main {
        position: relative;
        z-index: 10;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        flex: 1;
        padding: 2rem 1rem 5rem;
        min-height: 100vh;
    }

    .panel-section {
        width: 100%;
        max-width: 560px;
    }

    .panel-content {
        padding: 2rem 3rem;
        display: flex;
        flex-direction: column;
        gap: 2rem;
    }

    @media (max-width: 600px) {
        .panel-content {
            padding: 1.5rem;
        }
    }

    /* ─── Branding ─────────────────────────────────────────────── */
    .branding {
        text-align: center;
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }

    .brand-name {
        font-family: var(--bt-font-headline);
        font-weight: 700;
        font-size: 2.75rem;
        letter-spacing: -0.02em;
        color: var(--bt-on-surface);
        text-shadow: 0 0 15px rgba(0, 245, 255, 0.4);
        line-height: 1;
    }

    .brand-meme {
        color: var(--bt-primary);
        font-weight: 300;
    }

    .brand-version {
        font-family: var(--bt-font-label);
        font-size: 9px;
        color: rgba(0, 245, 255, 0.5);
        letter-spacing: 0.5em;
        text-transform: uppercase;
        margin-top: 0.5rem;
    }

    .brand-tagline {
        padding-top: 0.5rem;
    }

    .brand-subtitle {
        font-family: var(--bt-font-headline);
        font-size: 0.875rem;
        font-weight: 500;
        color: rgba(241, 245, 249, 0.8);
        letter-spacing: 0.1em;
        text-transform: uppercase;
    }

    .brand-highlight {
        color: var(--bt-primary);
        text-decoration: underline;
        text-decoration-color: rgba(0, 245, 255, 0.3);
        text-underline-offset: 4px;
    }

    .brand-subtext {
        font-family: var(--bt-font-label);
        font-size: 8px;
        color: var(--bt-muted);
        text-transform: uppercase;
        letter-spacing: 0.4em;
        margin-top: 0.5rem;
    }

    /* ─── Social Grid ──────────────────────────────────────────── */
    .social-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1rem;
    }

    /* ─── Fields ───────────────────────────────────────────────── */
    .fields {
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
        margin-bottom: 1.5rem;
    }
</style>
