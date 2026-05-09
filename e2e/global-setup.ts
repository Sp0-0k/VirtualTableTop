import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

export default async function globalSetup() {
  const dir = path.resolve('.e2e');
  fs.mkdirSync(dir, { recursive: true });
  const fixturePath = path.join(dir, 'map.png');
  if (!fs.existsSync(fixturePath)) {
    const png = await sharp({
      create: { width: 800, height: 600, channels: 3, background: { r: 80, g: 120, b: 60 } },
    })
      .png()
      .toBuffer();
    fs.writeFileSync(fixturePath, png);
  }
}
