<template>
    <div>
        <v-container class="py-8">
            <v-row class="mb-6">
                <v-col>
                    <h1 class="text-h4">Competitions</h1>
                </v-col>
                <v-col class="text-right">
                    <v-btn color="primary" to="/create-competition">
                        Create Competition
                    </v-btn>
                </v-col>
            </v-row>
            
            <v-row v-if="competitionsStore.userOwnedCompetitions.length > 0">
                <v-col cols="12">
                    <h2 class="text-h6 mb-4">My Competitions</h2>
                </v-col>
                <v-col v-for="comp in competitionsStore.userOwnedCompetitions" :key="comp.id" cols="12" md="6" lg="4">
                    <CompetitionCard :competition="comp" @click="router.push(`/competitions/${comp.id}`)" />
                </v-col>
            </v-row>
            
            <v-row v-if="competitionsStore.userJoinedCompetitions.length > 0">
                <v-col cols="12">
                    <h2 class="text-h6 mb-4 mt-6">Competitions I've Joined</h2>
                </v-col>
                <v-col v-for="comp in competitionsStore.userJoinedCompetitions" :key="comp.id" cols="12" md="6" lg="4">
                    <CompetitionCard :competition="comp" @click="router.push(`/competitions/${comp.id}`)" />
                </v-col>
            </v-row>
            
            <v-row v-if="competitionsStore.userOwnedCompetitions.length === 0 && competitionsStore.userJoinedCompetitions.length === 0">
                <v-col cols="12">
                    <v-alert type="info">
                        You haven't created or joined any competitions yet. <router-link to="/create-competition">Create one</router-link> or browse available competitions.
                    </v-alert>
                </v-col>
            </v-row>
            
            <v-row v-if="availableCompetitions.length > 0">
                <v-col cols="12">
                    <h2 class="text-h6 mb-4 mt-6">Other Competitions</h2>
                </v-col>
                <v-col v-for="comp in availableCompetitions" :key="comp.id" cols="12" md="6" lg="4">
                    <CompetitionCard 
                        :competition="comp" 
                        :show-join-button="true"
                        @click="router.push(`/competitions/${comp.id}`)"
                        @join="handleJoinCompetition(comp.id)"
                    />
                </v-col>
            </v-row>
            
            <v-snackbar v-model="showSnackbar" :type="snackbarType">
                {{ snackbarMessage }}
            </v-snackbar>
        </v-container>
    </div>
</template>

<script setup lang="ts">
    import { ref, computed, onMounted } from 'vue';
    import { useRouter } from 'vue-router';
    import { useAuthStore } from '../stores/auth';
    import { useCompetitionsStore } from '../stores/competitions';
    import CompetitionCard from '../components/CompetitionCard.vue';

    const router = useRouter();
    const authStore = useAuthStore();
    const competitionsStore = useCompetitionsStore();

    const showSnackbar = ref(false);
    const snackbarMessage = ref('');
    const snackbarType = ref<'success' | 'error'>('success');

    const availableCompetitions = computed(() => {
        return competitionsStore.allCompetitions.filter(
        (c) =>
        !competitionsStore.userOwnedCompetitions.some((uc) => uc.id === c.id) &&
        !competitionsStore.userJoinedCompetitions.some((uc) => uc.id === c.id),
        );
    });

    onMounted(async () => {
        if (authStore.user) {
            await competitionsStore.fetchUserCompetitions(authStore.user.id);
            await competitionsStore.fetchAllCompetitions();
        }
    });

    async function handleJoinCompetition(competitionId: string) {
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
