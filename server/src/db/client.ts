import { MongoClient, type Db } from 'mongodb';

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectDb(): Promise<void> {
    const uri = process.env.MONGODB_URI;
    const dbName = process.env.MONGODB_DB_NAME;

    if (!uri) throw new Error('MONGODB_URI environment variable is not set');
    if (!dbName) throw new Error('MONGODB_DB_NAME environment variable is not set');

    client = new MongoClient(uri);
    await client.connect();
    db = client.db(dbName);
    console.log(`Connected to MongoDB: ${dbName}`);
}

export function getDb(): Db {
    if (!db) throw new Error('Database not connected. Call connectDb() first.');
    return db;
}
