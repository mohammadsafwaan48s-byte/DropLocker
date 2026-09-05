/**
 * Pure Node.js PNG Generator for DropLocker PWA Icons
 * Generates valid icon-192.png and icon-512.png without any external dependencies
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// CRC32 table & function
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[i] = c;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createChunk(type, data) {
  const len = data.length;
  const chunk = Buffer.alloc(12 + len);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  const typeAndData = chunk.subarray(4, 8 + len);
  const crc = crc32(typeAndData);
  chunk.writeUInt32BE(crc, 8 + len);
  return chunk;
}

function generatePng(size) {
  // Generate RGBA buffer
  const scanlineLength = 1 + size * 4;
  const rawData = Buffer.alloc(scanlineLength * size);

  const cx = size / 2;
  const cy = size / 2;
  const outerR = size * 0.44;
  const innerR = size * 0.28;

  for (let y = 0; y < size; y++) {
    const rowOffset = y * scanlineLength;
    rawData[rowOffset] = 0; // Filter byte 0 (None)

    for (let x = 0; x < size; x++) {
      const pxOffset = rowOffset + 1 + x * 4;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Rounded squircle background
      const nx = Math.abs(dx) / (size * 0.45);
      const ny = Math.abs(dy) / (size * 0.45);
      const squircle = Math.pow(nx, 4) + Math.pow(ny, 4);

      if (squircle <= 1.0) {
        // Obsidian background with gradient
        let r = 16, g = 16, b = 24, a = 255;

        // Locker body
        const isLockerBody =
          x >= cx - size * 0.22 &&
          x <= cx + size * 0.22 &&
          y >= cy &&
          y <= cy + size * 0.26;

        // Locker shackle
        const isShackle =
          dist <= size * 0.22 &&
          dist >= size * 0.14 &&
          y <= cy + size * 0.05;

        // Arrow
        const isArrowShaft =
          Math.abs(dx) <= size * 0.025 &&
          y >= cy + size * 0.05 &&
          y <= cy + size * 0.2;

        const isArrowHead =
          y >= cy + size * 0.05 &&
          y <= cy + size * 0.12 &&
          Math.abs(dx) <= (cy + size * 0.12 - y);

        if (isArrowShaft || isArrowHead) {
          // Teal Arrow
          r = 45; g = 212; b = 191;
        } else if (isLockerBody) {
          // Inner body with violet border
          const borderDist = Math.min(
            Math.abs(x - (cx - size * 0.22)),
            Math.abs(x - (cx + size * 0.22)),
            Math.abs(y - cy),
            Math.abs(y - (cy + size * 0.26))
          );
          if (borderDist <= size * 0.03) {
            r = 124; g = 92; b = 252; // Violet accent
          } else {
            r = 24; g = 24; b = 36;
          }
        } else if (isShackle) {
          r = 124; g = 92; b = 252;
        }

        rawData[pxOffset] = r;
        rawData[pxOffset + 1] = g;
        rawData[pxOffset + 2] = b;
        rawData[pxOffset + 3] = a;
      } else {
        // Transparent outside
        rawData[pxOffset] = 0;
        rawData[pxOffset + 1] = 0;
        rawData[pxOffset + 2] = 0;
        rawData[pxOffset + 3] = 0;
      }
    }
  }

  // Compress with zlib
  const compressed = zlib.deflateSync(rawData);

  // PNG Signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR Chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 8 bits per channel
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // Compression
  ihdr[11] = 0; // Filter
  ihdr[12] = 0; // Interlace
  const ihdrChunk = createChunk('IHDR', ihdr);

  // IDAT Chunk
  const idatChunk = createChunk('IDAT', compressed);

  // IEND Chunk
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

const publicDir = path.join(__dirname, '..', 'public');
fs.writeFileSync(path.join(publicDir, 'icon-192.png'), generatePng(192));
fs.writeFileSync(path.join(publicDir, 'icon-512.png'), generatePng(512));

console.log('✅ Generated public/icon-192.png and public/icon-512.png successfully.');
