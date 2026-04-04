import { ref, onUnmounted, type Ref } from 'vue';

export type BattleStatus = 'idle' | 'active' | 'complete';

export interface FinalRating {
    fileId: string;
    averageRating: number;
}

export interface UseBattleSocket {
    connected: Ref<boolean>;
    battleStatus: Ref<BattleStatus>;
    currentFileId: Ref<string | null>;
    currentFileUrl: Ref<string | null>;
    currentUploaderId: Ref<string | null>;
    entryIndex: Ref<number>;
    totalEntries: Ref<number>;
    timeRemaining: Ref<number>;
    entryDurationMs: Ref<number>;
    myVote: Ref<number | null>;
    finalRatings: Ref<FinalRating[]>;
    connect: (competitionId: string) => void;
    disconnect: () => void;
    vote: (rating: number) => void;
}

const WS_BASE = (import.meta.env.VITE_WS_URL ?? 'ws://localhost:3000') + '/ws';

export function useBattleSocket(): UseBattleSocket {
    const connected = ref(false);
    const battleStatus = ref<BattleStatus>('idle');
    const currentFileId = ref<string | null>(null);
    const currentFileUrl = ref<string | null>(null);
    const currentUploaderId = ref<string | null>(null);
    const entryIndex = ref(0);
    const totalEntries = ref(0);
    const timeRemaining = ref(0);
    const entryDurationMs = ref(5000);
    const myVote = ref<number | null>(null);
    const finalRatings = ref<FinalRating[]>([]);

    let ws: WebSocket | null = null;
    let countdownInterval: ReturnType<typeof setInterval> | null = null;
    let entryStartedAt = 0;
    let currentEntryDurationMs = 5000;
    let subscribedCompetitionId: string | null = null;

    function startCountdown(startedAt: string, durationMs: number): void {
        entryStartedAt = Date.parse(startedAt);
        currentEntryDurationMs = durationMs;
        entryDurationMs.value = durationMs;

        if (countdownInterval) clearInterval(countdownInterval);
        countdownInterval = setInterval(() => {
            const remaining = entryStartedAt + currentEntryDurationMs - Date.now();
            timeRemaining.value = Math.max(0, remaining);
        }, 100);
    }

    function stopCountdown(): void {
        if (countdownInterval) {
            clearInterval(countdownInterval);
            countdownInterval = null;
        }
    }

    function handleMessage(event: MessageEvent): void {
        let msg: any;
        try {
            msg = JSON.parse(event.data as string);
        } catch {
            return;
        }

        switch (msg.type) {
            case 'BATTLE_STATE': {
                const p = msg.payload;
                battleStatus.value = p.status;
                currentFileId.value = p.fileId;
                currentFileUrl.value = p.fileUrl;
                currentUploaderId.value = p.uploaderId;
                entryIndex.value = p.currentIndex;
                totalEntries.value = p.totalEntries;
                myVote.value = null;
                startCountdown(p.entryStartedAt, p.entryDurationMs);
                break;
            }
            case 'ENTRY_ADVANCE': {
                const p = msg.payload;
                battleStatus.value = 'active';
                currentFileId.value = p.fileId;
                currentFileUrl.value = p.fileUrl;
                currentUploaderId.value = p.uploaderId;
                entryIndex.value = p.currentIndex;
                totalEntries.value = p.totalEntries;
                myVote.value = null;
                startCountdown(p.entryStartedAt, p.entryDurationMs);
                break;
            }
            case 'VOTE_ACK': {
                myVote.value = msg.payload.rating;
                break;
            }
            case 'BATTLE_COMPLETE': {
                battleStatus.value = 'complete';
                finalRatings.value = msg.payload.finalRatings;
                stopCountdown();
                timeRemaining.value = 0;
                break;
            }
        }
    }

    function connect(competitionId: string): void {
        if (ws) {
            ws.close();
            ws = null;
        }
        subscribedCompetitionId = competitionId;
        ws = new WebSocket(WS_BASE);

        ws.onopen = () => {
            connected.value = true;
            ws!.send(JSON.stringify({ type: 'SUBSCRIBE', payload: { competitionId } }));
        };

        ws.onmessage = handleMessage;

        ws.onclose = () => {
            connected.value = false;
        };

        ws.onerror = () => {
            connected.value = false;
        };
    }

    function disconnect(): void {
        stopCountdown();
        if (ws) {
            ws.close();
            ws = null;
        }
        connected.value = false;
        subscribedCompetitionId = null;
    }

    function vote(rating: number): void {
        if (!ws || ws.readyState !== WebSocket.OPEN || !subscribedCompetitionId || !currentFileId.value) return;
        ws.send(
            JSON.stringify({
                type: 'VOTE',
                payload: {
                    competitionId: subscribedCompetitionId,
                    fileId: currentFileId.value,
                    rating,
                },
            }),
        );
    }

    onUnmounted(() => {
        disconnect();
    });

    return {
        connected,
        battleStatus,
        currentFileId,
        currentFileUrl,
        currentUploaderId,
        entryIndex,
        totalEntries,
        timeRemaining,
        entryDurationMs,
        myVote,
        finalRatings,
        connect,
        disconnect,
        vote,
    };
}
