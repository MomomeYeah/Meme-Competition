import {
    CreateBucketCommand,
    DeleteObjectCommand,
    ListObjectsCommand,
    PutObjectCommand,
    S3Client,
} from "@aws-sdk/client-s3";

const s3_region = process.env.S3_REGION || "us-east-1";
const s3_domain = process.env.S3_DOMAIN || `amazonaws.com`;
const s3_protocol = process.env.S3_PROTOCOL || "https";

// S3 connection URL
const s3_url = `${s3_protocol}://s3.${s3_region}.${s3_domain}`;

// S3 object URL including bucket name
const bucketName = "meme-competition";
const s3_file_prefix = `${s3_protocol}://${bucketName}.s3.${s3_region}.${s3_domain}/`;

// S3 connection client
const S3 = await createS3Client();

// TODO: error handling for all functions
// TODO: access settings for buckets?
//  - allow public access to buckets, or something like CloudFront Origin Access Control?
// TODO: should allow public read and private write
async function createS3Client() {
    console.log("Creating S3 client...");
    let s3Client: S3Client;
    if (process.env.NODE_ENV === "production") {
        s3Client = new S3Client({ region: s3_region });
    } else {
        console.warn("Using local S3 client for development");
        s3Client = new S3Client({
            region: s3_region,
            endpoint: s3_url,
            credentials: {
                accessKeyId: process.env.S3_ACCESS_KEY_ID || "test",
                secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "test",
            },
            forcePathStyle: true,
        });
    }

    // Ensure that meme competition bucket exists; if it does, ignore the error
    const command = new CreateBucketCommand({ Bucket: bucketName });
    await s3Client.send(command);
    return s3Client;
}

export async function uploadFile(fileNamePrefix: string, fileContent: Buffer) {
    // generate random string of length 32 for the file name to avoid collisions
    const generateFileName = () => {
        return (
            fileNamePrefix +
            Math.random().toString(36).substring(2, 15) +
            Math.random().toString(36).substring(2, 15)
        );
    };
    const fileName = generateFileName();

    // upload the file to S3
    const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: fileName,
        Body: fileContent,
    });
    await S3.send(command);

    // return the file name (key) to be stored in the database
    return fileName;
}

export async function deleteFile(fileName: string) {
    const command = new DeleteObjectCommand({
        Bucket: bucketName,
        Key: fileName,
    });
    await S3.send(command);
}

// TODO: more efficient to use DeleteObjectsCommand here to delete multiple files at once
// Need to limit to 1000 at once
export async function deleteFilesWithPrefix(prefix: string) {
    const listCommand = new ListObjectsCommand({
        Bucket: bucketName,
        Prefix: prefix,
    });

    const objects = await S3.send(listCommand);
    if (objects.Contents) {
        for (const object of objects.Contents) {
            if (object.Key) {
                await deleteFile(object.Key);
            }
        }
    }
}

export function getFileUrl(fileName: string) {
    const fileUrl = `${s3_file_prefix}${fileName}`;
    return fileUrl;
}
