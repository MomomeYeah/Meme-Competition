import { type IncomingMessage, type Server } from 'http';
import { parse as parseCookies } from 'cookie';
import { WebSocketServer, type WebSocket } from 'ws';
import { battleManager, type AuthenticatedWS } from '../services/BattleManager';
import { verifyToken } from '../utils/jwt';
import { CompetitionService } from '../services/CompetitionService';
import { VoteService } from '../services/VoteService';

// Client → Server message types
interface SubscribeMessage {
    type: 'SUBSCRIBE';
    payload: { competitionId: string };
}

interface VoteMessage {
    type: 'VOTE';
    payload: { competitionId: string; fileId: string; rating: number };
}

interface ChatMessage {
    type: 'CHAT';
    payload: { text: string };
}

type ClientMessage = SubscribeMessage | VoteMessage | ChatMessage;

export function attachBattleWebSocket(httpServer: Server, manager: typeof battleManager): void {
    const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

    wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
        // Authenticate via the jwt httpOnly cookie
        const cookieHeader = req.headers.cookie ?? '';
        const cookies = parseCookies(cookieHeader);
        const token = cookies.jwt;

        if (!token) {
            ws.close(4001, 'Unauthorized');
            return;
        }

        let userId: string;
        let username: string;
        try {
            const payload = verifyToken(token);
            userId = payload.userId;
            username = payload.username;
        } catch {
            ws.close(4001, 'Unauthorized');
            return;
        }

        const authWs = ws as AuthenticatedWS;
        authWs.userId = userId;
        authWs.username = username;

        ws.on('message', (data) => {
            let msg: ClientMessage;
            try {
                msg = JSON.parse(data.toString()) as ClientMessage;
            } catch {
                manager.send(ws, { type: 'ERROR', payload: { code: 'INVALID_JSON', message: 'Invalid JSON' } });
                return;
            }

            switch (msg.type) {
                case 'SUBSCRIBE':
                    handleSubscribe(authWs, msg, manager).catch((err) => {
                        console.error('Unhandled error in handleSubscribe:', err);
                        manager.send(ws, { type: 'ERROR', payload: { code: 'INTERNAL', message: 'Internal error' } });
                    });
                    break;
                case 'VOTE':
                    handleVote(authWs, msg, manager).catch((err) => {
                        console.error('Unhandled error in handleVote:', err);
                        manager.send(ws, { type: 'ERROR', payload: { code: 'INTERNAL', message: 'Internal error' } });
                    });
                    break;
                case 'CHAT':
                    handleChat(authWs, msg, manager);
                    break;
                default:
                    manager.send(ws, {
                        type: 'ERROR',
                        payload: { code: 'UNKNOWN_TYPE', message: 'Unknown message type' },
                    });
            }
        });

        ws.on('close', () => {
            if (authWs.competitionId) {
                manager.scheduleLeave(authWs.competitionId, authWs);
            }
        });

        ws.on('error', () => {
            if (authWs.competitionId) {
                manager.scheduleLeave(authWs.competitionId, authWs);
            }
        });
    });
}

async function handleSubscribe(ws: AuthenticatedWS, msg: SubscribeMessage, manager: typeof battleManager): Promise<void> {
    const { competitionId } = msg.payload;

    let competition;
    try {
        competition = await CompetitionService.getCompetitionById(competitionId);
    } catch {
        manager.send(ws, { type: 'ERROR', payload: { code: 'NOT_FOUND', message: 'Competition not found' } });
        return;
    }

    if (!competition.members.includes(ws.userId)) {
        manager.send(ws, { type: 'ERROR', payload: { code: 'FORBIDDEN', message: 'Access denied' } });
        return;
    }

    // Remove from previous room if switching
    if (ws.competitionId && ws.competitionId !== competitionId) {
        manager.scheduleLeave(ws.competitionId, ws);
    }

    ws.competitionId = competitionId;
    manager.registerClientWithPresence(competitionId, ws);

    // Send current battle state if the battle is active
    if (competition.battle?.status === 'active') {
        await manager.sendCurrentState(ws, competition);
    }
}

async function handleVote(ws: AuthenticatedWS, msg: VoteMessage, manager: typeof battleManager): Promise<void> {
    const { competitionId, fileId, rating } = msg.payload;

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        manager.send(ws, { type: 'ERROR', payload: { code: 'INVALID_VOTE', message: 'Rating must be 1-5' } });
        return;
    }

    let competition;
    try {
        competition = await CompetitionService.getCompetitionById(competitionId);
    } catch {
        manager.send(ws, { type: 'ERROR', payload: { code: 'NOT_FOUND', message: 'Competition not found' } });
        return;
    }

    if (!competition.battle || competition.battle.status !== 'active') {
        manager.send(ws, { type: 'ERROR', payload: { code: 'NOT_ACTIVE', message: 'No active battle' } });
        return;
    }

    // Reject votes from users who are not members of this competition
    if (!competition.members.includes(ws.userId)) {
        manager.send(ws, { type: 'ERROR', payload: { code: 'FORBIDDEN', message: 'Not a member of this competition' } });
        return;
    }

    // Inform the client when their vote arrived too late rather than silently
    // discarding it — the star UI will reset rather than appearing saved
    const currentFileId = competition.battle.shuffledFileIds[competition.battle.currentIndex];
    if (fileId !== currentFileId) {
        manager.send(ws, { type: 'VOTE_REJECTED', payload: { fileId, reason: 'Entry has already advanced' } });
        return;
    }

    // Prevent voting on own entry — client enforces this too, but never trust
    // the client for server-side integrity
    const file = competition.files.find((f) => f.id === fileId);
    if (file?.uploaderId === ws.userId) {
        manager.send(ws, { type: 'ERROR', payload: { code: 'INVALID_VOTE', message: 'Cannot vote on your own entry' } });
        return;
    }

    try {
        await VoteService.setVote(competitionId, fileId, ws.userId, rating);
    } catch {
        manager.send(ws, { type: 'ERROR', payload: { code: 'VOTE_FAILED', message: 'Failed to save vote' } });
        return;
    }

    manager.send(ws, { type: 'VOTE_ACK', payload: { fileId, rating } });
}

function handleChat(ws: AuthenticatedWS, msg: ChatMessage, manager: typeof battleManager): void {
    if (!ws.competitionId) {
        manager.send(ws, { type: 'ERROR', payload: { code: 'NOT_SUBSCRIBED', message: 'Subscribe to a competition first' } });
        return;
    }

    const raw = msg.payload?.text;
    if (typeof raw !== 'string' || raw.trim().length === 0) {
        manager.send(ws, { type: 'ERROR', payload: { code: 'INVALID_CHAT', message: 'Message cannot be empty' } });
        return;
    }

    const now = Date.now();
    if (now - (ws.lastChatAt ?? 0) < 1000) {
        manager.send(ws, { type: 'ERROR', payload: { code: 'RATE_LIMITED', message: 'Sending too fast' } });
        return;
    }
    ws.lastChatAt = now;

    const text = raw.trim().slice(0, 200);
    const payload = {
        messageId: crypto.randomUUID(),
        userId: ws.userId,
        username: ws.username,
        text,
        sentAt: new Date().toISOString(),
    };

    manager.appendChatHistory(ws.competitionId, payload);
    manager.broadcast(ws.competitionId, { type: 'CHAT_MESSAGE', payload });
}
