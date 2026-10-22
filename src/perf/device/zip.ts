/**
 * Minimal read-only zip reader (central directory + raw deflate) so the
 * simulator can open the metadata archive without adding a dependency.
 * Reads entries lazily from a file, so a large archive is never fully in memory.
 * Supports stored and deflated entries; zip64 archives are rejected explicitly.
 */

import * as fs from "fs";
import { inflateRawSync } from "zlib";

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;
const MAX_COMMENT = 0xffff;

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  localHeaderOffset: number;
}

export class ZipReader {
  private constructor(
    private readonly fd: number,
    readonly entries: ZipEntry[]
  ) {}

  static open(file: string): ZipReader {
    const fd = fs.openSync(file, "r");
    try {
      const size = fs.fstatSync(fd).size;
      const tailLen = Math.min(size, 22 + MAX_COMMENT);
      const tail = Buffer.alloc(tailLen);
      fs.readSync(fd, tail, 0, tailLen, size - tailLen);
      let eocd = -1;
      for (let i = tailLen - 22; i >= 0; i--) {
        if (tail.readUInt32LE(i) === EOCD_SIG) {
          eocd = i;
          break;
        }
      }
      if (eocd < 0) throw new Error("Not a zip archive (end of central directory not found)");
      const total = tail.readUInt16LE(eocd + 10);
      const cenSize = tail.readUInt32LE(eocd + 12);
      const cenOffset = tail.readUInt32LE(eocd + 16);
      if (total === 0xffff || cenSize === 0xffffffff || cenOffset === 0xffffffff) {
        throw new Error("zip64 archives are not supported");
      }
      const cen = Buffer.alloc(cenSize);
      fs.readSync(fd, cen, 0, cenSize, cenOffset);
      const entries: ZipEntry[] = [];
      let p = 0;
      while (p + 46 <= cen.length && cen.readUInt32LE(p) === CEN_SIG) {
        const method = cen.readUInt16LE(p + 10);
        const compressedSize = cen.readUInt32LE(p + 20);
        const uncompressed = cen.readUInt32LE(p + 24);
        const nameLen = cen.readUInt16LE(p + 28);
        const extraLen = cen.readUInt16LE(p + 30);
        const commentLen = cen.readUInt16LE(p + 32);
        const localHeaderOffset = cen.readUInt32LE(p + 42);
        const name = cen.toString("utf8", p + 46, p + 46 + nameLen);
        entries.push({ name, method, compressedSize, size: uncompressed, localHeaderOffset });
        p += 46 + nameLen + extraLen + commentLen;
      }
      return new ZipReader(fd, entries);
    } catch (e) {
      fs.closeSync(fd);
      throw e;
    }
  }

  /** First entry whose path equals `file` or ends with `/file`. */
  find(file: string): ZipEntry | undefined {
    return this.entries.find((e) => e.name === file || e.name.endsWith(`/${file}`));
  }

  read(entry: ZipEntry): Buffer {
    const local = Buffer.alloc(30);
    fs.readSync(this.fd, local, 0, 30, entry.localHeaderOffset);
    if (local.readUInt32LE(0) !== LOC_SIG)
      throw new Error(`Corrupt zip entry header: ${entry.name}`);
    const dataStart =
      entry.localHeaderOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
    const raw = Buffer.alloc(entry.compressedSize);
    fs.readSync(this.fd, raw, 0, entry.compressedSize, dataStart);
    if (entry.method === 0) return raw;
    if (entry.method === 8) return inflateRawSync(raw);
    throw new Error(`Unsupported zip compression method ${entry.method} for ${entry.name}`);
  }

  readJson(file: string): unknown | undefined {
    const entry = this.find(file);
    if (!entry) return undefined;
    return JSON.parse(this.read(entry).toString("utf8"));
  }

  close(): void {
    try {
      fs.closeSync(this.fd);
    } catch {
      // already closed
    }
  }
}
