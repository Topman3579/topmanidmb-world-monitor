import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const markPath = path.join(repoRoot, 'public/brand/topmanidmb-logo-mark.svg');
const outputPath = path.join(
  repoRoot,
  'public/brand/topmanidmb-world-intelligence-og.png',
);

const background = Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <defs>
      <radialGradient id="glow" cx="80%" cy="28%" r="72%">
        <stop offset="0%" stop-color="#183765"/>
        <stop offset="52%" stop-color="#091b34"/>
        <stop offset="100%" stop-color="#030a15"/>
      </radialGradient>
      <linearGradient id="gold" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#fff1aa"/>
        <stop offset="45%" stop-color="#ffcb2d"/>
        <stop offset="100%" stop-color="#b8790b"/>
      </linearGradient>
      <linearGradient id="cyan" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#55c7ff"/>
        <stop offset="100%" stop-color="#86e9ff"/>
      </linearGradient>
      <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#00040c" flood-opacity=".65"/>
      </filter>
    </defs>

    <rect width="1200" height="630" fill="url(#glow)"/>
    <path d="M0 0H1200V630H0Z" fill="none" stroke="#ffcb2d" stroke-opacity=".22" stroke-width="4"/>
    <circle cx="975" cy="118" r="260" fill="none" stroke="#4dbbff" stroke-opacity=".08" stroke-width="2"/>
    <circle cx="975" cy="118" r="195" fill="none" stroke="#ffcb2d" stroke-opacity=".08" stroke-width="2"/>
    <path d="M510 118H1080" stroke="#5bc8ff" stroke-opacity=".16" stroke-width="2"/>
    <path d="M510 520H1080" stroke="#ffcb2d" stroke-opacity=".18" stroke-width="2"/>

    <rect x="72" y="93" width="314" height="314" rx="58"
      fill="#061326" stroke="url(#gold)" stroke-opacity=".42" stroke-width="2"
      filter="url(#shadow)"/>

    <text x="452" y="196" fill="url(#gold)"
      font-family="-apple-system, BlinkMacSystemFont, Inter, Arial, sans-serif"
      font-size="42" font-weight="800" letter-spacing="8">TOPMANIDMB</text>
    <text x="450" y="273" fill="#f7fbff"
      font-family="-apple-system, BlinkMacSystemFont, Inter, Arial, sans-serif"
      font-size="58" font-weight="800" letter-spacing="1">WORLD INTELLIGENCE</text>
    <text x="452" y="326" fill="url(#cyan)"
      font-family="-apple-system, BlinkMacSystemFont, Inter, Arial, sans-serif"
      font-size="28" font-weight="600">Global situation dashboard</text>
    <text x="452" y="373" fill="#d8e6f7"
      font-family="Thonburi, Noto Sans Thai, -apple-system, sans-serif"
      font-size="25" font-weight="500">ศูนย์ติดตามสถานการณ์โลก</text>

    <rect x="451" y="413" width="666" height="54" rx="27"
      fill="#0b2541" stroke="#57c8ff" stroke-opacity=".35"/>
    <text x="484" y="448" fill="#bcd4ea"
      font-family="-apple-system, BlinkMacSystemFont, Inter, Arial, sans-serif"
      font-size="17" font-weight="700" letter-spacing="2.2">NEWS · CONFLICT · MARKETS · AVIATION · CLIMATE · DISASTERS</text>

    <text x="452" y="553" fill="#839cb8"
      font-family="-apple-system, BlinkMacSystemFont, Inter, Arial, sans-serif"
      font-size="17" font-weight="500">Powered by World Monitor · Open-source intelligence</text>
  </svg>
`);

const logo = await sharp(markPath)
  .resize(260, 260, { fit: 'contain' })
  .png()
  .toBuffer();

await sharp(background)
  .composite([{ input: logo, left: 99, top: 120 }])
  .png({ compressionLevel: 9, adaptiveFiltering: true })
  .toFile(outputPath);

console.log(`Generated ${path.relative(repoRoot, outputPath)}`);
