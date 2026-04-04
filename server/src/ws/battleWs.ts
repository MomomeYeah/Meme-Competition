import { type IncomingMessage, type Server } from 'http';
import { parse as parseCookies } from 'cookie';
import { WebSocketServer, type WebSocket } from 'ws';
import { battleManager, type AuthenticatedWS } from '../services/BattleManager';
import { verifyToken } from '../utils/jwt';
import { findById } from '../utils/json-db';
import { type Competition } from '../models/types';
import { VoteService } from '../services/VoteService';

const COMPETITIONS_FILE = 'competitions.json';

// Client → Server message types
interface SubscribeMessage {
    type: 'SUBSCRIBE';
    payload: { competitionId: string };
}

interface VoteMessage {
    type: 'VOTE';
    payload: { competitionId: string; fileId: string; rating: number };
}

type ClientMessage = SubscribeMessage | VoteMessage;

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
                    handleSubscribe(authWs, msg, manager);
                    break;
                case 'VOTE':
                    handleVote(authWs, msg, manager);
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
                manager.removeClient(authWs.competitionId, authWs);
            }
        });

        ws.on('error', () => {
            if (authWs.competitionId) {
                manager.removeClient(authWs.competitionId, authWs);
            }
        });
    });
}

function handleSubscribe(ws: AuthenticatedWS, msg: SubscribeMessage, manager: typeof battleManager): void {
    const { competitionId } = msg.payload;

    const competition = findById<Competition>(COMPETITIONS_FILE, competitionId);
    if (!competition) {
        manager.send(ws, { type: 'ERROR', payload: { code: 'NOT_FOUND', message: 'Competition not found' } });
        return;
    }

    if (!competition.members.includes(ws.userId)) {
        manager.send(ws, { type: 'ERROR', payload: { code: 'FORBIDDEN', message: 'Access denied' } });
        return;
    }

    // Remove from previous room if switching
    if (ws.competitionId && ws.competitionId !== competitionId) {
        manager.removeClient(ws.competitionId, ws);
    }

    ws.competitionId = competitionId;
    manager.registerClient(competitionId, ws);

    // Send current battle state if the battle is active
    if (competition.battle?.status === 'active') {
        manager.sendCurrentState(ws, competition);
    }
}

function handleVote(ws: AuthenticatedWS, msg: VoteMessage, manager: typeof battleManager): void {
    const { competitionId, fileId, rating } = msg.payload;

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        manager.send(ws, { type: 'ERROR', payload: { code: 'INVALID_VOTE', message: 'Rating must be 1-5' } });
        return;
    }

    const competition = findById<Competition>(COMPETITIONS_FILE, competitionId);
    if (!competition?.battle || competition.battle.status !== 'active') {
        manager.send(ws, { type: 'ERROR', payload: { code: 'NOT_ACTIVE', message: 'No active battle' } });
        return;
    }

    // Only accept votes for the currently displayed entry
    const currentFileId = competition.battle.shuffledFileIds[competition.battle.currentIndex];
    if (fileId !== currentFileId) {
        // Silently ignore votes for non-current entries
        return;
    }

    VoteService.setVote(competitionId, fileId, ws.userId, rating);
    manager.send(ws, { type: 'VOTE_ACK', payload: { fileId, rating } });
}
