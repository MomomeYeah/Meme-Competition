<template>
    <div class="comp-card" @click="$emit('click')">
        <!-- Colour header band -->
        <div class="comp-card-header" :style="{ background: headerGradient }">
            <div :class="['comp-card-badge', competition.battle?.status === 'complete' ? 'comp-card-badge-complete' : '']">
                {{ competition.battle?.status === 'complete' ? 'Complete' : 'Active' }}
            </div>
        </div>

        <div class="comp-card-body">
            <h3 class="comp-card-title">{{ competition.title }}</h3>
            <p class="comp-card-meta">
                {{ competition.members.length }}
                {{ competition.members.length === 1 ? 'member' : 'members' }}
                &nbsp;·&nbsp;
                {{ formatDate(competition.createdAt) }}
            </p>
        </div>
    </div>
</template>

<script setup lang="ts">
    import { computed } from "vue";
    import { type Competition } from "../api/competitions.api";

    const props = defineProps<{
        competition: Competition;
    }>();

    defineEmits<{
        click: [];
    }>();

    // Generate a deterministic gradient from the competition title
    const headerGradient = computed(() => {
        let hash = 0;
        for (let i = 0; i < props.competition.title.length; i++) {
            hash = props.competition.title.charCodeAt(i) + ((hash << 5) - hash);
        }
        const hue = Math.abs(hash) % 60 + 160; // 160-220 range → teal/cyan family
        return `linear-gradient(135deg, hsl(${hue}, 80%, 8%) 0%, hsl(${hue + 20}, 70%, 12%) 100%)`;
    });

    function formatDate(dateString: string): string {
        return new Date(dateString).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
        });
    }
</script>

<style scoped>
    .comp-card {
        background: var(--bt-surface-container-low);
        border: 2px solid var(--bt-surface);
        cursor: pointer;
        overflow: hidden;
        position: relative;
        transition: border-color 0.2s, box-shadow 0.2s;
    }

    .comp-card:hover {
        border-color: var(--bt-primary);
        box-shadow: 0 0 24px color-mix(in srgb, var(--bt-primary) 35%, transparent);
    }

    .comp-card-header {
        aspect-ratio: 21 / 9;
        width: 100%;
        position: relative;
    }

    .comp-card-badge {
        position: absolute;
        top: 1rem;
        left: 1rem;
        background: var(--bt-tertiary-container);
        color: var(--bt-on-tertiary-container);
        padding: 0.2rem 0.6rem;
        font-family: var(--bt-font-headline);
        font-size: 0.6rem;
        font-weight: 700;
        letter-spacing: 0.15em;
        text-transform: uppercase;
    }

    .comp-card-badge-complete {
        background: rgba(0, 245, 255, 0.12);
        color: var(--bt-primary);
        border: 1px solid rgba(0, 245, 255, 0.3);
    }

    .comp-card-body {
        padding: 1.5rem 2rem;
    }

    .comp-card-title {
        font-family: var(--bt-font-headline);
        font-weight: 700;
        font-size: 1.25rem;
        letter-spacing: -0.01em;
        text-transform: uppercase;
        color: var(--bt-on-surface);
        line-height: 1.2;
        margin-bottom: 0.375rem;
    }

    .comp-card-meta {
        font-family: var(--bt-font-body);
        font-size: 0.8125rem;
        font-weight: 300;
        color: var(--bt-secondary);
    }

</style>
