import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const DATA_DIR = join(process.cwd(), 'data');

export function readJsonFile<T>(filename: string): T[] {
    try {
        const filepath = join(DATA_DIR, filename);
        const content = readFileSync(filepath, 'utf-8');
        return JSON.parse(content);
    } catch (error) {
        // File doesn't exist or is empty, return empty array
        return [];
    }
}

export function writeJsonFile<T>(filename: string, data: T[]): void {
    const filepath = join(DATA_DIR, filename);
    writeFileSync(filepath, JSON.stringify(data, null, 2));
}

export function findById<T extends { id: string }>(data: T[], id: string): T | undefined {
    return data.find((item) => item.id === id);
}

export function findByProperty<T>(data: T[], property: keyof T, value: any): T | undefined {
    return data.find((item) => item[property] === value);
}

export function findByProperties<T>(data: T[], filters: Record<keyof T, any>): T | undefined {
    return data.find((item) => {
        return Object.entries(filters).every(([key, value]) => item[key as keyof T] === value);
    });
}

export function filterByProperty<T>(data: T[], property: keyof T, value: any): T[] {
    return data.filter((item) => item[property] === value);
}
