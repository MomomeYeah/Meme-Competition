<template>
    <header class="app-header">
        <div class="header-left">
            <router-link class="header-logo" to="/dashboard">MemeBattle</router-link>
            <nav class="header-nav">
                <router-link class="header-nav-link" to="/dashboard">Arena</router-link>
                <a class="header-nav-link header-nav-muted" href="#">Gallery</a>
                <a class="header-nav-link header-nav-muted" href="#">Ranking</a>
                <a class="header-nav-link header-nav-muted" href="#">Live</a>
            </nav>
        </div>

        <div class="header-right">
            <button class="header-icon-btn" type="button" aria-label="Notifications">
                <i class="mdi mdi-bell-outline"></i>
            </button>
            <button class="header-icon-btn" type="button" aria-label="Power">
                <i class="mdi mdi-lightning-bolt"></i>
            </button>
            <div v-if="authStore.user" class="avatar-wrapper" ref="avatarWrapperRef">
                <div
                    class="header-avatar"
                    :title="authStore.user.username"
                    @click="dropdownOpen = !dropdownOpen"
                >
                    {{ avatarInitial }}
                </div>
                <div v-if="dropdownOpen" class="avatar-dropdown">
                    <div class="dropdown-username">{{ authStore.user.username }}</div>
                    <div class="dropdown-divider"></div>
                    <button class="dropdown-item dropdown-item-danger" type="button" @click="handleLogout">
                        <i class="mdi mdi-logout dropdown-item-icon"></i>
                        <span>Logout</span>
                    </button>
                </div>
            </div>
            <router-link v-else class="header-login-link" to="/login">Login</router-link>
        </div>
    </header>
</template>

<script setup lang="ts">
    import { computed, ref, onMounted, onUnmounted } from "vue";
    import { useRouter } from "vue-router";
    import { useAuthStore } from "../stores/auth";

    const router = useRouter();
    const authStore = useAuthStore();

    const dropdownOpen = ref(false);
    const avatarWrapperRef = ref<HTMLElement | null>(null);

    const avatarInitial = computed(() =>
        authStore.user ? authStore.user.username.charAt(0).toUpperCase() : ""
    );

    async function handleLogout() {
        dropdownOpen.value = false;
        await authStore.logout();
        router.push("/login");
    }

    function onClickOutside(e: MouseEvent) {
        if (avatarWrapperRef.value && !avatarWrapperRef.value.contains(e.target as Node)) {
            dropdownOpen.value = false;
        }
    }

    onMounted(() => document.addEventListener("mousedown", onClickOutside));
    onUnmounted(() => document.removeEventListener("mousedown", onClickOutside));
</script>

<style scoped>
    .app-header {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: var(--bt-header-height);
        z-index: 100;
        background: var(--bt-surface-container-low);
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 2rem;
        border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    }

    .header-left {
        display: flex;
        align-items: center;
        gap: 2rem;
    }

    .header-logo {
        font-family: var(--bt-font-headline);
        font-weight: 800;
        font-size: 1.375rem;
        letter-spacing: -0.05em;
        color: var(--bt-primary-container);
        text-decoration: none;
        white-space: nowrap;
    }

    .header-nav {
        display: none;
        align-items: center;
        gap: 1.5rem;
    }

    @media (min-width: 840px) {
        .header-nav {
            display: flex;
        }
    }

    .header-nav-link {
        font-family: var(--bt-font-headline);
        font-size: 0.875rem;
        letter-spacing: -0.01em;
        color: var(--bt-primary-container);
        text-decoration: none;
        padding-bottom: 2px;
        border-bottom: 2px solid var(--bt-primary-container);
        transition: color 0.2s, border-color 0.2s;
    }

    .header-nav-muted {
        color: var(--bt-secondary);
        border-bottom-color: transparent;
    }

    .header-nav-muted:hover {
        color: var(--bt-on-surface);
    }

    .header-right {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    .header-icon-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        background: transparent;
        border: none;
        cursor: pointer;
        color: var(--bt-on-surface);
        font-size: 20px;
        transition: background 0.2s;
    }

    .header-icon-btn:hover {
        background: var(--bt-surface-container-highest);
    }

    .avatar-wrapper {
        position: relative;
    }

    .header-avatar {
        width: 32px;
        height: 32px;
        background: var(--bt-surface-container-highest);
        border: 1px solid rgba(255, 255, 255, 0.1);
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: var(--bt-font-headline);
        font-weight: 700;
        font-size: 0.75rem;
        color: var(--bt-primary-container);
        cursor: pointer;
        user-select: none;
        transition: border-color 0.2s;
    }

    .header-avatar:hover {
        border-color: rgba(0, 255, 255, 0.3);
    }

    .avatar-dropdown {
        position: absolute;
        top: calc(100% + 0.5rem);
        right: 0;
        min-width: 160px;
        background: var(--bt-surface-container-high);
        border: 1px solid rgba(255, 255, 255, 0.06);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
        z-index: 200;
    }

    .dropdown-username {
        padding: 0.625rem 1rem;
        font-family: var(--bt-font-headline);
        font-size: 0.6875rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--bt-on-surface-variant);
    }

    .dropdown-divider {
        height: 1px;
        background: rgba(255, 255, 255, 0.06);
    }

    .dropdown-item {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.75rem 1rem;
        width: 100%;
        background: transparent;
        border: none;
        cursor: pointer;
        font-family: var(--bt-font-headline);
        font-size: 0.6875rem;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        text-align: left;
        transition: background 0.15s, color 0.15s;
    }

    .dropdown-item-danger {
        color: var(--bt-error-dim);
    }

    .dropdown-item-danger:hover {
        background: var(--bt-surface-container-highest);
        color: var(--bt-error);
    }

    .dropdown-item-icon {
        font-size: 16px;
        line-height: 1;
        flex-shrink: 0;
    }

    .header-login-link {
        font-family: var(--bt-font-headline);
        font-size: 0.8125rem;
        color: var(--bt-secondary);
        text-decoration: none;
        transition: color 0.2s;
    }

    .header-login-link:hover {
        color: var(--bt-on-surface);
    }
</style>
