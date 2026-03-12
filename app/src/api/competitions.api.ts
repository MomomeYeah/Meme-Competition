import apiClient from "./client";

export interface Competition {
    id: string;
    title: string;
    // may be null if no owner
    owner: string | null;
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

export async function relinquishOwnership(competitionId: string): Promise<Competition> {
    const response = await apiClient.post<{
        success: boolean;
        data: Competition;
    }>(`/competitions/${competitionId}/relinquish`);
    return response.data.data;
}

export async function claimOwnership(competitionId: string): Promise<Competition> {
    const response = await apiClient.post<{
        success: boolean;
        data: Competition;
    }>(`/competitions/${competitionId}/claim`);
    return response.data.data;
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

interface UploadResponse {
    success: boolean;
    data: {
        key: string;
    };
}

export async function uploadCompetitionFile(competitionId: string, file: File): Promise<string> {
    const form = new FormData();
    form.append("file", file);

    const response = await apiClient.post<UploadResponse>(
        `/competitions/${competitionId}/files`,
        form,
        {
            headers: { "Content-Type": "multipart/form-data" },
        }
    );
    return response.data.data.key;
}

export async function listCompetitionFiles(competitionId: string): Promise<string[]> {
    const response = await apiClient.get<{
        success: boolean;
        data: { keys: string[] };
    }>(`/competitions/${competitionId}/files`);
    return response.data.data.keys;
}

export async function deleteCompetitionFile(competitionId: string, key: string): Promise<void> {
    const encoded = encodeURIComponent(key);
    await apiClient.delete(`/competitions/${competitionId}/files/${encoded}`);
}
