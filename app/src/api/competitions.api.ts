import apiClient from './client';

export interface Competition {
    id: string;
    title: string;
    owner: string;
    createdAt: string;
    members: string[];
}

export interface UserCompetitions {
    owned: Competition[];
    joined: Competition[];
}

export async function getAllCompetitions(): Promise<Competition[]> {
    const response = await apiClient.get<{ success: boolean; data: Competition[] }>('/competitions');
    return response.data.data;
}

export async function getCompetitionById(id: string): Promise<Competition> {
    const response = await apiClient.get<{ success: boolean; data: Competition }>(
        `/competitions/${id}`,
    );
    return response.data.data;
}

export async function createCompetition(title: string): Promise<Competition> {
    const response = await apiClient.post<{ success: boolean; data: Competition }>('/competitions', {
        title,
    });
    return response.data.data;
}

export async function joinCompetition(competitionId: string): Promise<Competition> {
    const response = await apiClient.post<{ success: boolean; data: Competition }>(
        `/competitions/${competitionId}/join`,
    );
    return response.data.data;
}

export async function getUserCompetitions(userId: string): Promise<UserCompetitions> {
    const response = await apiClient.get<{ success: boolean; data: UserCompetitions }>(
        `/competitions/user/${userId}`,
    );
    return response.data.data;
}
