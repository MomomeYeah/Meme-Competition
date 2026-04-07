<template>
    <div :class="['chat-root', { 'chat-root--collapsed': collapsed }]">
        <div class="chat-header">
            <span class="chat-header-dot"></span>
            <span>LIVE CHAT</span>
            <button
                class="chat-toggle-btn"
                type="button"
                :aria-label="collapsed ? 'Expand chat' : 'Collapse chat'"
                @click="toggleCollapsed"
            >
                <i :class="['mdi', collapsed ? 'mdi-chevron-up' : 'mdi-chevron-down']"></i>
            </button>
        </div>

        <template v-if="!collapsed">
            <div class="chat-messages" aria-live="polite" aria-label="Chat messages">
                <template v-for="(entry, index) in messages" :key="entry.messageId">
                    <div v-if="entry.type === 'system'" class="chat-system" role="status">
                        <span class="system-text">{{ entry.text }}</span>
                    </div>
                    <div
                        v-else
                        :class="['chat-row', { 'chat-row-own': entry.userId === currentUserId }]"
                    >
                        <div class="chat-avatar" aria-hidden="true">
                            {{ entry.username.charAt(0).toUpperCase() }}
                        </div>
                        <div class="chat-bubble">
                            <div v-if="showMeta(index)" class="bubble-meta">
                                {{ entry.userId === currentUserId ? 'You' : entry.username }}
                                &middot;
                                {{ formatTime(entry.sentAt) }}
                            </div>
                            <div class="bubble-text">{{ entry.text }}</div>
                        </div>
                    </div>
                </template>
                <div ref="bottomRef"></div>
            </div>

            <div class="chat-input-bar">
                <textarea
                    ref="inputRef"
                    v-model="inputText"
                    class="chat-input"
                    placeholder="Say something..."
                    maxlength="200"
                    rows="1"
                    aria-label="Chat message"
                    @keydown.enter.exact.prevent="submit"
                    @input="autoResize"
                ></textarea>
                <button
                    class="chat-send-btn"
                    type="button"
                    :disabled="!inputText.trim()"
                    aria-label="Send message"
                    @click="submit"
                >
                    <i class="mdi mdi-send"></i>
                </button>
            </div>
        </template>
    </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onMounted } from 'vue';
import type { ChatEntry, ChatMessage } from '../composables/useBattleSocket';

const props = defineProps<{
    messages: ChatEntry[];
    currentUserId: string;
}>();

const emit = defineEmits<{
    send: [text: string];
}>();

const inputText = ref('');
const bottomRef = ref<HTMLElement | null>(null);
const inputRef = ref<HTMLTextAreaElement | null>(null);
const collapsed = ref(false);

// Collapse by default on mobile
onMounted(() => {
    if (window.innerWidth <= 900) {
        collapsed.value = true;
    }
});

watch(
    () => props.messages.length,
    async () => {
        if (collapsed.value) return;
        await nextTick();
        bottomRef.value?.scrollIntoView({ behavior: 'smooth' });
    },
);

/** Show the username/time header if this message starts a new "group":
 *  - first message, OR previous entry is a system message, OR different sender,
 *  OR same sender but more than 60 seconds since their last message. */
function showMeta(index: number): boolean {
    const entry = props.messages[index] as ChatMessage;
    if (index === 0) return true;
    const prev = props.messages[index - 1];
    if (!prev || prev.type === 'system') return true;
    const prevChat = prev as ChatMessage;
    if (prevChat.userId !== entry.userId) return true;
    return Date.parse(entry.sentAt) - Date.parse(prevChat.sentAt) > 60_000;
}

async function toggleCollapsed() {
    collapsed.value = !collapsed.value;
    if (!collapsed.value) {
        await nextTick();
        bottomRef.value?.scrollIntoView({ behavior: 'instant' });
    }
}

function submit() {
    const text = inputText.value.trim();
    if (!text) return;
    emit('send', text);
    inputText.value = '';
    // Reset textarea height after clearing
    nextTick(() => {
        if (inputRef.value) {
            inputRef.value.style.height = '';
        }
    });
}

function autoResize(event: Event) {
    const el = event.target as HTMLTextAreaElement;
    el.style.height = '';
    el.style.height = `${el.scrollHeight}px`;
}

function formatTime(iso: string): string {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
</script>

<style scoped>
.chat-root {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--bt-surface-container);
    border-top: 1px solid rgba(255, 255, 255, 0.04);
}

/* When collapsed, shrink to just the header height regardless of any parent sizing */
.chat-root--collapsed {
    flex: none !important;
    height: auto !important;
}

.chat-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    border-bottom: 1px solid rgba(0, 245, 255, 0.15);
    background: rgba(0, 245, 255, 0.05);
    font-family: var(--bt-font-label);
    font-size: 10px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--bt-primary);
    flex-shrink: 0;
}

.chat-header-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--bt-primary);
    flex-shrink: 0;
}

.chat-toggle-btn {
    margin-left: auto;
    background: none;
    border: none;
    color: var(--bt-primary);
    cursor: pointer;
    padding: 0;
    font-size: 16px;
    line-height: 1;
    display: flex;
    align-items: center;
    opacity: 0.7;
    transition: opacity 0.15s;
}

.chat-toggle-btn:hover {
    opacity: 1;
}

.chat-messages {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0.625rem 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    scrollbar-width: thin;
    scrollbar-color: var(--bt-outline-variant) transparent;
}

.chat-system {
    text-align: center;
    padding: 0.125rem 0;
}

.system-text {
    font-family: var(--bt-font-label);
    font-size: 0.6rem;
    letter-spacing: 0.1em;
    color: var(--bt-on-surface-variant);
    font-style: italic;
}

.chat-row {
    display: flex;
    align-items: flex-end;
    gap: 0.5rem;
    max-width: 90%;
}

.chat-row-own {
    flex-direction: row-reverse;
    align-self: flex-end;
}

.chat-avatar {
    width: 26px;
    /* Match the height of a single-line bubble: line height + vertical padding + 2px borders */
    height: calc(0.8125rem * 1.4 + 0.375rem * 2 + 2px);
    flex-shrink: 0;
    background: var(--bt-surface-container-highest);
    border: 1px solid rgba(255, 255, 255, 0.08);
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--bt-font-headline);
    font-weight: 700;
    font-size: 0.625rem;
    color: var(--bt-primary-container);
}

.chat-bubble {
    display: flex;
    flex-direction: column;
    gap: 0.175rem;
    max-width: 100%;
    min-width: 0;
}

.bubble-meta {
    font-family: var(--bt-font-label);
    font-size: 0.55rem;
    letter-spacing: 0.08em;
    color: var(--bt-on-surface-variant);
    text-transform: uppercase;
    padding: 0 0.4rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.chat-row-own .bubble-meta {
    text-align: right;
}

.bubble-text {
    padding: 0.375rem 0.6rem;
    font-family: var(--bt-font-body);
    font-size: 0.8125rem;
    line-height: 1.4;
    color: var(--bt-on-surface);
    background: var(--bt-surface-container-high);
    border: 1px solid rgba(255, 255, 255, 0.05);
    word-break: break-word;
    white-space: pre-wrap;
}

.chat-row-own .bubble-text {
    background: rgba(0, 245, 255, 0.1);
    border-color: rgba(0, 245, 255, 0.25);
}

.chat-input-bar {
    flex-shrink: 0;
    display: flex;
    align-items: flex-end;
    gap: 0.375rem;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    background: var(--bt-surface-container-low);
    padding: 0.5rem;
}

.chat-input {
    flex: 1;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.06);
    color: var(--bt-on-surface);
    font-family: var(--bt-font-body);
    font-size: 0.8125rem;
    padding: 0.45rem 0.75rem;
    outline: none;
    min-width: 0;
    resize: none;
    overflow-y: hidden;
    line-height: 1.4;
    max-height: 80px;
    transition: border-color 0.2s;
}

.chat-input:focus {
    border-color: rgba(0, 245, 255, 0.3);
}

.chat-input::placeholder {
    color: var(--bt-muted);
    font-size: 0.75rem;
}

.chat-send-btn {
    width: 34px;
    height: 34px;
    flex-shrink: 0;
    background: rgba(0, 245, 255, 0.12);
    border: 1px solid rgba(0, 245, 255, 0.2);
    color: var(--bt-primary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    transition: background 0.15s;
}

.chat-send-btn:hover:not(:disabled) {
    background: rgba(0, 245, 255, 0.22);
}

.chat-send-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
}
</style>
