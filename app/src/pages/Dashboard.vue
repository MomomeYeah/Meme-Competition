<template>
    <div class="dashboard">
        <!-- Stats row -->
        <section class="stats-row">
            <div class="stat-card stat-card-primary">
                <p class="stat-label">Competitions</p>
                <h2 class="stat-value">
                    {{ competitionsStore.userCompetitions.length }}
                    <span class="stat-unit">Total</span>
                </h2>
            </div>
            <div class="stat-card stat-card-tertiary">
                <p class="stat-label">Members</p>
                <h2 class="stat-value">{{ totalMembers }}</h2>
            </div>
            <div class="stat-card stat-card-outline">
                <p class="stat-label">Files Shared</p>
                <h2 class="stat-value">{{ totalFiles }}</h2>
            </div>
        </section>

        <!-- Page heading + CTA -->
        <section class="dashboard-hero">
            <h1 class="dashboard-heading">Dashboard</h1>
            <router-link class="hero-cta" to="/create-competition">
                Create Battle
            </router-link>
        </section>

        <!-- Competitions section -->
        <section class="competitions-section">
            <!-- Tabs -->
            <div class="comp-tabs">
                <button
                    :class="['comp-tab', activeTab === 'active' && 'comp-tab-active']"
                    type="button"
                    @click="activeTab = 'active'"
                >
                    Active Competitions
                </button>
                <button
                    :class="['comp-tab', activeTab === 'past' && 'comp-tab-active']"
                    type="button"
                    @click="activeTab = 'past'"
                >
                    Past Results
                </button>
            </div>

            <!-- Loading -->
            <div v-if="competitionsStore.loading" class="empty-state">
                <i class="mdi mdi-loading mdi-spin empty-icon"></i>
                <p>Loading battles...</p>
            </div>

            <!-- Empty state -->
            <div
                v-else-if="visibleCompetitions.length === 0"
                class="empty-state"
            >
                <i class="mdi mdi-sword-cross empty-icon"></i>
                <p v-if="activeTab === 'active'">
                    No active battles yet.
                </p>
                <p v-else>No past results yet.</p>
                <router-link
                    v-if="activeTab === 'active'"
                    class="empty-cta"
                    to="/create-competition"
                >
                    Create your first battle →
                </router-link>
            </div>

            <!-- Grid -->
            <div v-else class="comp-grid">
                <CompetitionCard
                    v-for="comp in visibleCompetitions"
                    :key="comp.id"
                    :competition="comp"
                    @click="router.push(`/competitions/${comp.id}`)"
                />
            </div>
        </section>
    </div>
</template>

<script setup lang="ts">
    import { ref, computed, onMounted } from "vue";
    import { useRouter } from "vue-router";
    import { useAuthStore } from "../stores/auth";
    import { useCompetitionsStore } from "../stores/competitions";
    import CompetitionCard from "../components/CompetitionCard.vue";

    const router = useRouter();
    const authStore = useAuthStore();
    const competitionsStore = useCompetitionsStore();

    const activeTab = ref<"active" | "past">("active");

    const totalMembers = computed(() =>
        competitionsStore.userCompetitions.reduce(
            (sum, c) => sum + c.members.length,
            0
        )
    );

    const totalFiles = computed(() =>
        competitionsStore.userCompetitions.reduce(
            (sum, c) => sum + (c.files?.length ?? 0),
            0
        )
    );

    // Without a status field, show all competitions in "active", none in "past"
    const visibleCompetitions = computed(() =>
        activeTab.value === "active" ? competitionsStore.userCompetitions : []
    );

    onMounted(async () => {
        if (authStore.user) {
            await competitionsStore.fetchUserCompetitions(authStore.user.id);
        }
    });
</script>

<style scoped>
    .dashboard {
        padding: 2rem;
        max-width: 1200px;
        margin: 0 auto;
    }

    /* ─── Stats ──────────────────────────────────────────────────── */
    .stats-row {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 1rem;
        margin-bottom: 2rem;
    }

    @media (max-width: 600px) {
        .stats-row {
            grid-template-columns: 1fr;
        }
    }

    .stat-card {
        background: var(--bt-surface-container-low);
        padding: 1rem 1.25rem;
        border-left: 3px solid transparent;
        display: flex;
        align-items: center;
        gap: 1rem;
    }

    .stat-card-primary {
        border-left-color: var(--bt-primary-container);
    }

    .stat-card-tertiary {
        border-left-color: var(--bt-tertiary);
    }

    .stat-card-outline {
        border-left-color: var(--bt-outline-variant);
    }

    .stat-label {
        font-family: var(--bt-font-headline);
        font-size: 0.625rem;
        font-weight: 600;
        letter-spacing: 0.15em;
        text-transform: uppercase;
        color: var(--bt-secondary);
        margin-bottom: 0.2rem;
    }

    .stat-value {
        font-family: var(--bt-font-headline);
        font-size: 1.75rem;
        font-weight: 700;
        letter-spacing: -0.04em;
        color: var(--bt-on-surface);
        line-height: 1;
    }

    .stat-unit {
        font-size: 0.875rem;
        color: var(--bt-primary-container);
        margin-left: 0.375rem;
    }

    /* ─── Hero ───────────────────────────────────────────────────── */
    .dashboard-hero {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 3rem;
        gap: 1.5rem;
        flex-wrap: wrap;
    }

    .dashboard-heading {
        font-family: var(--bt-font-headline);
        font-size: clamp(2.5rem, 6vw, 3.75rem);
        font-weight: 700;
        letter-spacing: -0.04em;
        text-transform: uppercase;
        color: var(--bt-on-surface);
        margin: 1rem;
        line-height: 1;
    }


    .hero-cta {
        flex-shrink: 0;
        padding: 1.125rem 2.5rem;
        background: linear-gradient(135deg, var(--bt-primary-container), var(--bt-primary));
        color: var(--bt-on-primary-container);
        font-family: var(--bt-font-headline);
        font-weight: 700;
        font-size: 0.75rem;
        letter-spacing: 0.2em;
        text-transform: uppercase;
        text-decoration: none;
        display: inline-block;
        transition: filter 0.2s, transform 0.1s;
    }

    .hero-cta:hover {
        filter: brightness(1.1);
    }

    .hero-cta:active {
        transform: scale(0.97);
    }

    /* ─── Competitions ───────────────────────────────────────────── */
    .comp-tabs {
        display: flex;
        align-items: center;
        gap: 3rem;
        margin-bottom: 2rem;
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }

    .comp-tab {
        padding-bottom: 1rem;
        font-family: var(--bt-font-headline);
        font-size: 0.75rem;
        font-weight: 700;
        letter-spacing: 0.15em;
        text-transform: uppercase;
        background: transparent;
        border: none;
        border-bottom: 2px solid transparent;
        cursor: pointer;
        color: rgba(175, 239, 221, 0.5);
        transition: color 0.2s;
        margin-bottom: -1px;
    }

    .comp-tab:hover {
        color: var(--bt-secondary);
    }

    .comp-tab-active {
        color: var(--bt-primary-container);
        border-bottom-color: var(--bt-primary-container);
    }

    .comp-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 2rem;
    }

    @media (max-width: 900px) {
        .comp-grid {
            grid-template-columns: 1fr;
        }
    }

    /* ─── Empty / Loading ────────────────────────────────────────── */
    .empty-state {
        text-align: center;
        padding: 4rem 2rem;
        color: var(--bt-secondary);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 1rem;
    }

    .empty-icon {
        font-size: 3rem;
        color: var(--bt-outline-variant);
    }

    .empty-state p {
        font-family: var(--bt-font-headline);
        font-size: 0.875rem;
        letter-spacing: 0.1em;
        text-transform: uppercase;
    }

    .empty-cta {
        font-family: var(--bt-font-headline);
        font-size: 0.75rem;
        letter-spacing: 0.1em;
        color: var(--bt-primary);
        text-decoration: none;
        transition: color 0.2s;
    }

    .empty-cta:hover {
        color: var(--bt-primary-container);
    }
</style>
