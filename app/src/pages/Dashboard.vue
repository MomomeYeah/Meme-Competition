<template>
    <div>
        <v-container class="py-8">
            <v-row class="mb-6">
                <v-col>
                    <h1 class="text-h4">Competitions</h1>
                </v-col>
                <v-col class="text-right">
                    <v-btn color="primary" to="/create-competition"> Create Competition </v-btn>
                </v-col>
            </v-row>

            <v-row v-if="competitionsStore.userCompetitions.length > 0">
                <v-col cols="12">
                    <h2 class="text-h6 mb-4">My Competitions</h2>
                </v-col>
                <v-col
                    v-for="comp in competitionsStore.userCompetitions"
                    :key="comp.id"
                    cols="12"
                    md="6"
                    lg="4"
                >
                    <CompetitionCard
                        :competition="comp"
                        @click="router.push(`/competitions/${comp.id}`)"
                    />
                </v-col>
            </v-row>

            <v-row v-if="competitionsStore.userCompetitions.length === 0">
                <v-col cols="12">
                    <v-alert type="info">
                        You haven't created or joined any competitions yet.
                        <router-link to="/create-competition">Create one</router-link>.
                    </v-alert>
                </v-col>
            </v-row>

            <v-snackbar v-model="showSnackbar" :type="snackbarType">
                {{ snackbarMessage }}
            </v-snackbar>
        </v-container>
    </div>
</template>

<script setup lang="ts">
    import { ref, onMounted } from "vue";
    import { useRouter } from "vue-router";
    import { useAuthStore } from "../stores/auth";
    import { useCompetitionsStore } from "../stores/competitions";
    import CompetitionCard from "../components/CompetitionCard.vue";

    const router = useRouter();
    const authStore = useAuthStore();
    const competitionsStore = useCompetitionsStore();

    const showSnackbar = ref(false);
    const snackbarMessage = ref("");
    const snackbarType = ref<"success" | "error">("success");

    onMounted(async () => {
        if (authStore.user) {
            await competitionsStore.fetchUserCompetitions(authStore.user.id);
        }
    });
</script>
