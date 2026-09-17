import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { IgleError, normalizeSitePath, resolveInside } from "@igle/shared";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const EOCD_MIN_SIZE = 22;
const MAX_COMMENT_SIZE = 65535;

const DEFAULT_MAX_ENTRIES = 5000;
const DEFAULT_MAX_FILE_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 200 * 1024 * 1024;

export interface ZipExtractOptions {
  maxEntries?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
}

export interface ZipExtractReport {
  writtenFiles: string[];
  rejectedFiles: Array<{ path: string; reason: string }>;
  totalBytes: number;
}

export async function extractZipBuffer(buffer: Buffer, targetDir: string, options: ZipExtractOptions = {}): Promise<ZipExtractReport> {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;

  const eocdOffset = findEndOfCentralDirectory(buffer);
  const totalRecords = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);

  if (centralDirectoryOffset === 0xffffffff || centralDirectorySize === 0xffffffff) {
    throw new IgleError("ZIP_UNSUPPORTED", "ZIP64 archives are not supported.", 400);
  }
  if (totalRecords > maxEntries) {
    throw new IgleError("ZIP_TOO_LARGE", `Archive contains more than ${maxEntries} entries.`, 400);
  }

  const report: ZipExtractReport = { writtenFiles: [], rejectedFiles: [], totalBytes: 0 };
  let offset = centralDirectoryOffset;

  for (let index = 0; index < totalRecords; index += 1) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new IgleError("ZIP_CORRUPT", "Central directory entry is malformed.", 400);
    }

    const versionMadeBy = buffer.readUInt16LE(offset + 4);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const externalAttributes = buffer.readUInt32LE(offset + 38);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);

    const nameStart = offset + 46;
    const rawName = buffer.toString("utf8", nameStart, nameStart + nameLength);
    offset = nameStart + nameLength + extraLength + commentLength;

    const isDirectory = rawName.endsWith("/");
    const entryName = isDirectory ? rawName.slice(0, -1) : rawName;
    const hostOs = versionMadeBy >>> 8;
    const unixMode = hostOs === 3 ? externalAttributes >>> 16 : 0;
    const isSymlink = (unixMode & 0xf000) === 0xa000;

    if (!entryName) continue;

    let normalizedPath: string;
    try {
      normalizedPath = normalizeSitePath(entryName);
    } catch (error) {
      report.rejectedFiles.push({ path: rawName, reason: error instanceof Error ? error.message : "Invalid path." });
      continue;
    }

    if (isSymlink) {
      report.rejectedFiles.push({ path: normalizedPath, reason: "Symlinks are not allowed." });
      continue;
    }

    const destination = resolveInside(targetDir, normalizedPath);

    if (isDirectory) {
      await fs.mkdir(destination, { recursive: true });
      continue;
    }

    if (method !== 0 && method !== 8) {
      report.rejectedFiles.push({ path: normalizedPath, reason: `Unsupported compression method ${method}.` });
      continue;
    }

    if (uncompressedSize > maxFileBytes) {
      report.rejectedFiles.push({ path: normalizedPath, reason: "File exceeds the per-file size limit." });
      continue;
    }

    report.totalBytes += uncompressedSize;
    if (report.totalBytes > maxTotalBytes) {
      throw new IgleError("ZIP_TOO_LARGE", "Archive exceeds the total uncompressed size limit.", 400);
    }

    if (buffer.readUInt32LE(localHeaderOffset) !== LOCAL_FILE_SIGNATURE) {
      throw new IgleError("ZIP_CORRUPT", "Local file entry is malformed.", 400);
    }
    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressedData = buffer.subarray(dataStart, dataStart + compressedSize);

    const data = method === 0 ? compressedData : zlib.inflateRawSync(compressedData);
    if (data.length !== uncompressedSize) {
      throw new IgleError("ZIP_CORRUPT", `Extracted size mismatch for ${normalizedPath}.`, 400);
    }

    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, data);
    report.writtenFiles.push(normalizedPath);
  }

  return report;
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const searchStart = Math.max(0, buffer.length - EOCD_MIN_SIZE - MAX_COMMENT_SIZE);
  for (let index = buffer.length - EOCD_MIN_SIZE; index >= searchStart; index -= 1) {
    if (buffer.readUInt32LE(index) === EOCD_SIGNATURE) return index;
  }
  throw new IgleError("ZIP_CORRUPT", "Not a valid ZIP archive.", 400);
}
