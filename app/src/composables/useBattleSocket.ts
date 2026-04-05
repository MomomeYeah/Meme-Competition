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
    const entryDurationMs = ref(8000);
    const myVote = ref<number | null>(null);
    const finalRatings = ref<FinalRating[]>([]);

    let ws: WebSocket | null = null;
    let countdownInterval: ReturnType<typeof setInterval> | null = null;
    let entryStartedAt = 0;
    let currentEntryDurationMs = 8000;
    let subscribedCompetitionId: string | null = null;
    /** Difference (ms) between client clock and server clock.
     *  Positive = client is ahead of server. Updated on every server message
     *  that carries a serverTime field. */
    let clockSkew = 0;

    function updateClockSkew(serverTime: string): void {
        clockSkew = Date.now() - Date.parse(serverTime);
    }

    function startCountdown(startedAt: string, durationMs: number): void {
        entryStartedAt = Date.parse(startedAt);
        currentEntryDurationMs = durationMs;
        entryDurationMs.value = durationMs;

        if (countdownInterval) clearInterval(countdownInterval);
        countdownInterval = setInterval(() => {
            // Subtract clock skew so the countdown reflects server time, not
            // client time. This keeps all participants' bars in sync even when
            // system clocks differ by a few seconds.
            const serverNow = Date.now() - clockSkew;
            const remaining = entryStartedAt + currentEntryDurationMs - serverNow;
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
                // Capture clock skew from the server timestamp before starting
                // the countdown so all clients stay in sync.
                updateClockSkew(p.serverTime);
                battleStatus.value = p.status;
                currentFileId.value = p.fileId;
                currentFileUrl.value = p.fileUrl;
                currentUploaderId.value = p.uploaderId;
                entryIndex.value = p.currentIndex;
                totalEntries.value = p.totalEntries;
                // Restore the user's existing vote rather than starting at null,
                // so a page refresh shows the correct previously-cast vote.
                myVote.value = p.myVote ?? null;
                startCountdown(p.entryStartedAt, p.entryDurationMs);
                break;
            }
            case 'ENTRY_ADVANCE': {
                const p = msg.payload;
                // Re-sync clock skew on every advance.
                updateClockSkew(p.serverTime);
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
            // A late vote was rejected by the server; clear the star highlight
            // so the UI doesn't show a vote that wasn't saved.
            case 'VOTE_REJECTED': {
                myVote.value = null;
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
