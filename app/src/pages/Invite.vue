<template>
    <v-container class="py-8">
        <v-row v-if="loading" class="justify-center align-center fill-height">
            <v-col class="text-center" cols="12">
                <v-progress-circular color="primary" indeterminate />
            </v-col>
        </v-row>

        <v-row v-else-if="error" class="justify-center align-center fill-height">
            <v-col class="text-center" cols="12">
                <v-alert type="error">{{ error }}</v-alert>
                <v-btn to="/dashboard" class="mt-4">Go to dashboard</v-btn>
            </v-col>
        </v-row>

        <!-- nothing rendered when joined; user is redirected immediately -->
    </v-container>
</template>

<script setup lang="ts">
    import { onMounted, ref } from "vue";
    import { useRoute, useRouter } from "vue-router";
    import { useCompetitionsStore } from "../stores/competitions";

    const route = useRoute();
    const router = useRouter();
    const competitionsStore = useCompetitionsStore();

    const loading = ref(true);
    const error = ref("");

    async function processInvite() {
        const compId = route.params.id as string;
        try {
            await competitionsStore.joinCompetition(compId);
            router.push(`/competitions/${compId}`);
        } catch (err: any) {
            const msg = err.response?.data?.error || "Unable to join competition";
            error.value = msg;
        } finally {
            loading.value = false;
        }
    }

    onMounted(processInvite);
</script>
