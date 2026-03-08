import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const DATA_DIR = join(process.cwd(), "data");

function readJsonFile<T>(filename: string): T[] {
    try {
        const filepath = join(DATA_DIR, filename);
        const content = readFileSync(filepath, "utf-8");
        return JSON.parse(content);
    } catch (error) {
        // File doesn't exist or is empty, return empty array
        return [];
    }
}

function writeJsonFile<T>(filename: string, data: T[]): void {
    const filepath = join(DATA_DIR, filename);
    writeFileSync(filepath, JSON.stringify(data, null, 2));
}

export function findById<T extends { id: string }>(filename: string, id: string): T | undefined {
    const data = readJsonFile<T>(filename);
    return data.find((item) => item.id === id);
}

export function findByProperty<T>(filename: string, property: keyof T, value: any): T | undefined {
    const data = readJsonFile<T>(filename);
    return data.find((item) => item[property] === value);
}

export function filterByProperty<T>(filename: string, property: keyof T, value: any): T[] {
    const data = readJsonFile<T>(filename);

    return data.filter((item) => {
        return (
            (Array.isArray(item[property]) && item[property].includes(value)) ||
            item[property] === value
        );
    });
}

export function create<T>(filename: string, item: T): T {
    const data = readJsonFile<T>(filename);
    data.push(item);
    writeJsonFile(filename, data);
    return item;
}

export function updateById<T extends { id: string }>(
    filename: string,
    id: string,
    updates: Partial<T>
): T | null {
    const data = readJsonFile<T>(filename);

    const dataItem = data.find((item) => item.id === id);
    const dataIndex = data.findIndex((item) => item.id === id);
    if (!dataItem) {
        return null;
    }
    const updatedItem: T = { ...dataItem, ...updates };

    data[dataIndex] = updatedItem;
    writeJsonFile(filename, data);
    return updatedItem;
}

export function deleteById<T extends { id: string }>(filename: string, id: string): void {
    const data = readJsonFile<T>(filename);
    const index = data.findIndex((item) => item.id === id);
    if (index !== -1) {
        data.splice(index, 1);
    }

    writeJsonFile(filename, data);
}
