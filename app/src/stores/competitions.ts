import { defineStore } from "pinia";
import { ref } from "vue";
import * as competitionsApi from "../api/competitions.api";

export const useCompetitionsStore = defineStore("competitions", () => {
    const userCompetitions = ref<competitionsApi.Competition[]>([]);
    const currentCompetition = ref<competitionsApi.Competition | null>(null);
    const loading = ref(false);
    const error = ref<string | null>(null);

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
            userCompetitions.value = result;
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
            userCompetitions.value.push(newCompetition);
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

            const joinedIdx = userCompetitions.value.findIndex((c) => c.id === competitionId);
            if (joinedIdx === -1) {
                userCompetitions.value.push(updated);
            } else {
                userCompetitions.value[joinedIdx] = updated;
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

    async function deleteCompetition(competitionId: string) {
        loading.value = true;
        error.value = null;
        try {
            await competitionsApi.deleteCompetition(competitionId);

            userCompetitions.value = userCompetitions.value.filter((c) => c.id !== competitionId);
            if (currentCompetition.value?.id === competitionId) {
                currentCompetition.value = null;
            }
        } catch (err: any) {
            error.value = err.response?.data?.error || "Failed to delete competition";
            throw err;
        } finally {
            loading.value = false;
        }
    }

    async function relinquishCompetition(competitionId: string) {
        loading.value = true;
        error.value = null;
        try {
            const updated = await competitionsApi.relinquishOwnership(competitionId);

            // update stored copies
            const idx = userCompetitions.value.findIndex((c) => c.id === competitionId);
            if (idx !== -1) {
                userCompetitions.value[idx] = updated;
            }
            if (currentCompetition.value?.id === competitionId) {
                currentCompetition.value = updated;
            }

            return updated;
        } catch (err: any) {
            error.value = err.response?.data?.error || "Failed to relinquish ownership";
            throw err;
        } finally {
            loading.value = false;
        }
    }

    async function claimOwnership(competitionId: string) {
        loading.value = true;
        error.value = null;
        try {
            const updated = await competitionsApi.claimOwnership(competitionId);

            const idx = userCompetitions.value.findIndex((c) => c.id === competitionId);
            if (idx !== -1) {
                userCompetitions.value[idx] = updated;
            }
            if (currentCompetition.value?.id === competitionId) {
                currentCompetition.value = updated;
            }

            return updated;
        } catch (err: any) {
            error.value = err.response?.data?.error || "Failed to claim ownership";
            throw err;
        } finally {
            loading.value = false;
        }
    }

    return {
        userCompetitions,
        currentCompetition,
        loading,
        error,
        fetchCompetitionById,
        fetchUserCompetitions,
        createCompetition,
        joinCompetition,
        deleteCompetition,
        relinquishCompetition,
        claimOwnership,
    };
});
