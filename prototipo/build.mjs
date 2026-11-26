// Gera versões de arquivo único: escala-gm.html (abre direto no navegador) e dist/artifact.html.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const dir = new URL(".", import.meta.url);
const ler = (f) => readFileSync(new URL(f, dir), "utf8");
const limpar = (src) => src.replace(/^import[\s\S]*?from\s+"[^"]+";\s*$/gm, "").replace(/^export\s+/gm, "");
const js = ["engine.js", "seed.js", "comando.js", "app.js"].map((f) => `// ---- ${f} ----\n${limpar(ler(f))}`).join("\n");
const html = ler("index.html").replace('<script type="module" src="app.js"></script>', () => `<script>\n(() => {\n${js}\n})();\n</script>`);
mkdirSync(new URL("dist/", dir), { recursive: true });
writeFileSync(new URL("dist/artifact.html", dir), html);
writeFileSync(new URL("escala-gm.html", dir), `<!doctype html>\n<html lang="pt-BR">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n</head>\n<body>\n${html}\n</body>\n</html>\n`);
console.log("ok", html.length, "bytes");
