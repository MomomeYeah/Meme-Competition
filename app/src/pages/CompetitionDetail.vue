<template>
    <v-container class="py-8">
        <v-row v-if="competitionsStore.loading" class="justify-center align-center fill-height">
            <v-col class="text-center" cols="12">
                <v-progress-circular color="primary" indeterminate />
            </v-col>
        </v-row>
        
        <v-row v-else-if="competitionsStore.currentCompetition">
            <v-col cols="12" md="8">
                <v-card class="mb-6">
                    <v-card-title>{{ competitionsStore.currentCompetition.title }}</v-card-title>
                    
                    <v-card-text>
                        <v-row>
                            <v-col cols="12" sm="6">
                                <div class="font-weight-bold">Owner</div>
                                <div>{{ getOwnerName(competitionsStore.currentCompetition.owner) }}</div>
                            </v-col>
                            <v-col cols="12" sm="6">
                                <div class="font-weight-bold">Created</div>
                                <div>{{ formatDate(competitionsStore.currentCompetition.createdAt) }}</div>
                            </v-col>
                        </v-row>
                        
                        <v-divider class="my-4" />
                        
                        <div class="font-weight-bold mb-3">Members ({{ competitionsStore.currentCompetition.members.length }})</div>
                        <v-list>
                            <v-list-item v-for="memberId in competitionsStore.currentCompetition.members" :key="memberId">
                                <v-list-item-title>{{ getUsernameById(memberId) }}</v-list-item-title>
                            </v-list-item>
                        </v-list>
                        
                        <v-divider class="my-4" />
                        
                        <v-row class="mt-6">
                            <v-col>
                                <v-btn variant="outlined" @click="router.push('/dashboard')">
                                    Back
                                </v-btn>
                            </v-col>
                            <v-col v-if="!isMember && authStore.user" class="text-right">
                                <v-btn color="primary" :loading="competitionsStore.loading" @click="handleJoin">
                                    Join Competition
                                </v-btn>
                            </v-col>
                        </v-row>
                    </v-card-text>
                </v-card>
            </v-col>
        </v-row>
        
        <v-row v-else class="justify-center align-center fill-height">
            <v-col class="text-center" cols="12">
                <v-alert type="error">
                    Competition not found
                </v-alert>
                <v-btn to="/dashboard">Back to Dashboard</v-btn>
            </v-col>
        </v-row>
        
        <v-snackbar v-model="showSnackbar" :type="snackbarType">
            {{ snackbarMessage }}
        </v-snackbar>
    </v-container>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { useCompetitionsStore } from '../stores/competitions';

const router = useRouter();
const route = useRoute();
const competitionsStore = useCompetitionsStore();
const authStore = useAuthStore();

const showSnackbar = ref(false);
const snackbarMessage = ref('');
const snackbarType = ref<'success' | 'error'>('success');

const competitionId = route.params.id as string;

const isMember = computed(() => {
    if (!authStore.user || !competitionsStore.currentCompetition) return false;
    return competitionsStore.currentCompetition.members.includes(authStore.user.id);
});

onMounted(async () => {
    try {
        await competitionsStore.fetchCompetitionById(competitionId);
    } catch (error) {
        router.push('/dashboard');
    }
});

function formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString();
}

function getOwnerName(ownerId: string): string {
    // In a real app, you would fetch user details. For now, show the ID.
    return ownerId;
}

function getUsernameById(userId: string): string {
    // In a real app, you would fetch user details. For now, show the ID.
    return userId;
}

async function handleJoin() {
    try {
        await competitionsStore.joinCompetition(competitionId);
        snackbarMessage.value = 'Successfully joined competition!';
        snackbarType.value = 'success';
        showSnackbar.value = true;
    } catch (error) {
        snackbarMessage.value = 'Failed to join competition';
        snackbarType.value = 'error';
        showSnackbar.value = true;
    }
}
</script>
