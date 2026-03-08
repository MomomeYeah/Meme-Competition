import apiClient from "./client";

export interface Competition {
    id: string;
    title: string;
    owner: string;
    createdAt: string;
    members: string[];
}

export async function getCompetitionById(id: string): Promise<Competition> {
    const response = await apiClient.get<{
        success: boolean;
        data: Competition;
    }>(`/competitions/${id}`);
    return response.data.data;
}

export async function createCompetition(title: string): Promise<Competition> {
    const response = await apiClient.post<{
        success: boolean;
        data: Competition;
    }>("/competitions", {
        title,
    });
    return response.data.data;
}

export async function joinCompetition(competitionId: string): Promise<Competition> {
    const response = await apiClient.post<{
        success: boolean;
        data: Competition;
    }>(`/competitions/${competitionId}/join`);
    return response.data.data;
}

export async function deleteCompetition(competitionId: string): Promise<void> {
    await apiClient.delete(`/competitions/${competitionId}`);
}

export async function getUserCompetitions(userId: string): Promise<Competition[]> {
    const response = await apiClient.get<{
        success: boolean;
        data: {
            competitions: Competition[];
        };
    }>(`/competitions`);
    return response.data.data.competitions;
}
