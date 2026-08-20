import { readFile, writeFile } from "node:fs/promises";
import { processImage, fastCutServer, decodeToImage } from "./worker.mjs";

const files = [
  { name: "logo39", path: "C:/Users/bapti/Downloads/téléchargement (39).jpg" },
  { name: "anneaux36", path: "C:/Users/bapti/Downloads/téléchargement (36).jpg" },
];
for (const f of files) {
  const buf = await readFile(f.path);
  const out = await processImage(buf);
  console.log(f.name, "->", out.guess.kind, "| pipeline:", out.pipeline, "| alpha:", out.buffer.length, "bytes");
  await writeFile(`C:/Users/bapti/AppData/Local/Temp/srv-${f.name}.png`, out.buffer);
}
console.log("OK");