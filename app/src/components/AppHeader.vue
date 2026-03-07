<template>
    <v-app-bar elevation="1">
        <v-app-bar-title>Meme Competition</v-app-bar-title>
        
        <v-spacer />
        
        <v-menu v-if="authStore.user">
            <template #activator="{ props }">
                <v-btn icon v-bind="props">
                    <v-icon>mdi-account-circle</v-icon>
                </v-btn>
            </template>
            
            <v-list>
                <v-list-item>
                    <template #prepend>
                        <v-icon>mdi-account</v-icon>
                    </template>
                    <v-list-item-title>{{ authStore.user.username }}</v-list-item-title>
                </v-list-item>
                
                <v-divider />
                
                <v-list-item link to="/dashboard">
                    <template #prepend>
                        <v-icon>mdi-home</v-icon>
                    </template>
                    <v-list-item-title>Dashboard</v-list-item-title>
                </v-list-item>
                
                <v-list-item link @click="handleLogout">
                    <template #prepend>
                        <v-icon>mdi-logout</v-icon>
                    </template>
                    <v-list-item-title>Logout</v-list-item-title>
                </v-list-item>
            </v-list>
        </v-menu>
        
        <v-btn v-else to="/login" variant="text">
            Login
        </v-btn>
    </v-app-bar>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const router = useRouter();
const authStore = useAuthStore();

async function handleLogout() {
    await authStore.logout();
    router.push('/login');
}
</script>
