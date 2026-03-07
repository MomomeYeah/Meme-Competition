<template>
    <v-card class="h-100 cursor-pointer p-4" @click="$emit('click')">
        <v-card-title>{{ competition.title }}</v-card-title>

        <v-card-text>
            <div class="mb-2">
                <span class="text-caption text-grey-darken-1">Created:</span>
                <span class="ml-2">{{ formatDate(competition.createdAt) }}</span>
            </div>

            <div class="mb-4">
                <span class="text-caption text-grey-darken-1">Members:</span>
                <span class="ml-2">{{ competition.members.length }}</span>
            </div>
        </v-card-text>

        <v-card-actions v-if="showJoinButton">
            <v-spacer />
            <v-btn color="primary" size="small" variant="outlined" @click.stop="$emit('join')"
                >Join</v-btn
            >
        </v-card-actions>
    </v-card>
</template>

<script setup lang="ts">
    interface Competition {
        id: string;
        title: string;
        owner: string;
        createdAt: string;
        members: string[];
    }

    defineProps<{
        competition: Competition;
        showJoinButton?: boolean;
    }>();

    defineEmits<{
        click: [];
        join: [];
    }>();

    function formatDate(dateString: string): string {
        return new Date(dateString).toLocaleDateString();
    }
</script>

<style scoped>
    .cursor-pointer {
        cursor: pointer;
    }
</style>
