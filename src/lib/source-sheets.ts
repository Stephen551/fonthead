import { imageExt, AVATAR_CONTENT_TYPE } from './imagesig';

export const MAX_SOURCE_SHEET_BYTES = 10 * 1024 * 1024;
export const MAX_SOURCE_SHEETS = 3;

export interface SourceSheet {
  key: string;
  role: 'base' | 'variation-1' | 'variation-2' | 'supplement';
  contentType: string;
  size: number;
}

export interface PublicationObject {
  key: string;
  bytes: Uint8Array;
  contentType: string;
}

/** Keep the uploaded bytes intact; filenames and MIME types are not trusted. */
export async function prepareSourceSheets(id: string, files: File[], supplement?: File): Promise<{
  sheets: SourceSheet[];
  objects: PublicationObject[];
}> {
  if (files.length > MAX_SOURCE_SHEETS) throw new Error('Publish up to three source sheets.');
  const uploads = files.map((file, index) => ({ file, role: (index === 0 ? 'base' : `variation-${index}`) as SourceSheet['role'] }));
  if (supplement) uploads.push({ file: supplement, role: 'supplement' });
  // Check sizes before reading any file into worker memory.
  for (const { file } of uploads) {
    if (!file.size || file.size > MAX_SOURCE_SHEET_BYTES) {
      throw new Error('Each source sheet must be between 1 byte and 10 MB.');
    }
  }
  const sheets: SourceSheet[] = [];
  const objects: PublicationObject[] = [];
  for (const { file, role } of uploads) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const ext = imageExt(bytes);
    if (!ext) throw new Error('Source sheets must be PNG, JPEG, or WebP images.');
    const key = `sources/${id}/${role}.${ext}`;
    const contentType = AVATAR_CONTENT_TYPE[ext];
    sheets.push({ key, role, contentType, size: bytes.length });
    objects.push({ key, bytes, contentType });
  }
  return { sheets, objects };
}

/** Only remove this font's source objects, even if old metadata is malformed. */
export function sourceSheetKeys(id: string, rawMeta: string): string[] {
  try {
    const sheets: unknown = JSON.parse(rawMeta)?.sourceSheets;
    if (!Array.isArray(sheets)) return [];
    const prefix = `sources/${id}/`;
    return sheets.flatMap((sheet) => {
      const key: unknown = sheet?.key;
      return typeof key === 'string' && key.startsWith(prefix) &&
        /^(base|variation-[12]|supplement)\.(png|jpg|webp)$/.test(key.slice(prefix.length)) ? [key] : [];
    });
  } catch {
    return [];
  }
}

/** R2 and D1 cannot share a transaction, so roll back objects on either failure. */
export async function storeFontPublication(
  bucket: Pick<R2Bucket, 'put' | 'delete'>,
  objects: PublicationObject[],
  saveRow: () => Promise<unknown>,
): Promise<void> {
  const attempted: string[] = [];
  try {
    for (const object of objects) {
      // Include the current key in case R2 wrote it before returning an error.
      attempted.push(object.key);
      await bucket.put(object.key, object.bytes, { httpMetadata: { contentType: object.contentType } });
    }
    await saveRow();
  } catch (error) {
    await Promise.allSettled(attempted.map((key) => bucket.delete(key)));
    throw error;
  }
}
