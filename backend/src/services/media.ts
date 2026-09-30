import { promises as fs } from 'node:fs';
import path from 'node:path';
import { config } from '../config';

/** Write a silent PCM WAV (16kHz mono 16-bit). Used by the stub TTS provider. */
export async function writeSilentWav(filePath: string, seconds: number): Promise<void> {
  const sampleRate = 16000;
  const samples = Math.max(1, Math.floor(sampleRate * seconds));
  const dataSize = samples * 2;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  const data = Buffer.alloc(dataSize); // silence
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, Buffer.concat([header, data]));
}

/** Write a simple SVG slate card (viewable placeholder for stub image/video artifacts). */
export async function writeSlateSvg(filePath: string, title: string, lines: string[]): Promise<void> {
  const text = lines.map((l, i) => `<text x="40" y="${120 + i * 34}" fill="#c4b5fd" font-size="22" font-family="monospace">${escapeXml(l)}</text>`).join('\n');
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">` +
    `<rect width="960" height="540" fill="#0b0713"/>` +
    `<text x="40" y="70" fill="#8b5cf6" font-size="30" font-family="monospace" font-weight="bold">${escapeXml(title)}</text>` +
    `${text}</svg>`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, svg);
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Absolute dir for a job's artifacts; also returns the URL prefix. */
export async function jobArtifactDir(userId: string, jobId: string): Promise<{ dir: string; urlPrefix: string }> {
  const dir = path.join(config.artifactDir, userId, jobId);
  await fs.mkdir(dir, { recursive: true });
  return { dir, urlPrefix: `/artifacts/${userId}/${jobId}` };
}
