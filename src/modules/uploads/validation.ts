export type AllowedImageMimeType =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'image/heic'
  | 'image/heif';

/**
 * Checks whether the declared MIME type is compatible with the detected signature.
 * Treats image/heic and image/heif interchangeably as they belong to the same container family.
 */
export function isCompatibleMimeType(declared: string, detected: string): boolean {
  if (declared === detected) return true;
  const isHeifFamily = (t: string) => t === 'image/heic' || t === 'image/heif';
  if (isHeifFamily(declared) && isHeifFamily(detected)) return true;
  return false;
}

/**
 * Detects the actual image MIME type based on header magic bytes.
 * Does not trust client-declared file extensions or Content-Type headers.
 * Supports JPEG, PNG, WebP, and ISO/IEC 23008-12 (HEIF/HEIC).
 */
export function detectImageSignature(
  buffer: Buffer
): AllowedImageMimeType | null {
  if (!buffer || buffer.length < 12) {
    return null;
  }

  // JPEG magic bytes: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }

  // WebP magic bytes: 'RIFF' .... 'WEBP'
  if (
    buffer[0] === 0x52 && // 'R'
    buffer[1] === 0x49 && // 'I'
    buffer[2] === 0x46 && // 'F'
    buffer[3] === 0x46 && // 'F'
    buffer[8] === 0x57 && // 'W'
    buffer[9] === 0x45 && // 'E'
    buffer[10] === 0x42 && // 'B'
    buffer[11] === 0x50 // 'P'
  ) {
    return 'image/webp';
  }

  // HEIF / HEIC: ISOBMFF 'ftyp' box at offset 4
  if (
    buffer[4] === 0x66 && // 'f'
    buffer[5] === 0x74 && // 't'
    buffer[6] === 0x79 && // 'y'
    buffer[7] === 0x70 // 'p'
  ) {
    const majorBrand = buffer.subarray(8, 12).toString('ascii').toLowerCase();
    const heicBrands = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx']);
    const heifBrands = new Set(['mif1', 'msf1']);

    if (heicBrands.has(majorBrand)) {
      return 'image/heic';
    }

    const boxSize = buffer.length >= 4 ? buffer.readUInt32BE(0) : 0;
    const scanLimit = Math.min(boxSize > 0 ? boxSize : 64, buffer.length, 256);

    // Scan compatible brands in ftyp box (starting at offset 16 in 4-byte increments)
    for (let offset = 16; offset + 4 <= scanLimit; offset += 4) {
      const compBrand = buffer.subarray(offset, offset + 4).toString('ascii').toLowerCase();
      if (heicBrands.has(compBrand)) {
        return 'image/heic';
      }
    }

    if (heifBrands.has(majorBrand)) {
      return 'image/heif';
    }

    for (let offset = 16; offset + 4 <= scanLimit; offset += 4) {
      const compBrand = buffer.subarray(offset, offset + 4).toString('ascii').toLowerCase();
      if (heifBrands.has(compBrand)) {
        return 'image/heif';
      }
    }
  }

  return null;
}
