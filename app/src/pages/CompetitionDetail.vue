<template>
    <div class="detail-page">
        <!-- Loading -->
        <div v-if="competitionsStore.loading && !competitionsStore.currentCompetition" class="state-screen">
            <i class="mdi mdi-loading mdi-spin state-icon"></i>
            <p class="state-label">Loading battle...</p>
        </div>

        <!-- Not found -->
        <div v-else-if="!competitionsStore.currentCompetition" class="state-screen">
            <i class="mdi mdi-alert-circle-outline state-icon"></i>
            <p class="state-label">Battle not found</p>
            <router-link class="state-link" to="/dashboard">← Back to Dashboard</router-link>
        </div>

        <!-- Main layout -->
        <template v-else>
            <div class="layout">
                <!-- ── Left: Main content ── -->
                <div class="main-panel">
                    <!-- Hero -->
                    <header class="hero">
                        <div class="hero-badges">
                            <span :class="effectiveBattleStatus === 'complete' ? 'badge-complete' : 'badge-live'">
                                {{ effectiveBattleStatus === 'complete' ? 'Complete' : 'Active' }}
                            </span>
                            <span class="hero-id">
                                ID: #{{ competitionsStore.currentCompetition.id.slice(0, 8).toUpperCase() }}
                            </span>
                        </div>
                        <h1 class="hero-title">
                            {{ competitionsStore.currentCompetition.title }}
                        </h1>
                        <div class="hero-meta">
                            <div class="hero-meta-item">
                                <span class="meta-label">Participants</span>
                                <span class="meta-value">
                                    {{ competitionsStore.currentCompetition.members.length }}
                                </span>
                            </div>
                            <div class="hero-meta-divider"></div>
                            <div class="hero-meta-item">
                                <span class="meta-label">Created</span>
                                <span class="meta-value">
                                    {{ formatDate(competitionsStore.currentCompetition.createdAt) }}
                                </span>
                            </div>
                        </div>
                    </header>

                    <!-- Battle view (shown when battle is active or complete) -->
                    <section v-if="effectiveBattleStatus !== 'idle'" class="section battle-section">
                        <!-- Active battle -->
                        <template v-if="effectiveBattleStatus === 'active'">
                            <div class="battle-header">
                                <span class="section-title">LIVE BATTLE</span>
                                <span class="battle-counter">
                                    ENTRY {{ battle.entryIndex.value + 1 }} / {{ battle.totalEntries.value }}
                                </span>
                            </div>

                            <!-- Meme frame -->
                            <div class="battle-meme-frame">
                                <img
                                    v-if="battle.currentFileUrl.value"
                                    :src="battle.currentFileUrl.value"
                                    class="battle-meme-img"
                                    alt="Current entry"
                                />
                                <div
                                    v-if="battle.currentUploaderId.value === authStore.user?.id"
                                    class="battle-own-overlay"
                                >
                                    <i class="mdi mdi-account-circle"></i>
                                    Your entry
                                </div>
                            </div>

                            <!-- Countdown bar -->
                            <div class="battle-countdown-track">
                                <div
                                    class="battle-countdown-fill"
                                    :style="{ width: countdownPercent + '%' }"
                                ></div>
                            </div>
                            <p class="battle-time-label">
                                {{ Math.ceil(battle.timeRemaining.value / 1000) }}s remaining
                            </p>

                            <!-- Vote stars -->
                            <div v-if="battle.currentUploaderId.value !== authStore.user?.id" class="vote-stars">
                                <button
                                    v-for="n in 5"
                                    :key="n"
                                    :class="['vote-star-btn', { 'vote-star-active': battle.myVote.value !== null && n <= battle.myVote.value }]"
                                    type="button"
                                    @click="battle.vote(n)"
                                >
                                    <i :class="['mdi', battle.myVote.value !== null && n <= battle.myVote.value ? 'mdi-star' : 'mdi-star-outline']"></i>
                                </button>
                                <span class="vote-label">
                                    {{ battle.myVote.value ? `${battle.myVote.value} / 5` : 'Cast your vote' }}
                                </span>
                            </div>
                            <p v-else class="vote-label">Voting disabled for your own entry</p>
                        </template>

                        <!-- Complete battle - results -->
                        <template v-else-if="effectiveBattleStatus === 'complete'">
                            <div class="battle-header">
                                <span class="section-title">BATTLE RESULTS</span>
                                <span class="battle-counter">COMPLETE</span>
                            </div>
                            <div class="results-grid">
                                <div
                                    v-for="file in sortedResultFiles"
                                    :key="file.id"
                                    class="result-card"
                                >
                                    <img
                                        v-if="isImage(file.name)"
                                        :src="file.url"
                                        :alt="file.name"
                                        class="result-img"
                                    />
                                    <div class="result-info">
                                        <p class="result-name">{{ file.name }}</p>
                                        <div class="result-stars">
                                            <i
                                                v-for="n in 5"
                                                :key="n"
                                                :class="['mdi', file.rating !== null && n <= Math.round(file.rating) ? 'mdi-star' : 'mdi-star-outline', 'result-star']"
                                            ></i>
                                            <span class="result-score">
                                                {{ file.rating !== null ? file.rating.toFixed(1) : 'N/A' }}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </template>
                    </section>

                    <!-- My Submissions (members only, lobby only) -->
                    <section v-if="isMember && effectiveBattleStatus === 'idle'" class="section">
                        <div class="section-header">
                            <h2 class="section-title">My Submissions</h2>
                            <span class="section-count">
                                {{ uploadedFiles.length }} file{{ uploadedFiles.length !== 1 ? 's' : '' }}
                            </span>
                        </div>

                        <div class="file-grid">
                            <!-- Uploaded files -->
                            <div
                                v-for="file in uploadedFiles"
                                :key="file.id"
                                class="file-slot file-slot-filled"
                                @click="openPreview(file)"
                            >
                                <img
                                    v-if="isImage(file.name)"
                                    :src="file.url"
                                    :alt="file.name"
                                    class="file-img"
                                />
                                <div v-else class="file-placeholder">
                                    <i class="mdi mdi-file-outline file-placeholder-icon"></i>
                                </div>
                                <div class="file-overlay">
                                    <button
                                        class="file-delete-btn"
                                        type="button"
                                        @click.stop="handleDeleteFile(file)"
                                    >
                                        <i class="mdi mdi-delete"></i>
                                        Delete
                                    </button>
                                </div>
                                <div class="file-name-bar">
                                    <p class="file-name">{{ file.name }}</p>
                                </div>
                            </div>

                            <!-- Upload slot -->
                            <button
                                class="file-slot file-slot-empty"
                                type="button"
                                :disabled="competitionsStore.loading"
                                @click="fileInputRef?.click()"
                            >
                                <i class="mdi mdi-plus-circle upload-slot-icon"></i>
                                <span class="upload-slot-label">Upload Entry</span>
                            </button>
                        </div>

                        <!-- Hidden file input -->
                        <input
                            ref="fileInputRef"
                            type="file"
                            class="hidden-input"
                            @change="onFileSelected"
                        />

                        <div v-if="uploadError" class="bt-auth-error">{{ uploadError }}</div>
                    </section>

                    <!-- Squad / Participants -->
                    <section class="section">
                        <h2 class="section-title">Squad / Participants</h2>
                        <div class="participants">
                            <div
                                v-for="member in memberDetails"
                                :key="member.id"
                                :class="[
                                    'participant',
                                    member.id === competitionsStore.currentCompetition.owner
                                        ? 'participant-owner'
                                        : 'participant-member',
                                ]"
                            >
                                <div class="participant-avatar">
                                    {{ member.username.charAt(0).toUpperCase() }}
                                </div>
                                <div>
                                    <p class="participant-name">{{ member.username }}</p>
                                    <p class="participant-role">
                                        {{
                                            member.id === competitionsStore.currentCompetition.owner
                                                ? 'Owner'
                                                : 'Member'
                                        }}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </section>
                </div>

                <!-- ── Right: Info + Actions ── -->
                <aside class="side-panel">
                    <div class="side-section">
                        <h3 class="side-title">Competition Info</h3>
                        <div class="info-row">
                            <span class="info-label">Owner</span>
                            <span class="info-value">
                                {{ ownerUsername ?? 'None' }}
                            </span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">Created</span>
                            <span class="info-value">
                                {{ formatDate(competitionsStore.currentCompetition.createdAt) }}
                            </span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">Participants</span>
                            <span class="info-value">
                                {{ competitionsStore.currentCompetition.members.length }}
                            </span>
                        </div>
                    </div>

                    <!-- Owner actions -->
                    <div v-if="isOwner" class="side-section">
                        <h3 class="side-title">Owner Actions</h3>
                        <div class="action-stack">
                            <button
                                v-if="effectiveBattleStatus === 'idle'"
                                class="action-btn action-btn-start"
                                type="button"
                                :disabled="startingBattle"
                                @click="handleStartBattle"
                            >
                                <i class="mdi mdi-sword-cross"></i>
                                {{ startingBattle ? 'Starting...' : 'Start the Battle' }}
                            </button>
                            <button
                                v-if="effectiveBattleStatus === 'idle'"
                                class="action-btn"
                                type="button"
                                @click="copyShareLink"
                            >
                                <i class="mdi mdi-link-variant"></i>
                                Copy Invite Link
                            </button>
                            <button
                                v-if="effectiveBattleStatus === 'idle'"
                                class="action-btn action-btn-warning"
                                type="button"
                                :disabled="competitionsStore.loading"
                                @click="handleRelinquish"
                            >
                                <i class="mdi mdi-account-arrow-right"></i>
                                Relinquish Ownership
                            </button>
                            <button
                                class="action-btn action-btn-danger"
                                type="button"
                                :disabled="competitionsStore.loading"
                                @click="handleDelete"
                            >
                                <i class="mdi mdi-delete-forever"></i>
                                Delete Battle
                            </button>
                        </div>
                    </div>

                    <!-- Claim ownership -->
                    <div v-else-if="isMember && isOwnerless && effectiveBattleStatus === 'idle'" class="side-section">
                        <h3 class="side-title">Ownership</h3>
                        <p class="side-note">This battle has no owner.</p>
                        <button
                            class="action-btn action-btn-primary"
                            type="button"
                            :disabled="competitionsStore.loading"
                            @click="handleClaim"
                        >
                            <i class="mdi mdi-crown"></i>
                            Claim Ownership
                        </button>
                    </div>

                    <div class="side-back">
                        <button class="back-btn" type="button" @click="router.push('/dashboard')">
                            <i class="mdi mdi-arrow-left"></i>
                            Dashboard
                        </button>
                    </div>
                </aside>
            </div>

            <!-- File preview lightbox -->
            <div v-if="selectedPreview" class="lightbox" @click.self="closePreview">
                <div class="lightbox-inner">
                    <div class="lightbox-header">
                        <span class="lightbox-name">{{ selectedPreview.name }}</span>
                        <button class="lightbox-close" type="button" @click="closePreview">
                            <i class="mdi mdi-close"></i>
                        </button>
                    </div>
                    <div class="lightbox-body">
                        <img
                            v-if="isImage(selectedPreview.name)"
                            :src="selectedPreview.url"
                            :alt="selectedPreview.name"
                            class="lightbox-img"
                        />
                        <div v-else class="lightbox-file">
                            <i class="mdi mdi-file-outline lightbox-file-icon"></i>
                            <p>{{ selectedPreview.name }}</p>
                            <a :href="selectedPreview.url" target="_blank" class="lightbox-download">
                                Download file
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        </template>

        <!-- Toast -->
        <div
            v-if="toast.visible"
            :class="['toast', `toast-${toast.type}`]"
        >
            {{ toast.message }}
        </div>
    </div>
</template>

<script setup lang="ts">
    import { computed, onMounted, reactive, ref, watch } from "vue";
    import { useRoute, useRouter } from "vue-router";
    import { useAuthStore } from "../stores/auth";
    import { useCompetitionsStore } from "../stores/competitions";
    import type * as competitionsApi from "../api/competitions.api";
    import { startBattle as apiBattleStart } from "../api/competitions.api";
    import { useBattleSocket } from "../composables/useBattleSocket";

    const router = useRouter();
    const route = useRoute();
    const competitionsStore = useCompetitionsStore();
    const authStore = useAuthStore();

    const competitionId = route.params.id as string;

    const battle = useBattleSocket();
    const startingBattle = ref(false);

    const effectiveBattleStatus = computed(() => {
        if (battle.battleStatus.value !== 'idle') return battle.battleStatus.value;
        return (competitionsStore.currentCompetition as any)?.battle?.status ?? 'idle';
    });

    const countdownPercent = computed(() => {
        const duration = battle.entryDurationMs.value || 8000;
        return Math.min(100, Math.max(0, (battle.timeRemaining.value / duration) * 100));
    });

    const sortedResultFiles = computed(() => {
        const files = competitionsStore.currentCompetition?.files ?? [];
        return [...files].sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
    });

    const fileInputRef = ref<HTMLInputElement | null>(null);
    const uploadedFiles = ref<competitionsApi.CompetitionFile[]>([]);
    const selectedPreview = ref<competitionsApi.CompetitionFile | null>(null);
    const uploadError = ref("");

    const toast = reactive({ visible: false, message: "", type: "success" as "success" | "error" });
    let toastTimer: ReturnType<typeof setTimeout> | null = null;

    function showToast(message: string, type: "success" | "error" = "success") {
        toast.message = message;
        toast.type = type;
        toast.visible = true;
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            toast.visible = false;
        }, 3000);
    }

    const isOwner = computed(
        () => authStore.user && competitionsStore.currentCompetition?.owner === authStore.user.id
    );

    const isMember = computed(() => {
        if (!authStore.user || !competitionsStore.currentCompetition) return false;
        return competitionsStore.currentCompetition.members.includes(authStore.user.id);
    });

    const isOwnerless = computed(
        () => competitionsStore.currentCompetition && !competitionsStore.currentCompetition.owner
    );

    /** memberDetails from the API, falling back to bare IDs if absent */
    const memberDetails = computed(() =>
        competitionsStore.currentCompetition?.memberDetails ??
        (competitionsStore.currentCompetition?.members ?? []).map((id) => ({ id, username: id }))
    );

    /** Display name for the current owner */
    const ownerUsername = computed(() => {
        const ownerId = competitionsStore.currentCompetition?.owner;
        if (!ownerId) return null;
        return memberDetails.value.find((m) => m.id === ownerId)?.username ?? ownerId;
    });

    onMounted(async () => {
        try {
            await competitionsStore.fetchCompetitionById(competitionId);
            if (competitionsStore.currentCompetition && authStore.user) {
                uploadedFiles.value = await competitionsStore.fetchFiles(competitionId);
                battle.connect(competitionId);
            }
        } catch {
            router.push("/dashboard");
        }
    });

    // Re-fetch competition when battle completes so file ratings are populated
    watch(battle.battleStatus, async (status) => {
        if (status === 'complete') {
            await competitionsStore.fetchCompetitionById(competitionId);
        }
    });

    async function handleStartBattle() {
        startingBattle.value = true;
        try {
            await apiBattleStart(competitionId);
            // WS will broadcast ENTRY_ADVANCE to all subscribers including us
        } catch (err: any) {
            showToast(err.response?.data?.error || "Failed to start battle", "error");
        } finally {
            startingBattle.value = false;
        }
    }

    function formatDate(dateString: string): string {
        return new Date(dateString).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
        });
    }

    function isImage(filename: string): boolean {
        return /\.(jpe?g|png|gif|webp|avif|svg)$/i.test(filename);
    }

    function openPreview(file: competitionsApi.CompetitionFile) {
        selectedPreview.value = file;
    }

    function closePreview() {
        selectedPreview.value = null;
    }

    function copyShareLink() {
        const url = `${window.location.origin}/invite/${competitionId}`;
        navigator.clipboard.writeText(url).then(() => showToast("Invite link copied"));
    }

    async function onFileSelected(event: Event) {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) return;
        uploadError.value = "";
        try {
            await competitionsStore.uploadFile(competitionId, file);
            uploadedFiles.value = await competitionsStore.fetchFiles(competitionId);
            showToast("File uploaded");
        } catch (err: any) {
            uploadError.value = err.response?.data?.error || "Upload failed";
        } finally {
            input.value = "";
        }
    }

    async function handleDeleteFile(file: competitionsApi.CompetitionFile) {
        if (!confirm("Delete this file?")) return;
        try {
            await competitionsStore.deleteFile(competitionId, file.id);
            uploadedFiles.value = uploadedFiles.value.filter((f) => f.id !== file.id);
            showToast("File deleted");
        } catch (err: any) {
            showToast(err.response?.data?.error || "Failed to delete file", "error");
        }
    }

    async function handleRelinquish() {
        if (!confirm("Relinquish ownership of this battle?")) return;
        try {
            await competitionsStore.relinquishCompetition(competitionId);
            showToast("Ownership relinquished");
        } catch (err: any) {
            showToast(err.response?.data?.error || "Failed to relinquish ownership", "error");
        }
    }

    async function handleClaim() {
        try {
            await competitionsStore.claimOwnership(competitionId);
            showToast("You are now the owner");
        } catch (err: any) {
            showToast(err.response?.data?.error || "Failed to claim ownership", "error");
        }
    }

    async function handleDelete() {
        if (!confirm("Delete this battle? This cannot be undone.")) return;
        try {
            await competitionsStore.deleteCompetition(competitionId);
            showToast("Battle deleted");
            router.push("/dashboard");
        } catch (err: any) {
            showToast(err.response?.data?.error || "Failed to delete battle", "error");
        }
    }
</script>

<style scoped>
    .detail-page {
        min-height: calc(100vh - var(--bt-header-height));
        background: var(--bt-surface);
        position: relative;
    }

    /* ─── State screens (loading / not found) ──────────────────── */
    .state-screen {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 1rem;
        height: calc(100vh - var(--bt-header-height));
        color: var(--bt-secondary);
    }

    .state-icon {
        font-size: 3rem;
        color: var(--bt-outline-variant);
    }

    .state-label {
        font-family: var(--bt-font-headline);
        font-size: 0.875rem;
        letter-spacing: 0.1em;
        text-transform: uppercase;
    }

    .state-link {
        font-family: var(--bt-font-headline);
        font-size: 0.75rem;
        letter-spacing: 0.1em;
        color: var(--bt-primary);
        text-decoration: none;
        transition: color 0.2s;
    }

    .state-link:hover {
        color: var(--bt-primary-container);
    }

    /* ─── Layout ────────────────────────────────────────────────── */
    .layout {
        display: flex;
        height: calc(100vh - var(--bt-header-height));
        overflow: hidden;
    }

    .main-panel {
        flex: 1;
        overflow-y: auto;
        padding: 3rem;
    }

    .side-panel {
        width: 300px;
        flex-shrink: 0;
        border-left: 1px solid rgba(255, 255, 255, 0.04);
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 0;
    }

    @media (max-width: 900px) {
        .layout {
            flex-direction: column;
            height: auto;
            overflow: visible;
        }

        .main-panel {
            padding: 1.5rem;
        }

        .side-panel {
            width: 100%;
            border-left: none;
            border-top: 1px solid rgba(255, 255, 255, 0.04);
        }
    }

    /* ─── Hero ──────────────────────────────────────────────────── */
    .hero {
        margin-bottom: 3rem;
    }

    .hero-badges {
        display: flex;
        align-items: center;
        gap: 1rem;
        margin-bottom: 1rem;
    }

    .badge-live {
        background: var(--bt-secondary-container);
        color: var(--bt-on-secondary-container);
        padding: 0.2rem 0.6rem;
        font-family: var(--bt-font-headline);
        font-size: 0.625rem;
        font-weight: 700;
        letter-spacing: 0.2em;
        text-transform: uppercase;
    }

    .badge-complete {
        background: rgba(0, 245, 255, 0.1);
        color: var(--bt-primary);
        border: 1px solid rgba(0, 245, 255, 0.3);
        padding: 0.2rem 0.6rem;
        font-family: var(--bt-font-headline);
        font-size: 0.625rem;
        font-weight: 700;
        letter-spacing: 0.2em;
        text-transform: uppercase;
    }

    .hero-id {
        font-family: var(--bt-font-label);
        font-size: 0.625rem;
        letter-spacing: 0.2em;
        text-transform: uppercase;
        color: var(--bt-muted);
    }

    .hero-title {
        font-family: var(--bt-font-headline);
        font-size: clamp(2rem, 5vw, 3.75rem);
        font-weight: 700;
        letter-spacing: -0.04em;
        text-transform: uppercase;
        color: var(--bt-on-surface);
        line-height: 1;
        margin-bottom: 1.5rem;
    }

    .hero-meta {
        display: flex;
        align-items: center;
        gap: 1.5rem;
    }

    .hero-meta-item {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
    }

    .meta-label {
        font-family: var(--bt-font-label);
        font-size: 0.625rem;
        letter-spacing: 0.2em;
        text-transform: uppercase;
        color: var(--bt-muted);
    }

    .meta-value {
        font-family: var(--bt-font-headline);
        font-size: 1.5rem;
        font-weight: 300;
        color: var(--bt-primary);
    }

    .hero-meta-divider {
        width: 1px;
        height: 2.5rem;
        background: var(--bt-surface-container-high);
    }

    /* ─── Sections ──────────────────────────────────────────────── */
    .section {
        margin-bottom: 3rem;
    }

    .section-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1.25rem;
    }

    .section-title {
        font-family: var(--bt-font-headline);
        font-size: 0.6875rem;
        font-weight: 700;
        letter-spacing: 0.2em;
        text-transform: uppercase;
        color: var(--bt-primary);
    }

    .section-count {
        font-family: var(--bt-font-label);
        font-size: 0.625rem;
        letter-spacing: 0.15em;
        text-transform: uppercase;
        color: var(--bt-muted);
    }

    /* ─── File grid ─────────────────────────────────────────────── */
    .file-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        gap: 1rem;
        margin-bottom: 1.25rem;
    }

    .file-slot {
        aspect-ratio: 1;
        position: relative;
        overflow: hidden;
    }

    .file-slot-filled {
        background: var(--bt-surface-container-highest);
        border: 1px solid rgba(0, 245, 255, 0.15);
        cursor: pointer;
    }

    .file-img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        opacity: 0.8;
        display: block;
    }

    .file-placeholder {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .file-placeholder-icon {
        font-size: 2.5rem;
        color: var(--bt-outline-variant);
    }

    .file-overlay {
        position: absolute;
        inset: 0;
        background: rgba(10, 12, 16, 0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity 0.2s;
    }

    .file-slot-filled:hover .file-overlay {
        opacity: 1;
    }

    .file-delete-btn {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        background: var(--bt-error);
        color: #fff;
        border: none;
        cursor: pointer;
        padding: 0.5rem 0.875rem;
        font-family: var(--bt-font-headline);
        font-size: 0.6rem;
        font-weight: 700;
        letter-spacing: 0.15em;
        text-transform: uppercase;
        transition: filter 0.2s;
    }

    .file-delete-btn:hover {
        filter: brightness(1.15);
    }

    .file-name-bar {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        padding: 0.5rem;
        background: linear-gradient(transparent, rgba(0, 0, 0, 0.8));
    }

    .file-name {
        font-family: var(--bt-font-label);
        font-size: 0.5625rem;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--bt-on-surface);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .file-slot-empty {
        background: var(--bt-surface-container-low);
        border: 1px dashed var(--bt-surface-container-high);
        cursor: pointer;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        transition: border-color 0.2s, background 0.2s;
    }

    .file-slot-empty:hover:not(:disabled) {
        border-color: rgba(0, 245, 255, 0.4);
        background: var(--bt-surface-container);
    }

    .file-slot-empty:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .upload-slot-icon {
        font-size: 1.75rem;
        color: var(--bt-outline-variant);
        transition: color 0.2s;
    }

    .file-slot-empty:hover:not(:disabled) .upload-slot-icon {
        color: var(--bt-primary);
    }

    .upload-slot-label {
        font-family: var(--bt-font-label);
        font-size: 0.5625rem;
        letter-spacing: 0.15em;
        text-transform: uppercase;
        color: var(--bt-muted);
        transition: color 0.2s;
    }

    .file-slot-empty:hover:not(:disabled) .upload-slot-label {
        color: var(--bt-primary);
    }

    .hidden-input {
        display: none;
    }

    /* ─── Participants ───────────────────────────────────────────── */
    .participants {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
    }

    .participant {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        background: var(--bt-surface-container-high);
        padding: 0.75rem 1rem;
        border-left: 2px solid transparent;
    }

    .participant-owner {
        border-left-color: var(--bt-primary);
    }

    .participant-member {
        border-left-color: var(--bt-outline-variant);
    }

    .participant-avatar {
        width: 32px;
        height: 32px;
        background: var(--bt-surface-container-highest);
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: var(--bt-font-headline);
        font-size: 0.75rem;
        font-weight: 700;
        color: var(--bt-primary-container);
        flex-shrink: 0;
    }

    .participant-name {
        font-family: var(--bt-font-label);
        font-size: 0.6875rem;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--bt-on-surface);
    }

    .participant-role {
        font-family: var(--bt-font-label);
        font-size: 0.5625rem;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--bt-muted);
        margin-top: 2px;
    }

    /* ─── Side panel ────────────────────────────────────────────── */
    .side-section {
        padding: 1.5rem;
        border-bottom: 1px solid rgba(255, 255, 255, 0.04);
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }

    .side-title {
        font-family: var(--bt-font-headline);
        font-size: 0.6rem;
        font-weight: 700;
        letter-spacing: 0.2em;
        text-transform: uppercase;
        color: var(--bt-primary);
        margin-bottom: 0.25rem;
    }

    .info-row {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 0.5rem;
    }

    .info-label {
        font-family: var(--bt-font-label);
        font-size: 0.6rem;
        letter-spacing: 0.15em;
        text-transform: uppercase;
        color: var(--bt-muted);
        flex-shrink: 0;
    }

    .info-value {
        font-family: var(--bt-font-label);
        font-size: 0.6875rem;
        color: var(--bt-on-surface-variant);
        text-align: right;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 160px;
    }

    .action-stack {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .action-btn {
        display: flex;
        align-items: center;
        gap: 0.625rem;
        padding: 0.75rem 1rem;
        background: var(--bt-surface-container);
        border: 1px solid rgba(255, 255, 255, 0.05);
        color: var(--bt-secondary);
        font-family: var(--bt-font-headline);
        font-size: 0.625rem;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        cursor: pointer;
        width: 100%;
        text-align: left;
        transition: background 0.15s, color 0.15s, border-color 0.15s;
    }

    .action-btn:hover:not(:disabled) {
        background: var(--bt-surface-container-high);
        color: var(--bt-on-surface);
    }

    .action-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .action-btn .mdi {
        font-size: 15px;
        flex-shrink: 0;
    }

    .action-btn-primary {
        border-color: rgba(0, 245, 255, 0.2);
        color: var(--bt-primary);
    }

    .action-btn-primary:hover:not(:disabled) {
        background: rgba(0, 245, 255, 0.06);
        border-color: rgba(0, 245, 255, 0.4);
        color: var(--bt-primary-container);
    }

    .action-btn-warning {
        color: var(--bt-tertiary);
    }

    .action-btn-warning:hover:not(:disabled) {
        color: var(--bt-tertiary);
        background: rgba(110, 254, 0, 0.04);
    }

    .action-btn-danger {
        color: var(--bt-error-dim);
    }

    .action-btn-danger:hover:not(:disabled) {
        background: rgba(215, 56, 59, 0.08);
        color: var(--bt-error);
    }

    .side-note {
        font-family: var(--bt-font-body);
        font-size: 0.75rem;
        color: var(--bt-on-surface-variant);
    }

    .side-back {
        padding: 1.5rem;
        margin-top: auto;
    }

    .back-btn {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        background: transparent;
        border: none;
        color: var(--bt-muted);
        font-family: var(--bt-font-headline);
        font-size: 0.625rem;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        cursor: pointer;
        padding: 0;
        transition: color 0.2s;
    }

    .back-btn:hover {
        color: var(--bt-on-surface);
    }

    /* ─── Lightbox ──────────────────────────────────────────────── */
    .lightbox {
        position: fixed;
        inset: 0;
        z-index: 500;
        background: rgba(0, 0, 0, 0.85);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 2rem;
    }

    .lightbox-inner {
        background: var(--bt-surface-container-high);
        border: 1px solid rgba(255, 255, 255, 0.06);
        max-width: 800px;
        width: 100%;
        max-height: 90vh;
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    .lightbox-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 1rem 1.25rem;
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        flex-shrink: 0;
    }

    .lightbox-name {
        font-family: var(--bt-font-label);
        font-size: 0.75rem;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--bt-on-surface);
    }

    .lightbox-close {
        background: transparent;
        border: none;
        cursor: pointer;
        color: var(--bt-muted);
        font-size: 20px;
        line-height: 1;
        padding: 0.25rem;
        transition: color 0.2s;
    }

    .lightbox-close:hover {
        color: var(--bt-on-surface);
    }

    .lightbox-body {
        overflow: auto;
        padding: 1.5rem;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .lightbox-img {
        max-width: 100%;
        max-height: 70vh;
        object-fit: contain;
        display: block;
    }

    .lightbox-file {
        text-align: center;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 1rem;
        color: var(--bt-secondary);
    }

    .lightbox-file-icon {
        font-size: 4rem;
        color: var(--bt-outline-variant);
    }

    .lightbox-download {
        color: var(--bt-primary);
        font-family: var(--bt-font-headline);
        font-size: 0.75rem;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        text-decoration: none;
        transition: color 0.2s;
    }

    .lightbox-download:hover {
        color: var(--bt-primary-container);
    }

    /* ─── Start Battle button ──────────────────────────────────── */
    .action-btn-start {
        border-color: rgba(0, 245, 255, 0.35);
        color: var(--bt-primary);
        background: rgba(0, 245, 255, 0.04);
    }

    .action-btn-start:hover:not(:disabled) {
        background: rgba(0, 245, 255, 0.1);
        border-color: var(--bt-primary);
        color: #fff;
    }

    /* ─── Battle section ────────────────────────────────────────── */
    .battle-section {
        border: 1px solid rgba(0, 245, 255, 0.2);
        padding: 1.5rem;
        background: rgba(0, 245, 255, 0.02);
        margin-bottom: 3rem;
    }

    .battle-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1.25rem;
    }

    .battle-counter {
        font-family: var(--bt-font-label);
        font-size: 0.625rem;
        letter-spacing: 0.2em;
        text-transform: uppercase;
        color: var(--bt-muted);
    }

    .battle-meme-frame {
        position: relative;
        width: 100%;
        max-height: 60vh;
        background: var(--bt-surface-container-high);
        border: 1px solid rgba(0, 245, 255, 0.15);
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        margin-bottom: 1rem;
    }

    .battle-meme-img {
        max-width: 100%;
        max-height: 60vh;
        object-fit: contain;
        display: block;
    }

    .battle-own-overlay {
        position: absolute;
        top: 0.75rem;
        right: 0.75rem;
        background: rgba(0, 245, 255, 0.15);
        border: 1px solid rgba(0, 245, 255, 0.4);
        color: var(--bt-primary);
        font-family: var(--bt-font-label);
        font-size: 0.6rem;
        font-weight: 700;
        letter-spacing: 0.15em;
        text-transform: uppercase;
        padding: 0.3rem 0.6rem;
        display: flex;
        align-items: center;
        gap: 0.375rem;
    }

    .battle-countdown-track {
        height: 4px;
        background: var(--bt-surface-container-high);
        margin-bottom: 0.375rem;
        overflow: hidden;
    }

    .battle-countdown-fill {
        height: 100%;
        background: var(--bt-primary);
        transition: width 100ms linear;
        box-shadow: 0 0 8px rgba(0, 245, 255, 0.6);
    }

    .battle-time-label {
        font-family: var(--bt-font-label);
        font-size: 0.625rem;
        letter-spacing: 0.15em;
        text-transform: uppercase;
        color: var(--bt-muted);
        margin-bottom: 1.25rem;
    }

    .vote-stars {
        display: flex;
        align-items: center;
        gap: 0.375rem;
    }

    .vote-star-btn {
        background: transparent;
        border: none;
        cursor: pointer;
        color: var(--bt-outline-variant);
        font-size: 1.75rem;
        line-height: 1;
        padding: 0.125rem;
        transition: color 0.15s, transform 0.1s;
    }

    .vote-star-btn:hover {
        color: var(--bt-primary);
        transform: scale(1.15);
    }

    .vote-star-active {
        color: var(--bt-primary);
    }

    .vote-label {
        font-family: var(--bt-font-label);
        font-size: 0.625rem;
        letter-spacing: 0.15em;
        text-transform: uppercase;
        color: var(--bt-muted);
        margin-left: 0.5rem;
    }

    /* ─── Results grid ──────────────────────────────────────────── */
    .results-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
        gap: 1rem;
    }

    .result-card {
        background: var(--bt-surface-container-high);
        border: 1px solid rgba(255, 255, 255, 0.04);
        overflow: hidden;
    }

    .result-img {
        width: 100%;
        aspect-ratio: 1;
        object-fit: cover;
        display: block;
        opacity: 0.85;
    }

    .result-info {
        padding: 0.625rem;
    }

    .result-name {
        font-family: var(--bt-font-label);
        font-size: 0.5625rem;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--bt-on-surface-variant);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        margin-bottom: 0.375rem;
    }

    .result-stars {
        display: flex;
        align-items: center;
        gap: 2px;
    }

    .result-star {
        font-size: 0.875rem;
        color: var(--bt-outline-variant);
    }

    .result-star.mdi-star {
        color: var(--bt-primary);
    }

    .result-score {
        font-family: var(--bt-font-label);
        font-size: 0.6875rem;
        font-weight: 700;
        color: var(--bt-primary);
        margin-left: 0.375rem;
    }

    /* ─── Toast ─────────────────────────────────────────────────── */
    .toast {
        position: fixed;
        bottom: 2rem;
        left: 50%;
        transform: translateX(-50%);
        padding: 0.75rem 1.5rem;
        font-family: var(--bt-font-headline);
        font-size: 0.6875rem;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        z-index: 1000;
        pointer-events: none;
        white-space: nowrap;
    }

    .toast-success {
        background: var(--bt-surface-container-highest);
        border: 1px solid rgba(0, 245, 255, 0.3);
        color: var(--bt-primary);
    }

    .toast-error {
        background: var(--bt-surface-container-highest);
        border: 1px solid rgba(215, 56, 59, 0.4);
        color: var(--bt-error);
    }
</style>
