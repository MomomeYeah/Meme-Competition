/**
 * Validates if a file buffer contains a valid image based on magic bytes,
 * based on https://en.wikipedia.org/wiki/List_of_file_signatures
 */
export function validateImageFile(buffer: Buffer): boolean {
    if (buffer.length === 0) {
        return false;
    }

    if (buffer.length < 12) {
        return false;
    }

    // JPEG: FF D8 FF
    if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
        return true;
    }

    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
        buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    ) {
        return true;
    }

    // GIF87a: 47 49 46 38 37 61
    // GIF89a: 47 49 46 38 39 61
    if (
        buffer.subarray(0, 6).equals(Buffer.from([0x47, 0x49, 0x46, 0x38, 0x37, 0x61])) ||
        buffer.subarray(0, 6).equals(Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))
    ) {
        return true;
    }

    // WebP: RIFF .... WEBP
    if (
        buffer.subarray(0, 4).equals(Buffer.from([0x52, 0x49, 0x46, 0x46])) &&
        buffer.subarray(8, 12).equals(Buffer.from([0x57, 0x45, 0x42, 0x50]))
    ) {
        return true;
    }

    // BMP: 42 4D
    if (buffer.subarray(0, 2).equals(Buffer.from([0x42, 0x4d]))) {
        return true;
    }

    // SVG: Check for <svg tag (XML declaration is optional)
    const str = buffer.subarray(0, 100).toString("utf8", 0, 100);
    if (str.includes("<svg")) {
        return true;
    }

    return false;
}
