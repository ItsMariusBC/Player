import { parseFile } from "music-metadata";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const songFormats = ['mp3', 'ogg', 'wav', 'mp4', 'webm']

// Audio files directly in public/ land at the root of the queue; files in a
// sub-directory (public/<Folder>/track.mp3) get `folder: "<Folder>"`.
async function listAudioFiles(dir, prefix = "") {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await listAudioFiles(path.join(dir, entry.name), relative)));
    else if (songFormats.includes(path.extname(entry.name).slice(1))) files.push(relative);
  }
  return files;
}

async function main() {
  const audioFiles = await listAudioFiles("./public");
  const items = [];

  const tasks = audioFiles.map(async (item) => {
    const metadata = await parseFile(path.resolve("public", item));
    const folder = path.dirname(item);

    const base = {
      name: metadata.common.title,
      author: metadata.common.artist,
      url: `/${item}`,
    };
    if (folder !== ".") base.folder = folder;

    if (metadata.common.picture) {
      const { format, data } = metadata.common.picture[0];
      const ext = format.split("/")[1];
      const name = `${item}-info.${ext}`;

      await fs.writeFile(path.resolve("public", name), data);
      base.picture = `/${name}`;
    }

    items.push(base);
  });

  await Promise.all(tasks);
  items.sort((a, b) => a.url.localeCompare(b.url));
  await fs.writeFile("./music/data.json", `${JSON.stringify(items, null, 2)}\n`);
  console.log(`${items.length} items written.`)
}

void main();
