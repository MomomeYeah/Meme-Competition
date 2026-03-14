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
                            <v-col v-if="isOwner" class="text-right">
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
                                <v-btn
                                    variant="outlined"
                                    color="warning"
                                    class="ml-2"
                                    @click="handleRelinquish"
                                >
                                    Relinquish Ownership
                                </v-btn>
                            </v-col>
                            <v-col v-else-if="isMember && isOwnerless" class="text-right">
                                <v-btn
                                    color="primary"
                                    :loading="competitionsStore.loading"
                                    @click="handleClaim"
                                >
                                    Claim Ownership
                                </v-btn>
                            </v-col>
                        </v-row>

                        <!-- upload section for members -->
                        <v-divider class="my-4" />
                        <div v-if="isMember">
                            <div class="font-weight-bold mb-2">Upload File</div>
                            <v-file-input
                                v-model="selectedFile"
                                label="Choose a file"
                                dense
                                outlined
                            />
                            <v-btn
                                :disabled="!selectedFile || competitionsStore.loading"
                                color="primary"
                                class="mt-2"
                                @click="handleUpload"
                            >
                                Upload
                            </v-btn>

                            <!-- list of uploaded files -->
                            <v-list v-if="uploadedFiles.length" class="mt-4">
                                <v-list-item
                                    v-for="file in uploadedFiles"
                                    :key="file.id"
                                    :value="file"
                                    :active="false"
                                    @click="openPreview(file)"
                                >
                                    <v-list-item-title>{{ file.name }}</v-list-item-title>
                                    <v-list-item-subtitle>
                                        Uploaded: {{ formatDate(file.uploadedAt) }}
                                    </v-list-item-subtitle>
                                    <template v-slot:append>
                                        <v-btn icon @click="handleDeleteFile(file)">
                                            <v-icon>mdi-delete</v-icon>
                                        </v-btn>
                                    </template>
                                </v-list-item>
                            </v-list>

                            <v-dialog v-model="showPreview" max-width="800">
                                <v-card>
                                    <!-- <v-card-title class="justify-space-between"> -->
                                    <v-card-title
                                        class="flex flex-row items-center justify-between"
                                    >
                                        <span>{{ selectedPreview?.name }}</span>
                                        <v-btn icon @click="closePreview">
                                            <v-icon>mdi-close</v-icon>
                                        </v-btn>
                                    </v-card-title>
                                    <v-card-text>
                                        <v-img
                                            v-if="selectedPreview"
                                            :src="selectedPreview.url"
                                            :alt="selectedPreview.name"
                                            max-height="600"
                                            contain
                                        />
                                    </v-card-text>
                                </v-card>
                            </v-dialog>
                        </div>
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
    import { computed, onMounted, ref } from "vue";
    import { useRoute, useRouter } from "vue-router";
    import { useAuthStore } from "../stores/auth";
    import { useCompetitionsStore } from "../stores/competitions";
    import type * as competitionsApi from "../api/competitions.api";

    const router = useRouter();
    const route = useRoute();
    const competitionsStore = useCompetitionsStore();
    const authStore = useAuthStore();

    const showSnackbar = ref(false);
    const snackbarMessage = ref("");
    const snackbarType = ref<"success" | "error">("success");

    const competitionId = route.params.id as string;

    const selectedFile = ref<File | null>(null);
    const uploadedFiles = ref<competitionsApi.CompetitionFile[]>([]);
    const selectedPreview = ref<competitionsApi.CompetitionFile | null>(null);
    const showPreview = ref(false);

    const isOwner = computed(() => {
        return authStore.user && competitionsStore.currentCompetition?.owner === authStore.user.id;
    });

    const isMember = computed(() => {
        if (!authStore.user || !competitionsStore.currentCompetition) return false;
        return competitionsStore.currentCompetition.members.includes(authStore.user.id);
    });

    const isOwnerless = computed(() => {
        return competitionsStore.currentCompetition && !competitionsStore.currentCompetition.owner;
    });

    onMounted(async () => {
        try {
            await competitionsStore.fetchCompetitionById(competitionId);
            // load user-specific files after competition arrives
            if (competitionsStore.currentCompetition && authStore.user) {
                uploadedFiles.value = await competitionsStore.fetchFiles(competitionId);
            }
        } catch (error) {
            router.push("/dashboard");
        }
    });

    function formatDate(dateString: string): string {
        return new Date(dateString).toLocaleDateString();
    }

    function getOwnerName(ownerId: string | null): string {
        // In a real app, you would fetch user details. For now, show the ID or a placeholder.
        return ownerId || "(no owner)";
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

    async function handleRelinquish() {
        if (!competitionId) return;
        try {
            await competitionsStore.relinquishCompetition(competitionId);
            snackbarMessage.value = "Ownership relinquished";
            snackbarType.value = "success";
            showSnackbar.value = true;
        } catch (err: any) {
            snackbarMessage.value = err.response?.data?.error || "Failed to relinquish ownership";
            snackbarType.value = "error";
            showSnackbar.value = true;
        }
    }

    async function handleClaim() {
        if (!competitionId) return;
        try {
            await competitionsStore.claimOwnership(competitionId);
            snackbarMessage.value = "You are now the owner";
            snackbarType.value = "success";
            showSnackbar.value = true;
        } catch (err: any) {
            snackbarMessage.value = err.response?.data?.error || "Failed to claim ownership";
            snackbarType.value = "error";
            showSnackbar.value = true;
        }
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

    function openPreview(file: competitionsApi.CompetitionFile) {
        selectedPreview.value = file;
        showPreview.value = true;
    }

    function closePreview() {
        showPreview.value = false;
        selectedPreview.value = null;
    }

    async function handleUpload() {
        if (!selectedFile.value) return;
        try {
            await competitionsStore.uploadFile(competitionId, selectedFile.value);
            snackbarMessage.value = "File uploaded";
            snackbarType.value = "success";
            showSnackbar.value = true;
            selectedFile.value = null;
            uploadedFiles.value = await competitionsStore.fetchFiles(competitionId);
        } catch (err: any) {
            snackbarMessage.value = err.response?.data?.error || "Failed to upload file";
            snackbarType.value = "error";
            showSnackbar.value = true;
        }
    }

    async function handleDeleteFile(file: competitionsApi.CompetitionFile) {
        if (!confirm("Delete this file?")) return;
        try {
            await competitionsStore.deleteFile(competitionId, file.id);
            snackbarMessage.value = "File deleted";
            snackbarType.value = "success";
            showSnackbar.value = true;
            uploadedFiles.value = uploadedFiles.value.filter((f) => f.id !== file.id);
        } catch (err: any) {
            snackbarMessage.value = err.response?.data?.error || "Failed to delete file";
            snackbarType.value = "error";
            showSnackbar.value = true;
        }
    }
</script>
