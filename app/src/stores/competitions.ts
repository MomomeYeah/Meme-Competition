import { defineStore } from "pinia";
import { ref, computed } from "vue";
import * as competitionsApi from "../api/competitions.api";

export interface Competition {
    id: string;
    title: string;
    owner: string;
    createdAt: string;
    members: string[];
}

export const useCompetitionsStore = defineStore("competitions", () => {
    const allCompetitions = ref<Competition[]>([]);
    const userOwnedCompetitions = ref<Competition[]>([]);
    const userJoinedCompetitions = ref<Competition[]>([]);
    const currentCompetition = ref<Competition | null>(null);
    const loading = ref(false);
    const error = ref<string | null>(null);

    const userCompetitions = computed(() => [
        ...userOwnedCompetitions.value,
        ...userJoinedCompetitions.value,
    ]);

    async function fetchAllCompetitions() {
        loading.value = true;
        error.value = null;
        try {
            allCompetitions.value = await competitionsApi.getAllCompetitions();
        } catch (err: any) {
            error.value = err.response?.data?.error || "Failed to fetch competitions";
            throw err;
        } finally {
            loading.value = false;
        }
    }

    async function fetchCompetitionById(id: string) {
        loading.value = true;
        error.value = null;
        try {
            currentCompetition.value = await competitionsApi.getCompetitionById(id);
            return currentCompetition.value;
        } catch (err: any) {
            error.value = err.response?.data?.error || "Failed to fetch competition";
            throw err;
        } finally {
            loading.value = false;
        }
    }

    async function fetchUserCompetitions(userId: string) {
        loading.value = true;
        error.value = null;
        try {
            const result = await competitionsApi.getUserCompetitions(userId);
            userOwnedCompetitions.value = result.owned;
            userJoinedCompetitions.value = result.joined;
        } catch (err: any) {
            error.value = err.response?.data?.error || "Failed to fetch user competitions";
            throw err;
        } finally {
            loading.value = false;
        }
    }

    async function createCompetition(title: string) {
        loading.value = true;
        error.value = null;
        try {
            const newCompetition = await competitionsApi.createCompetition(title);
            userOwnedCompetitions.value.push(newCompetition);
            allCompetitions.value.push(newCompetition);
            return newCompetition;
        } catch (err: any) {
            error.value = err.response?.data?.error || "Failed to create competition";
            throw err;
        } finally {
            loading.value = false;
        }
    }

    async function joinCompetition(competitionId: string) {
        loading.value = true;
        error.value = null;
        try {
            const updated = await competitionsApi.joinCompetition(competitionId);

            // Update in allCompetitions and move from available to joined
            const idx = allCompetitions.value.findIndex((c) => c.id === competitionId);
            if (idx !== -1) {
                allCompetitions.value[idx] = updated;
            }

            // Add to joined competitions
            const joinedIdx = userJoinedCompetitions.value.findIndex((c) => c.id === competitionId);
            if (joinedIdx === -1) {
                userJoinedCompetitions.value.push(updated);
            } else {
                userJoinedCompetitions.value[joinedIdx] = updated;
            }

            if (currentCompetition.value?.id === competitionId) {
                currentCompetition.value = updated;
            }

            return updated;
        } catch (err: any) {
            error.value = err.response?.data?.error || "Failed to join competition";
            throw err;
        } finally {
            loading.value = false;
        }
    }

    return {
        allCompetitions,
        userOwnedCompetitions,
        userJoinedCompetitions,
        currentCompetition,
        loading,
        error,
        userCompetitions,
        fetchAllCompetitions,
        fetchCompetitionById,
        fetchUserCompetitions,
        createCompetition,
        joinCompetition,
    };
});
