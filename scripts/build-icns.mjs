#!/usr/bin/env node
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { createRequire } from 'module';

const require = createRequire(join(process.cwd(), 'web', 'package.json'));
const sharp = require('sharp');

const root = process.cwd();
const sourceSvg = join(root, 'web', 'public', 'favicon.svg');
const outFile = join(root, 'electron', 'assets', 'tinycode.icns');
const tmpDir = join(root, 'web', 'public', '.icns-tmp');
mkdirSync(tmpDir, { recursive: true });

const sizes = [16, 32, 64, 128, 256, 512, 1024];
const types = ['icp4', 'icp5', 'icp6', 'icp7', 'icp8', 'icp9', 'icp10'];

const pngBuffers = await Promise.all(
  sizes.map(async (size, index) => {
    const pngPath = join(tmpDir, `${types[index]}.png`);
    await sharp(sourceSvg).resize(size, size).png().toFile(pngPath);
    return readFileSync(pngPath);
  }),
);

const blockSize = (buffer) => 8 + buffer.length;
const totalSize = 8 + sizes.reduce((sum, _s, i) => sum + blockSize(pngBuffers[i]), 0);

const chunks = [Buffer.from('icns'), Buffer.alloc(4)];
chunks[1].writeUInt32BE(totalSize);

for (let i = 0; i < sizes.length; i += 1) {
  const header = Buffer.alloc(8);
  header.write(types[i], 0, 4, 'ascii');
  header.writeUInt32BE(blockSize(pngBuffers[i]), 4);
  chunks.push(header, pngBuffers[i]);
}

writeFileSync(outFile, Buffer.concat(chunks));
rmSync(tmpDir, { recursive: true, force: true });
console.log(`Wrote ${outFile} (${totalSize} bytes)`);
