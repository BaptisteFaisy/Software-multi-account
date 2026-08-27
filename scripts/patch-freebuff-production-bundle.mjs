import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const EXPECTED_BUNDLE_SHA256 =
  "7794cdc1d04414df56234112aabf76a148fb0bf458e75b24bef6d998ef02a989";
const OLD_BUILD_ID = "mtavgwo8-81m2smoh";
const NEW_BUILD_ID = "freebuff-focus-v20-20260827";
const OLD_SERVICE_WORKER_VERSION = 'const SW_VERSION = "5";';
const NEW_SERVICE_WORKER_VERSION = 'const SW_VERSION = "24";';

const [inputArg, outputArg] = process.argv.slice(2);
if (!inputArg || !outputArg) {
  throw new Error(
    "Usage: node scripts/patch-freebuff-production-bundle.mjs <dist-source> <dist-sortie>",
  );
}

const inputDir = resolve(inputArg);
const outputDir = resolve(outputArg);
if (inputDir === outputDir) throw new Error("La source et la sortie doivent etre distinctes.");

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const replaceOnce = (source, before, after, label) => {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Signature absente: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Signature ambigue: ${label}`);
  }
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
};

const sourceIndex = readFileSync(join(inputDir, "index.html"), "utf8");
const activeAssetMatch = sourceIndex.match(/import\("(\/assets\/index-[^"]+\.js)"\)/);
if (!activeAssetMatch) throw new Error("Bundle frontend actif introuvable dans index.html.");

const activeRelativePath = activeAssetMatch[1].slice(1);
const activeSourcePath = join(inputDir, ...activeRelativePath.split("/"));
const activeSource = readFileSync(activeSourcePath, "utf8");
const activeHash = sha256(activeSource);
if (activeHash !== EXPECTED_BUNDLE_SHA256) {
  throw new Error(
    `Bundle refuse: SHA-256 ${activeHash}, attendu ${EXPECTED_BUNDLE_SHA256}.`,
  );
}

let patched = activeSource;

patched = replaceOnce(
  patched,
  "let t=document.activeElement;Ab=t&&j.find(e=>e.terminal.element?.contains(t))?.key||null;let n=",
  "let t=document.activeElement;Ab=t&&j.find(e=>e.terminal.element?.contains(t))?.key||(!t||t===document.body||t===rb||bD()!==null||eC||TC||QE||aD?Ab:null);let n=",
  "memoire de focus pendant les rerendus et modales",
);

patched = replaceOnce(
  patched,
  "DD=e=>{window.setTimeout(()=>{let t=ED(e),n=bD();if(t&&(!n||n.contains(t))){t.focus();return}OD()},0)}",
  "DD=e=>{let t=()=>{let n=bD(),r=j.find(e=>e.key===fb&&e.terminal.element?.isConnected)??j.find(e=>e.terminal.element?.isConnected);if(!n&&r){jb=r.key,Ab=r.key,r.terminal.focus();if(r.terminal.element?.contains(document.activeElement)){jb=null;return}window.setTimeout(t,100);return}if(n){window.setTimeout(t,100);return}let i=ED(e);if(i&&(!n||n.contains(i))){i.focus();return}OD()};window.setTimeout(t,0)}",
  "retour de focus apres fermeture de toute modale",
);

patched = replaceOnce(
  patched,
  "sG=()=>{let e=wD(`new-terminal`);eC=!1,X(),DD(e)}",
  "switchRestoreFreebuffTerminalFocus=()=>{let e=0,t=()=>{if(j.length===0)return;if(bD()){e++<50&&window.setTimeout(t,100);return}let n=j.find(e=>e.key===fb&&e.terminal.element?.isConnected)??j.find(e=>e.terminal.element?.isConnected);if(n){jb=n.key,Ab=n.key,n.terminal.focus();if(n.terminal.element?.contains(document.activeElement)){jb=null;return}}e++<50&&window.setTimeout(t,100)};window.setTimeout(t,0)},sG=()=>{let e=wD(`new-terminal`);switchRestoreFreebuffTerminalFocus(),eC=!1,X(),DD(e)}",
  "reprise tardive du focus apres fermeture de la modale terminal",
);

patched = replaceOnce(
  patched,
  "e.key!==`Enter`||!(e.target instanceof HTMLTextAreaElement)||!e.target.matches(`.xterm-helper-textarea`)||n()",
  "e.key!==`Enter`||e.target?.tagName!==`TEXTAREA`||!e.target.matches(`.xterm-helper-textarea`)||n()",
  "verification du champ xterm sans constructeur global",
);

patched = replaceOnce(
  patched,
  "M===`terminal`&&(jb=fb),X(),M===`terminal`&&CR()",
  "M===`terminal`&&(jb=fb,switchRestoreFreebuffTerminalFocus()),X(),M===`terminal`&&CR()",
  "reprise du focus lors du retour a la vue terminal",
);

patched = replaceOnce(
  patched,
  "return s.onData(e=>{if(l.ptyId!==null&&l.running){",
  "return s.onData(e=>{Ab=l.key,fb=l.key,jb===l.key&&(jb=null);if(l.ptyId!==null&&l.running){",
  "routage onData vers la session xterm emettrice",
);

patched = replaceOnce(
  patched,
  "fb=r.key,r.terminal.focus();let e=t.querySelector(`.xterm-helper-textarea`);e&&!e.disabled&&e.focus({preventScroll:!0})",
  "fb=r.key,Ab=r.key,r.terminal.focus();let e=t.querySelector(`.xterm-helper-textarea`);e&&!e.disabled&&e.focus({preventScroll:!0}),r.terminal.element?.contains(document.activeElement)&&jb===r.key&&(jb=null)",
  "focus capture du terminal monte",
);

patched = replaceOnce(
  patched,
  "document.querySelectorAll(`[data-expert-terminal-pane]`).forEach(t=>{t.addEventListener(`pointerdown`,n=>{if(n.target.closest(`[data-close-terminal],[data-toggle-chat-sidebar],[data-toggle-terminal-fullscreen],[data-freebuff-terminal-account]`))return;let r=j.find(e=>e.key===t.dataset.expertTerminalPane);r&&(e(r,!0),window.requestAnimationFrame(()=>r.terminal.focus()))})})",
  "document.querySelectorAll(`[data-expert-terminal-pane]`).forEach(t=>{t.addEventListener(`pointerdown`,n=>{let r=j.find(e=>e.key===t.dataset.expertTerminalPane);if(!r)return;e(r,!1);if(!n.target.closest(`[data-terminal-host]`))return;jb=r.key,Ab=r.key,window.requestAnimationFrame(()=>{r.terminal.focus(),r.terminal.element?.contains(document.activeElement)&&jb===r.key&&(jb=null)})},!0),t.addEventListener(`focusin`,n=>{let r=j.find(e=>e.key===t.dataset.expertTerminalPane);r&&r.terminal.element?.contains(n.target)&&(e(r,!1),Ab=r.key,jb===r.key&&(jb=null))},!0)})",
  "selection par clic et focusin du panneau exact",
);

patched = replaceOnce(
  patched,
  "let r=bD()!==null||eC||TC||QE||aD,i=jb??Ab;if(!r&&i){let t=Array.from(document.querySelectorAll(`[data-claude-login-code-input]`)).find(e=>e.dataset.claudeLoginCodeInput===i),n=Array.from(document.querySelectorAll(`[data-opencode-login-key-input]`)).find(e=>e.dataset.opencodeLoginKeyInput===i),r=e.get(i)??null;t?t.focus():n?n.focus():r?.terminal.focus(),(t||n||r)&&(jb===i&&(jb=null),r&&window.requestAnimationFrame(()=>{window.requestAnimationFrame(()=>{M===`terminal`&&!bD()&&r.running&&r.terminal.element?.isConnected&&r.terminal.focus()})}))}",
  "let r=bD()!==null||eC||TC||QE||aD,i=jb??Ab;if(!r&&i){let t=Array.from(document.querySelectorAll(`[data-claude-login-code-input]`)).find(e=>e.dataset.claudeLoginCodeInput===i),n=Array.from(document.querySelectorAll(`[data-opencode-login-key-input]`)).find(e=>e.dataset.opencodeLoginKeyInput===i),r=e.get(i)??null,a=()=>{let e=t&&document.activeElement===t||n&&document.activeElement===n||r?.terminal.element?.contains(document.activeElement);e&&(Ab=i,jb===i&&(jb=null))};t?t.focus():n?n.focus():r?.terminal.focus(),a(),r&&window.requestAnimationFrame(()=>{window.requestAnimationFrame(()=>{M===`terminal`&&!bD()&&r.running&&r.terminal.element?.isConnected&&(r.terminal.focus(),a())})})}",
  "confirmation du focus avant consommation de la demande",
);

patched = replaceOnce(
  patched,
  "yb.forget(e),PG.delete(e);let i=Kj(n).key",
  "yb.forget(e),PG.delete(e),Ab===e&&(Ab=null),jb===e&&(jb=null);let i=Kj(n).key",
  "oubli du focus a la fermeture",
);

patched = replaceOnce(
  patched,
  `Fn=\`/service-worker.js?build=${OLD_BUILD_ID}\``,
  `Fn=\`/service-worker.js?build=${NEW_BUILD_ID}\``,
  "version du service worker",
);

const patchedHash = sha256(patched);
const patchedName = `index-${patchedHash.slice(0, 8)}.js`;
const patchedRelativePath = `assets/${patchedName}`;

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });
cpSync(inputDir, outputDir, { recursive: true });

const patchedPath = join(outputDir, "assets", patchedName);
writeFileSync(patchedPath, patched);
writeFileSync(`${patchedPath}.gz`, gzipSync(Buffer.from(patched), { level: 9 }));
writeFileSync(
  `${patchedPath}.br`,
  brotliCompressSync(Buffer.from(patched), {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  }),
);

let patchedIndex = sourceIndex.replace(activeAssetMatch[1], `/${patchedRelativePath}`);
if (!patchedIndex.includes(OLD_BUILD_ID)) {
  throw new Error("Identifiant de build absent de index.html.");
}
patchedIndex = patchedIndex.replaceAll(OLD_BUILD_ID, NEW_BUILD_ID);
const patchedIndexPath = join(outputDir, "index.html");
writeFileSync(patchedIndexPath, patchedIndex);
writeFileSync(`${patchedIndexPath}.gz`, gzipSync(Buffer.from(patchedIndex), { level: 9 }));
writeFileSync(
  `${patchedIndexPath}.br`,
  brotliCompressSync(Buffer.from(patchedIndex), {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  }),
);

const serviceWorkerPath = join(outputDir, "service-worker.js");
const serviceWorker = replaceOnce(
  readFileSync(serviceWorkerPath, "utf8"),
  OLD_SERVICE_WORKER_VERSION,
  NEW_SERVICE_WORKER_VERSION,
  "version du fichier service worker",
);
writeFileSync(serviceWorkerPath, serviceWorker);
writeFileSync(`${serviceWorkerPath}.gz`, gzipSync(Buffer.from(serviceWorker), { level: 9 }));
writeFileSync(
  `${serviceWorkerPath}.br`,
  brotliCompressSync(Buffer.from(serviceWorker), {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  }),
);

const manifest = {
  originalBundle: basename(activeSourcePath),
  originalSha256: activeHash,
  patchedBundle: patchedName,
  patchedSha256: patchedHash,
  buildId: NEW_BUILD_ID,
  serviceWorkerVersion: "24",
};
writeFileSync(
  join(outputDir, "freebuff-focus-hotfix.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

console.log(JSON.stringify(manifest, null, 2));
