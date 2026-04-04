<template>
    <v-app class="app-shell">
        <AppHeader />
        <AppSidebar v-if="authStore.isAuthenticated" />
        <div class="app-content" :class="{ 'has-sidebar': authStore.isAuthenticated }">
            <router-view />
        </div>
    </v-app>
</template>

<script lang="ts" setup>
    import AppHeader from "./components/AppHeader.vue";
    import AppSidebar from "./components/AppSidebar.vue";
    import { useAuthStore } from "./stores/auth";

    const authStore = useAuthStore();
</script>
