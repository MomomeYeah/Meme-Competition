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
                                <div>
                                    {{ getOwnerName(competitionsStore.currentCompetition.owner) }}
                                </div>
                            </v-col>
                            <v-col cols="12" sm="6">
                                <div class="font-weight-bold">Created</div>
                                <div>
                                    {{ formatDate(competitionsStore.currentCompetition.createdAt) }}
                                </div>
                            </v-col>
                        </v-row>

                        <v-divider class="my-4" />

                        <div class="font-weight-bold mb-3">
                            Members ({{ competitionsStore.currentCompetition.members.length }})
                        </div>
                        <v-list>
                            <v-list-item
                                v-for="memberId in competitionsStore.currentCompetition.members"
                                :key="memberId"
                            >
                                <v-list-item-title>{{
                                    getUsernameById(memberId)
                                }}</v-list-item-title>
                            </v-list-item>
                        </v-list>

                        <v-divider class="my-4" />

                        <v-row class="mt-6">
                            <v-col>
                                <v-btn variant="outlined" @click="router.push('/dashboard')">
                                    Back
                                </v-btn>
                            </v-col>
                            <v-col
                                v-if="
                                    authStore.user &&
                                    authStore.user.id ===
                                        competitionsStore.currentCompetition?.owner
                                "
                                class="text-right"
                            >
                                <v-btn variant="outlined" color="secondary" @click="copyShareLink">
                                    Share Link
                                </v-btn>
                                <v-btn
                                    variant="outlined"
                                    color="error"
                                    class="ml-2"
                                    @click="handleDelete"
                                >
                                    Delete
                                </v-btn>
                            </v-col>
                        </v-row>
                    </v-card-text>
                </v-card>
            </v-col>
        </v-row>

        <v-row v-else class="justify-center align-center fill-height">
            <v-col class="text-center" cols="12">
                <v-alert type="error"> Competition not found </v-alert>
                <v-btn to="/dashboard">Back to Dashboard</v-btn>
            </v-col>
        </v-row>

        <v-snackbar v-model="showSnackbar" :type="snackbarType">
            {{ snackbarMessage }}
        </v-snackbar>
    </v-container>
</template>

<script setup lang="ts">
    import { onMounted, ref } from "vue";
    import { useRoute, useRouter } from "vue-router";
    import { useAuthStore } from "../stores/auth";
    import { useCompetitionsStore } from "../stores/competitions";

    const router = useRouter();
    const route = useRoute();
    const competitionsStore = useCompetitionsStore();
    const authStore = useAuthStore();

    const showSnackbar = ref(false);
    const snackbarMessage = ref("");
    const snackbarType = ref<"success" | "error">("success");

    const competitionId = route.params.id as string;

    onMounted(async () => {
        try {
            await competitionsStore.fetchCompetitionById(competitionId);
        } catch (error) {
            router.push("/dashboard");
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

    function copyShareLink() {
        if (!competitionId) return;
        const url = `${window.location.origin}/invite/${competitionId}`;
        navigator.clipboard.writeText(url).then(() => {
            snackbarMessage.value = "Link copied to clipboard";
            snackbarType.value = "success";
            showSnackbar.value = true;
        });
    }

    async function handleDelete() {
        if (
            !confirm(
                "Are you sure you want to delete this competition? This action cannot be undone."
            )
        ) {
            return;
        }

        try {
            await competitionsStore.deleteCompetition(competitionId);
            snackbarMessage.value = "Competition deleted";
            snackbarType.value = "success";
            showSnackbar.value = true;
            router.push("/dashboard");
        } catch (err: any) {
            snackbarMessage.value = err.response?.data?.error || "Failed to delete competition";
            snackbarType.value = "error";
            showSnackbar.value = true;
        }
    }
</script>
