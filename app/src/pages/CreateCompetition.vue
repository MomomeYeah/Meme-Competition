<template>
    <div class="create-page">
        <div class="create-inner">
            <div class="bt-console-frame">
                <div class="bt-scanner-line"></div>

                <div class="bt-panel-header">
                    <span>New Battle Configuration</span>
                    <i class="mdi mdi-sword-cross"></i>
                </div>

                <div class="form-body">
                    <h1 class="form-heading">Create New Battle</h1>

                    <form @submit.prevent="handleCreateCompetition">
                        <div class="bt-field-group">
                            <label class="bt-field-label" for="title">Battle Title</label>
                            <div :class="['bt-field-wrapper', errors.title && 'bt-field-error-state']">
                                <div class="bt-field-accent"></div>
                                <i class="mdi mdi-sword-cross bt-field-icon"></i>
                                <input
                                    id="title"
                                    v-model="formData.title"
                                    class="bt-field-input"
                                    type="text"
                                    placeholder="ENTER BATTLE NAME"
                                    autocomplete="off"
                                />
                            </div>
                            <span v-if="errors.title" class="bt-field-error-msg">
                                {{ errors.title }}
                            </span>
                        </div>

                        <div v-if="competitionsStore.error" class="bt-auth-error">
                            {{ competitionsStore.error }}
                        </div>

                        <div class="form-actions">
                            <button class="cancel-btn" type="button" @click="router.back()">
                                Cancel
                            </button>
                            <button
                                class="bt-submit-btn"
                                type="submit"
                                :disabled="competitionsStore.loading"
                            >
                                <span>
                                    {{ competitionsStore.loading ? 'Deploying...' : 'Deploy Battle' }}
                                </span>
                                <i class="mdi mdi-rocket-launch"></i>
                            </button>
                        </div>
                    </form>
                </div>

            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
    import { reactive } from "vue";
    import { useRouter } from "vue-router";
    import { useCompetitionsStore } from "../stores/competitions";

    const router = useRouter();
    const competitionsStore = useCompetitionsStore();

    const formData = reactive({ title: "" });
    const errors = reactive({ title: "" });

    async function handleCreateCompetition() {
        errors.title = "";

        if (!formData.title.trim()) {
            errors.title = "Title is required";
            return;
        }

        try {
            const newCompetition = await competitionsStore.createCompetition(formData.title);
            router.push(`/competitions/${newCompetition.id}`);
        } catch {
            // Error is handled by store
        }
    }
</script>

<style scoped>
    .create-page {
        min-height: calc(100vh - var(--bt-header-height));
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 2rem 1rem;
        background: var(--bt-surface);
    }

    .create-inner {
        width: 100%;
        max-width: 520px;
    }

    .form-body {
        padding: 2.5rem 3rem;
        display: flex;
        flex-direction: column;
        gap: 2rem;
    }

    @media (max-width: 600px) {
        .form-body {
            padding: 1.5rem;
        }
    }

    .form-heading {
        font-family: var(--bt-font-headline);
        font-size: 1.75rem;
        font-weight: 700;
        letter-spacing: -0.03em;
        text-transform: uppercase;
        color: var(--bt-on-surface);
    }

    .form-actions {
        display: flex;
        gap: 1rem;
        margin-top: 0.5rem;
    }

    .cancel-btn {
        padding: 1.25rem 2rem;
        background: transparent;
        border: 1px solid var(--bt-outline-variant);
        color: var(--bt-on-surface-variant);
        font-family: var(--bt-font-headline);
        font-weight: 700;
        font-size: 0.75rem;
        letter-spacing: 0.15em;
        text-transform: uppercase;
        cursor: pointer;
        transition: border-color 0.2s, color 0.2s;
    }

    .cancel-btn:hover {
        border-color: var(--bt-outline);
        color: var(--bt-on-surface);
    }
</style>
