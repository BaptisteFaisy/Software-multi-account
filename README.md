# Codex Switch Terminal

Terminal Tauri + xterm.js pour lancer Codex avec un `CODEX_HOME` et un proxy par compte.

## Prerequis

- Node.js 20+
- Rust + Cargo via rustup
- Codex CLI disponible dans le `PATH`

## Demarrage

```powershell
npm install
npm run dev
```

Sous Windows, tu peux aussi double-cliquer sur
`Lancer Codex Switch Terminal.cmd`. C'est l'unique lanceur : il affiche un menu
pour ouvrir l'app locale, l'app Cloud, le site web local, demarrer ou arreter le
serveur et configurer le pare-feu.

Depuis PowerShell, une action peut etre lancee directement :

```powershell
& ".\Lancer Codex Switch Terminal.cmd" app
& ".\Lancer Codex Switch Terminal.cmd" cloud
& ".\Lancer Codex Switch Terminal.cmd" web
& ".\Lancer Codex Switch Terminal.cmd" server
& ".\Lancer Codex Switch Terminal.cmd" stop
& ".\Lancer Codex Switch Terminal.cmd" firewall
```

## Fonctionnement

- L'interface propose deux modes persistants : `Simple` affiche un chat, tandis que `Expert` reprend exactement cette interface de conversation dans une grille paginee, sans plafond logiciel de chats ouverts.
- La barre laterale commune aux deux modes affiche tous les workspaces simultanement. Chaque dossier regroupe ses conversations juste sous son nom et propose son propre bouton `+` ; la recherche traverse tous les groupes sans changer de workspace. Une conversation peut etre glissee sur un autre workspace pour y etre deplacee durablement.
- Chaque chat Expert conserve independamment sa discussion, son brouillon, son compte, son mode de travail, son suivi temps reel, son tour en cours et sa position de lecture. Tous les chats restent visibles dans la grille, mais seule la conversation selectionnee affiche sa bulle de saisie.
- `Ctrl+N`, le bouton de la barre laterale et le bouton `Nouveau chat` ajoutent une conversation a la fin du mode Expert sans fermer les autres. La grille affiche au choix 6 ou 9 chats de taille uniforme par page et ouvre automatiquement la page du nouveau chat.
- Le composer des deux modes permet de choisir le modele et, pour Codex, l'intensite de raisonnement. Les intensites viennent du catalogue du modele (`model/list`) : GPT-5.6 Sol/Terra proposent donc aussi `max` et `ultra`, tandis que Luna propose `max` sans `ultra`. Ces choix sont enregistres comme valeurs du compte et transmis explicitement a chaque nouveau tour, en desktop comme en mode SaaS.
- Les comptes Codex sont des dossiers utilises comme `CODEX_HOME`.
- L'app detecte automatiquement les dossiers `~\.codex*` qui contiennent `auth.json` ou `config.toml`.
- Les profils proxy sont detectes depuis les fichiers `proxy.txt` presents dans `~\.codex*`.
- Le terminal lance un shell avec `CODEX_HOME`, `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY` et leurs variantes minuscules selon le compte selectionne.
- Chaque compte peut avoir un `Dossier projet`; les nouveaux terminaux demarrent directement dans ce dossier pour que Codex prenne ce workspace comme environnement.
- Chaque terminal capture son propre workspace a la creation. Changer de workspace actif ne modifie donc pas les sessions deja ouvertes ni celles qui sont en train de demarrer.
- La barre laterale regroupe les terminaux par workspace. Deux entrees qui designent le meme chemin sont fusionnees automatiquement avec tous leurs terminaux. Le bouton `+` d'un groupe cree directement une nouvelle session dans ce dossier, et les associations sont restaurees au prochain lancement.
- A la creation d'un compte/environnement, l'interface demande le mode de securite (bypass ou sandbox), le modele Codex par defaut et son intensite de raisonnement. Ces choix sont propres au compte.
- L'app synchronise ces choix dans le `config.toml` du `CODEX_HOME` (`approval_policy`, `sandbox_mode`, `model`, `model_reasoning_effort`), y compris lors du passage du bypass vers la sandbox.
- Les terminaux PTY restent disponibles comme outil separe ; ils ne definissent plus le mode Expert.
- Le bouton `Pool term` ouvre un nouvel onglet PTY en piochant le prochain compte qui possede un `auth.json` valide.
- La vue `Pool` permet d'importer des fichiers JSON de comptes (`*_cpa.json`, exports avec `accounts[].credentials`, dossier de JSON ou wildcard `*.json`).
- Il est aussi possible de coller directement un blob de session ChatGPT (copie de `chatgpt.com/api/auth/session`) dans la zone d'import : le champ `accessToken` est utilise comme jeton d'acces. Sans `refresh_token`, le compte est valide ~10 jours (jusqu'a l'expiration du JWT) et n'est pas renouvelable.
- Les imports creent des `CODEX_HOME` dans `%USERPROFILE%\.codex-pool-*` et ajoutent les comptes a la configuration sans stocker les tokens dans `settings.json`.
- La configuration de l'app est stockee dans `%APPDATA%\codex-switch-terminal\settings.json`.
- L'onglet `Salon` fait communiquer entre eux les agents de plusieurs terminaux (voir la section dediee ci-dessous).
- Le build Windows utilise un patch local de `tauri-utils` dans `src-tauri/vendor` pour eviter un proc-macro bloque par Windows App Control sur cette machine.

Pour ajouter un nouveau compte Codex, cree un dossier de compte dans l'interface, ouvre un terminal dessus, puis lance :

```powershell
codex login
```

Le login sera enregistre dans le `CODEX_HOME` du compte selectionne.

## Salon d'agents (communication inter-agents)

Le salon permet a plusieurs agents Codex (un par terminal) de se voir et de se
parler pendant qu'ils tournent : un canal commun facon chat de groupe, plus des
messages prives d'agent a agent. C'est utile pour faire cooperer plusieurs
agents sur une meme tache (par exemple l'un explore le code, l'autre implemente,
et ils se coordonnent), ou pour que toi, en tant qu'operateur, tu envoies une
consigne a un agent precis depuis l'app.

### En bref

```text
  Agent A (terminal 1)                         Agent B (terminal 2)
        |                                              |
        |  send_message("j'ai fini X")   [ SALON ]     |  read_messages()
        | -------------------------->  (serveur MCP) ---------------> voit le message
        |                                              |
        |  send_message("verifie Y", to=agentB)  ----------------->  DM prive
```

Chaque terminal Codex devient un participant du salon. Les agents echangent via
des outils, pas en s'injectant du texte dans le terminal : c'est propre et sans
risque de corrompre la saisie.

### Activer le salon

1. Ouvre l'onglet `Salon` (icone en haut de l'app).
2. Clique sur `Desactive` pour le passer a `Active`.

A partir de la, **chaque nouveau terminal Codex rejoint automatiquement le
salon**. Les terminaux ouverts avant l'activation doivent etre relances. Le
reglage est memorise : au prochain lancement de l'app, le salon redemarre tout
seul s'il etait actif.

### Ce que les agents peuvent faire

Une fois le salon actif, chaque agent Codex voit 5 outils MCP `agent_room` :

- `list_agents` / `whoami` : lister les agents presents / connaitre sa propre
  identite (son `ident` public).
- `send_message(text)` : diffuser un message a tout le salon.
- `send_message(text, to)` : envoyer un message prive (DM) a un agent precis,
  ou `to` est l'`ident` public renvoye par `list_agents`.
- `read_messages(since)` : lire les messages qui le concernent (diffusions du
  salon + DM pour lui) posterieurs a un curseur `since`.
- `wait_for_messages(since, timeoutMs)` : comme `read_messages`, mais **bloque**
  jusqu'a l'arrivee d'un nouveau message (pour attendre la reponse d'un autre
  agent sans interroger en boucle).

Les outils sont disponibles, mais c'est le modele qui decide de les utiliser :
une consigne du type « coordonne-toi avec l'autre agent via le salon » suffit a
les declencher.

### Le panneau Salon

Le panneau `Salon` affiche en direct :

- la liste des agents presents (a gauche) ;
- le fil d'activite : diffusions, DM, et messages systeme (arrivees/departs) ;
- un composer pour poster toi-meme, en tant qu'`Operateur`, un message au salon
  ou un DM a un agent choisi dans le menu deroulant. Les agents peuvent te
  repondre en DM (tu es l'`ident` reserve `operator`).

### Sous le capot

- L'app lance un petit **serveur MCP en HTTP**, en local uniquement
  (`http://127.0.0.1:8123/mcp` par defaut ; en mode SaaS il tourne dans
  `cst-server`). Tous les agents s'y connectent.
- A l'ouverture d'un terminal, l'app ajoute une entree `[mcp_servers.agent_room]`
  dans le `config.toml` du `CODEX_HOME` du compte, via `codex mcp add`. La fusion
  **ne touche pas** tes autres entrees MCP ni tes autres reglages.
- Chaque terminal recoit un **jeton unique** (`CST_ROOM_TOKEN`) injecte dans son
  environnement : c'est ce qui permet au serveur de distinguer deux agents, meme
  quand ils partagent un meme `CODEX_HOME`.
- Les messages sont conserves dans
  `%APPDATA%\codex-switch-terminal\agent-room\messages.jsonl`
  (ou `<CST_DATA_DIR>\agent-room\` en mode SaaS).

### Securite et reversibilite

- Le serveur ecoute **uniquement sur `127.0.0.1`** (jamais expose au reseau) et
  un jeton inconnu est refuse (`401`).
- Garde-fous integres : limite de debit par agent, taille de message bornee, et
  anti-boucle (un message identique consecutif du meme emetteur n'est pas rejoue).
- **Desactiver** le salon retire l'entree `agent_room` de chaque `CODEX_HOME`
  (`codex mcp remove`) : ton `config.toml` revient a l'etat d'avant. Tant que le
  salon est desactive, l'app n'ecrit **rien** dans les `CODEX_HOME`.
- Le provisioning appelle le binaire `codex` : s'il n'est pas dans le `PATH` du
  process de l'app, le terminal demarre quand meme, simplement sans salon.

### En mode SaaS

Le salon fonctionne aussi cote serveur : il est monte dans `cst-server`
(endpoint `/mcp` + API `/api/room/status`, `/api/room/messages`,
`/api/room/send`). Les agents lances par le serveur le rejoignent en local, et
le panneau `Salon` de l'interface web fonctionne a l'identique.

## Mode SaaS MVP

Le mode SaaS ajoute un serveur Rust/Axum qui sert le frontend web et lance les
terminaux sur une VM distante. En v1, les terminaux tournent directement sur
l'hote sous l'utilisateur du service : a utiliser uniquement pour toi ou des
utilisateurs de confiance.

### Demarrage avec ton PC comme serveur

Au debut, tu peux utiliser ton PC Windows comme serveur. Lance simplement :

```powershell
& ".\Lancer Codex Switch Terminal.cmd" server
```

Le script :

- cree un dossier serveur dans `%APPDATA%\codex-switch-terminal-server`
- genere un token admin local la premiere fois
- build le frontend / serveur si besoin
- demarre `cst-server` en local sur `127.0.0.1:8080` (aucune fenetre pare-feu)
- affiche l'URL locale a ouvrir : `http://127.0.0.1:8080`

Par defaut le serveur n'ecoute qu'en local, donc aucune fenetre "Pare-feu
Windows". Pour l'ouvrir aux autres appareils du meme reseau (telephone, autre
PC, noeud Oracle), definis `CST_BIND` avant le lanceur :

```powershell
$env:CST_BIND = "0.0.0.0:8080"
& ".\Lancer Codex Switch Terminal.cmd" server
```

La fenetre pare-feu n'apparait alors qu'une seule fois (ou lance une bonne fois
`scripts/allow-local-server-firewall.ps1` en admin), et le lanceur affiche
l'URL reseau, par exemple `http://192.168.1.20:8080`. Ouvre l'URL affichee puis
colle le token admin affiche dans la console.

Pour ouvrir directement le site web dans ton navigateur :

```powershell
& ".\Lancer Codex Switch Terminal.cmd" web
```

Ce lanceur demarre le serveur si besoin, ouvre `http://127.0.0.1:8080`, et
copie le token admin dans le presse-papiers pour que tu puisses le coller dans
l'ecran de connexion. Pour l'arreter :

```powershell
& ".\Lancer Codex Switch Terminal.cmd" stop
```

Par defaut le serveur n'ecoute qu'en local (`127.0.0.1`), donc aucune fenetre
pare-feu. Pour l'ouvrir depuis un telephone ou un autre PC du meme reseau,
definis `CST_BIND=0.0.0.0:8080` avant de lancer le serveur : le lanceur affiche
alors l'URL reseau, par exemple `http://192.168.1.20:8080`.

### Setup PC + Oracle avec choix automatique

Le setup le plus simple est de mettre tes machines dans le meme reseau prive
Tailscale/WireGuard, puis de lancer un `cst-server` sur chaque machine.
L'app ou le site garde Oracle comme serveur principal, mais les nouveaux
terminaux peuvent partir sur ton PC si disponible, sinon sur Oracle.

1. Lance le serveur sur ton PC en l'exposant au reseau prive (sinon il n'ecoute
qu'en local) :

```powershell
$env:CST_BIND = "0.0.0.0:8080"
& ".\Lancer Codex Switch Terminal.cmd" server
```

Note l'URL Tailscale ou LAN du PC et le token admin. La premiere fois, accepte
la fenetre pare-feu (ou lance une bonne fois `scripts/allow-local-server-firewall.ps1`
en admin). Le script annonce aussi le nom du noeud et sa capacite.

2. Lance le serveur sur Oracle avec les memes fichiers `dist/` et `cst-server`.
Dans `/etc/codex-switch-terminal.env`, mets au minimum :

```bash
CST_BIND=0.0.0.0:8080
CST_DATA_DIR=/srv/cst
CST_STATIC_DIR=/opt/codex-switch-terminal/dist
CST_PUBLIC_BASE_URL=http://IP_TAILSCALE_ORACLE:8080
CST_ADMIN_TOKEN=le-meme-token-que-le-pc
CST_GIT_PAT=
CST_NODE_ID=oracle-free
CST_NODE_LABEL=Oracle Free
CST_NODE_CAPACITY=1
```

3. Importe les memes comptes Codex sur les deux serveurs, ou copie le meme
`settings.json` et les dossiers `codex-homes/` dans les deux `CST_DATA_DIR`.
Le choix automatique retente un autre noeud si le compte n'existe pas sur le
premier, mais le routage est plus fluide si les comptes sont synchronises.

4. Ouvre l'app Cloud ou le site Oracle. Sur l'ecran de connexion :

```text
Serveur: http://IP_TAILSCALE_ORACLE:8080
Token admin: le-meme-token-que-le-pc
Noeuds terminaux auto:
PC local|http://IP_TAILSCALE_PC:8080||0
Oracle Free|http://IP_TAILSCALE_ORACLE:8080||20
```

Format d'une ligne : `Nom|URL|token optionnel|priorite`. Un token vide reutilise
le token admin principal. Plus la priorite est basse, plus le noeud est prefere.
Au clic sur `Terminal`, l'app appelle `/api/health` sur chaque noeud et choisit
le meilleur score `terminaux actifs / capacite + priorite`.

### Application Android

Un client Android natif est disponible dans `android/`. Il embarque une WebView
qui se connecte au serveur SaaS, garde l'URL et le token admin dans le stockage
local de l'app, puis laisse l'interface web lancer les terminaux via HTTP et
WebSocket.

Pour l'utiliser :

```powershell
& ".\Lancer Codex Switch Terminal.cmd" server
```

Puis ouvre `android/` dans Android Studio, lance l'app sur ton telephone, colle
l'URL reseau affichee par le serveur et le token admin. Les details de build
sont dans `android/README.md`.

Pour verifier depuis l'app desktop connectee au serveur local, lance :

```powershell
& ".\Codex Switch Terminal Cloud.exe"
```

Cette variante force le mode SaaS, pointe par defaut vers
`http://127.0.0.1:8080` et recupere automatiquement le token local dans
`%APPDATA%\codex-switch-terminal-server\server.local.env.ps1`.

Tu peux aussi passer par le lanceur unique :

```powershell
& ".\Lancer Codex Switch Terminal.cmd" cloud
```

Le token et le PAT Git local se trouvent dans :

```text
%APPDATA%\codex-switch-terminal-server\server.local.env.ps1
```

Pour cloner des repos prives, renseigne `CST_GIT_PAT` dans ce fichier puis
relance le serveur.

Si l'URL ne repond pas depuis un autre appareil, autorise le port 8080 dans le
pare-feu Windows :

```powershell
& ".\Lancer Codex Switch Terminal.cmd" firewall
```

Cette etape ouvre uniquement le port TCP 8080 sur le profil reseau prive.

### Build local

```powershell
npm run build:frontend
npm run build:server
```

Le binaire serveur est produit dans :

```text
src-tauri/target/release/cst-server
```

### Variables d'environnement

Copie `deploy/cst-server.env.example` vers `/etc/codex-switch-terminal.env` sur
la VM, puis remplace au minimum :

- `CST_PUBLIC_BASE_URL` par `http://IP_DE_LA_VM:8080`
- `CST_ADMIN_TOKEN` par un token long et aleatoire
- `CST_GIT_PAT` par un token GitHub/GitLab si tu clones des repos prives

Les donnees serveur vivent par defaut dans `/srv/cst` :

- `settings.json`
- `codex-homes/`
- `workspaces/`
- `logs/`

### Lancement manuel

```bash
export CST_ADMIN_TOKEN="change-me"
export CST_GIT_PAT="ghp_xxx"
export CST_PUBLIC_BASE_URL="http://IP_DE_LA_VM:8080"
./cst-server
```

L'interface web est ensuite disponible sur `http://IP_DE_LA_VM:8080`.

### Service systemd

Sur Ubuntu, cree un utilisateur dedie puis installe le service :

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin cst
sudo mkdir -p /opt/codex-switch-terminal /srv/cst
sudo chown -R cst:cst /srv/cst
sudo cp deploy/codex-switch-terminal.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now codex-switch-terminal
```

Le frontend doit etre copie dans `/opt/codex-switch-terminal/dist` et le binaire
`cst-server` dans `/opt/codex-switch-terminal/cst-server`.

## Execution multi-agents isolee (sans plafond logiciel)

Chaque terminal et chaque tour de chat recoit desormais :

- un worktree Git detache propre (ou une copie physique pour un dossier non-Git) ;
- un `CODEX_HOME` / `CLAUDE_CONFIG_DIR` propre ;
- `CST_AGENT_ID`, `CST_WORKSPACE_ID` et `CST_BASE_SHA` ;
- les conventions `AGENTS.md` et `CLAUDE.md` dans son home isole ;
- les outils MCP du salon pour les messages, le task board et la merge queue.

En SaaS, un seul miroir bare est maintenu par URL de depot et les agents ne
font plus chacun un clone complet. Les chemins runtime se trouvent sous
`<CST_DATA_DIR>/agents/` (`mirrors`, `workspaces`, `agent-homes`, `recoveries`).
Les transcripts sont recopies dans le home canonique a la fin du process ; les
configs temporaires ne le sont jamais.

Workflow agent recommande :

1. `claim_task({ taskId, description })` ;
2. travailler et committer dans le worktree courant ;
3. `submit_for_merge({ verify: true|false })` ;
4. suivre `merge_status({ id })` et `list_landed()` ;
5. en cas de conflit, rebaser depuis la nouvelle base annoncee dans le salon et
   resoumettre.

La file est FIFO avec un seul worker. Elle rejoue les commits sur la tete
courante, lance eventuellement le verify, puis effectue un CAS sur la ref cible.
Le journal durable de merge est separe de `messages.jsonl`. Pour un miroir SaaS,
le land met a jour la branche du miroir local ; le push/deploiement distant reste
une etape explicite. Pour un checkout local dont `main` est actuellement ouvert,
le fast-forward n'est accepte que si le checkout est propre.

Variables utiles :

- `CST_MAX_AGENTS` : `0`, absent ou `unlimited` = admission sans plafond
  logiciel (comportement par defaut). Une valeur positive reactive un cap dur ;
- `CST_NODE_CAPACITY` : indice de capacite utilise par le routage SaaS, sans
  refuser la creation de nouveaux agents ;
- `CST_MERGE_VERIFY_COMMAND` : commande executee dans le worktree d'integration
  lorsque la soumission demande `verify: true`.

Des verrous d'ownership OS garantissent qu'un seul processus ecrit un store
`agent-room`/merge donne et qu'un seul processus admet/nettoie les worktrees
d'un runtime agents. Les autres instances sont passives ou refusees au demarrage
et doivent passer par l'endpoint REST/MCP du processus proprietaire. Le journal du salon est
segmente a 16 Mio, garde huit segments et borne son index memoire a 20 000
messages. Le sweeper ne supprime jamais un lease dont le PID proprietaire est
encore vivant ; apres crash, commits et home sont conserves dans les recoveries.
