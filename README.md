# Codex Switch Terminal

Application Tauri + xterm.js pour utiliser plusieurs comptes Codex ou Claude,
ouvrir des chats et lancer des terminaux dans un projet choisi.

## Principe

Le fonctionnement est volontairement direct :

- un chat ou un terminal s'execute dans le dossier projet selectionne ;
- le compte utilise son `CODEX_HOME` ou son `CLAUDE_CONFIG_DIR` habituel ;
- les fichiers et le depot Git ouverts sont ceux du dossier selectionne ;
- un terminal existant garde son dossier, meme si l'environnement actif change ;
- les discussions, terminaux et comptes restent regroupes dans l'interface.

Les commandes Git habituelles fonctionnent exactement comme dans un terminal
classique, sans protocole interne supplementaire.

## Prerequis

- Node.js 20+
- Rust et Cargo via rustup
- Codex CLI ou Claude CLI disponible dans le `PATH`

## Demarrage desktop

```powershell
npm install
npm run dev
```

Sous Windows, tu peux aussi double-cliquer sur
`Lancer Codex Switch Terminal.cmd`. Le lanceur propose l'application locale,
l'application Cloud, le site web local et les commandes du serveur.

Depuis PowerShell :

```powershell
& ".\Lancer Codex Switch Terminal.cmd" app
& ".\Lancer Codex Switch Terminal.cmd" cloud
& ".\Lancer Codex Switch Terminal.cmd" web
& ".\Lancer Codex Switch Terminal.cmd" server
& ".\Lancer Codex Switch Terminal.cmd" stop
```

## Git : mise a jour et push

Pour mettre a jour un checkout propre :

```powershell
git pull --ff-only
```

Pour publier une modification :

```powershell
git add <fichiers>
git commit -m "description courte"
git pull --rebase
git push
```

Si le depot distant avance entre le rebase et le push, relance simplement
`git pull --rebase`, les controles utiles, puis `git push`. Aucun push force
n'est necessaire.

## Comptes et environnements

- Les comptes Codex sont des dossiers utilises comme `CODEX_HOME`.
- L'application detecte les dossiers `~\.codex*` contenant `auth.json` ou
  `config.toml`.
- Les profils proxy sont lus depuis les fichiers `proxy.txt` de ces dossiers.
- Le terminal transmet `CODEX_HOME`, `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`
  et leurs variantes minuscules selon le compte selectionne.
- Un environnement projet doit etre choisi explicitement avant de lancer un
  chat ou un terminal.
- Les reglages de l'application sont stockes dans
  `%APPDATA%\codex-switch-terminal\settings.json`.

Pour connecter un nouveau compte Codex, cree son dossier dans l'interface,
ouvre un terminal avec ce compte, puis lance :

```powershell
codex login
```

## Fonctionnalites principales

- grille paginee de chats independants ;
- choix du compte, du modele et de l'intensite de raisonnement ;
- reprise, deplacement et archivage des discussions ;
- terminaux PTY groupes par environnement ;
- import de comptes depuis des exports JSON ;
- suivi des quotas et selection d'un compte disponible ;
- interface desktop, web et mobile.

## Serveur web local

Pour utiliser le PC comme serveur :

```powershell
& ".\Lancer Codex Switch Terminal.cmd" server
```

Le serveur ecoute par defaut sur `127.0.0.1:8080`. Pour l'ouvrir aux appareils
du reseau local :

```powershell
$env:CST_BIND = "0.0.0.0:8080"
& ".\Lancer Codex Switch Terminal.cmd" server
```

Le token administrateur et le PAT Git local sont conserves dans :

```text
%APPDATA%\codex-switch-terminal-server\server.local.env.ps1
```

Pour autoriser le port 8080 sur le profil reseau prive :

```powershell
& ".\Lancer Codex Switch Terminal.cmd" firewall
```

En mode serveur, une URL de depot est clonee normalement dans le repertoire de
donnees. Les chats et terminaux utilisent ensuite directement ce clone.

## Build et tests

```powershell
npm run build:frontend
npm run build:server
npm run test:frontend
```

Pour construire l'application desktop :

```powershell
npm run build
```

Pour nettoyer tous les artefacts de build :

```powershell
npm run clean
```

## Deploiement serveur

Copie `deploy/cst-server.env.example` vers
`/etc/codex-switch-terminal.env`, puis configure au minimum :

- `CST_PUBLIC_BASE_URL` ;
- `CST_ADMIN_TOKEN` ;
- `CST_GIT_PAT` si des depots prives doivent etre clones.

Lancement manuel :

```bash
export CST_ADMIN_TOKEN="change-me"
export CST_GIT_PAT="ghp_xxx"
export CST_PUBLIC_BASE_URL="http://IP_DE_LA_VM:8080"
./cst-server
```

Le frontend compile doit etre place dans `dist/` a cote du binaire serveur.

## Mobile

Le client web est installable en PWA. Les projets Tauri mobiles peuvent etre
initialises avec :

```powershell
npx tauri android init
npx tauri ios init
```

Android necessite Android Studio et le SDK Android. iOS necessite macOS, Xcode
et un compte Apple Developer pour une distribution signee.
