<template>
    <v-container class="py-8">
        <v-row>
            <v-col cols="12" md="8" offset-md="2">
                <v-card>
                    <v-card-title>Create New Competition</v-card-title>

                    <v-card-text>
                        <form @submit.prevent="handleCreateCompetition">
                            <v-text-field
                                v-model="formData.title"
                                label="Competition Title"
                                outlined
                                density="comfortable"
                                class="mb-6"
                                :error="!!errors.title"
                                :error-messages="errors.title"
                                required
                            />

                            <v-alert v-if="competitionsStore.error" type="error" class="mb-4">
                                {{ competitionsStore.error }}
                            </v-alert>

                            <v-row class="mt-6">
                                <v-col>
                                    <v-btn variant="outlined" @click="router.back()">
                                        Cancel
                                    </v-btn>
                                </v-col>
                                <v-col class="text-right">
                                    <v-btn
                                        type="submit"
                                        color="primary"
                                        :loading="competitionsStore.loading"
                                    >
                                        Create Competition
                                    </v-btn>
                                </v-col>
                            </v-row>
                        </form>
                    </v-card-text>
                </v-card>
            </v-col>
        </v-row>
    </v-container>
</template>

<script setup lang="ts">
    import { reactive } from "vue";
    import { useRouter } from "vue-router";
    import { useCompetitionsStore } from "../stores/competitions";
    import { useAuthStore } from "../stores/auth";

    const router = useRouter();
    const competitionsStore = useCompetitionsStore();
    const authStore = useAuthStore();

    const formData = reactive({
        title: "",
    });

    const errors = reactive({
        title: "",
    });

    async function handleCreateCompetition() {
        errors.title = "";

        if (!formData.title || formData.title.trim().length === 0) {
            errors.title = "Title is required";
            return;
        }

        try {
            const newCompetition = await competitionsStore.createCompetition(formData.title);
            router.push(`/competitions/${newCompetition.id}`);
        } catch (error) {
            // Error is handled by store
        }
    }
</script>
