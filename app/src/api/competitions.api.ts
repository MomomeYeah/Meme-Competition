import apiClient from "./client";

export interface CompetitionFile {
    id: string;
    name: string;
    uploadedAt: string;
    rating: number | null;
    url: string;
}

export interface Competition {
    id: string;
    title: string;
    // may be null if no owner
    owner: string | null;
    createdAt: string;
    members: string[];
    files?: CompetitionFile[];
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
        file: CompetitionFile;
    };
}

export async function uploadCompetitionFile(
    competitionId: string,
    file: File
): Promise<CompetitionFile> {
    const form = new FormData();
    form.append("file", file);

    const response = await apiClient.post<UploadResponse>(
        `/competitions/${competitionId}/files`,
        form,
        {
            headers: { "Content-Type": "multipart/form-data" },
        }
    );
    return response.data.data.file;
}

export async function listCompetitionFiles(competitionId: string): Promise<CompetitionFile[]> {
    const response = await apiClient.get<{
        success: boolean;
        data: { files: CompetitionFile[] };
    }>(`/competitions/${competitionId}/files`);
    return response.data.data.files;
}

export async function deleteCompetitionFile(competitionId: string, fileId: string): Promise<void> {
    const encoded = encodeURIComponent(fileId);
    await apiClient.delete(`/competitions/${competitionId}/files/${encoded}`);
}
