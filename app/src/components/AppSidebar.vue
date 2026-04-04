<template>
    <!-- Desktop sidebar -->
    <aside class="sidebar">
        <div class="sidebar-brand">
            <div class="sidebar-brand-icon">
                <i class="mdi mdi-view-dashboard"></i>
            </div>
            <div>
                <p class="sidebar-brand-title">MemeBattle</p>
                <p class="sidebar-brand-sub">{{ authStore.user?.username ?? 'Curator' }}</p>
            </div>
        </div>

        <nav class="sidebar-nav">
            <router-link class="sidebar-item" active-class="sidebar-item-active" to="/dashboard">
                <i class="mdi mdi-view-dashboard sidebar-item-icon"></i>
                <span>Dashboard</span>
            </router-link>
            <a class="sidebar-item" href="#">
                <i class="mdi mdi-sword-cross sidebar-item-icon"></i>
                <span>Battles</span>
            </a>
            <a class="sidebar-item" href="#">
                <i class="mdi mdi-database-outline sidebar-item-icon"></i>
                <span>Assets</span>
            </a>
            <a class="sidebar-item" href="#">
                <i class="mdi mdi-currency-usd sidebar-item-icon"></i>
                <span>Earnings</span>
            </a>
            <a class="sidebar-item" href="#">
                <i class="mdi mdi-cog-outline sidebar-item-icon"></i>
                <span>Settings</span>
            </a>
        </nav>

    </aside>

    <!-- Mobile bottom nav -->
    <nav class="bottom-nav">
        <router-link class="bottom-nav-item" active-class="bottom-nav-item-active" to="/dashboard">
            <i class="mdi mdi-view-dashboard"></i>
            <span>Dash</span>
        </router-link>
        <a class="bottom-nav-item" href="#">
            <i class="mdi mdi-sword-cross"></i>
            <span>Arena</span>
        </a>
        <router-link class="bottom-nav-item" to="/create-competition">
            <i class="mdi mdi-plus-box-outline"></i>
            <span>Create</span>
        </router-link>
        <a class="bottom-nav-item" href="#">
            <i class="mdi mdi-database-outline"></i>
            <span>Assets</span>
        </a>
        <a class="bottom-nav-item" href="#">
            <i class="mdi mdi-account-outline"></i>
            <span>Profile</span>
        </a>
    </nav>
</template>

<script setup lang="ts">
    import { useAuthStore } from "../stores/auth";

    const authStore = useAuthStore();
</script>

<style scoped>
    /* ─── Desktop Sidebar ────────────────────────────────────────── */
    .sidebar {
        position: fixed;
        top: var(--bt-header-height);
        left: 0;
        width: var(--bt-sidebar-width);
        height: calc(100vh - var(--bt-header-height));
        background: var(--bt-surface);
        display: none;
        flex-direction: column;
        padding: 2rem 1rem;
        gap: 1rem;
        border-right: 1px solid rgba(255, 255, 255, 0.03);
        z-index: 90;
        overflow-y: auto;
    }

    @media (min-width: 840px) {
        .sidebar {
            display: flex;
        }
    }

    .sidebar-brand {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0 0.5rem;
        margin-bottom: 1rem;
    }

    .sidebar-brand-icon {
        width: 40px;
        height: 40px;
        background: var(--bt-primary-container);
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--bt-on-primary-container);
        font-size: 20px;
        flex-shrink: 0;
    }

    .sidebar-brand-title {
        font-family: var(--bt-font-headline);
        font-size: 0.6875rem;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--bt-primary-container);
    }

    .sidebar-brand-sub {
        font-family: var(--bt-font-headline);
        font-size: 0.55rem;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--bt-secondary);
        margin-top: 2px;
    }

    .sidebar-nav {
        display: flex;
        flex-direction: column;
        gap: 2px;
        flex: 1;
    }

    .sidebar-item {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.75rem 1rem;
        font-family: var(--bt-font-headline);
        font-size: 0.6875rem;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--bt-secondary);
        text-decoration: none;
        background: transparent;
        border: none;
        width: 100%;
        text-align: left;
        cursor: pointer;
        transition: background 0.15s, color 0.15s;
    }

    .sidebar-item:hover,
    .sidebar-item-inactive:hover {
        background: var(--bt-surface-container-highest);
        color: var(--bt-on-surface);
    }

    .sidebar-item-active,
    .sidebar-item.router-link-active {
        color: var(--bt-primary-container);
        background: var(--bt-surface-container-low);
    }

    .sidebar-item-icon {
        font-size: 16px;
        line-height: 1;
        flex-shrink: 0;
    }


    /* ─── Mobile Bottom Nav ──────────────────────────────────────── */
    .bottom-nav {
        position: fixed;
        bottom: 0;
        left: 0;
        width: 100%;
        height: 64px;
        background: var(--bt-surface-container-low);
        display: flex;
        align-items: center;
        justify-content: space-around;
        z-index: 100;
        border-top: 1px solid rgba(255, 255, 255, 0.04);
    }

    @media (min-width: 840px) {
        .bottom-nav {
            display: none;
        }
    }

    .bottom-nav-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 3px;
        padding: 0.5rem;
        color: var(--bt-secondary);
        text-decoration: none;
        background: transparent;
        border: none;
        cursor: pointer;
        transition: color 0.15s;
    }

    .bottom-nav-item .mdi {
        font-size: 22px;
        line-height: 1;
    }

    .bottom-nav-item span {
        font-family: var(--bt-font-headline);
        font-size: 0.5625rem;
        letter-spacing: 0.12em;
        text-transform: uppercase;
    }

    .bottom-nav-item-active,
    .bottom-nav-item.router-link-active {
        color: var(--bt-primary-container);
        font-weight: 700;
    }
</style>
