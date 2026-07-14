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

### Memoire des chats

- Une conversation conserve son propre historique et reprend la meme session
  CLI apres sa fermeture ou un redemarrage.
- Chaque environnement possede aussi une **memoire partagee** visible et editable
  depuis le bouton **Memoire** de sa ligne dans le selecteur d'environnement.
  Elle est stockee dans `settings.json` et
  injectee comme contexte systeme dans tous les chats Codex et Claude de ce
  dossier, quel que soit le compte utilise.
- Les chats Codex activent en plus la memoire automatique locale du CLI. Ses
  souvenirs generes restent dans le `CODEX_HOME` du compte ; la memoire
  partagee de Switch est la couche qui garantit l'isolation par environnement.
- Une memoire est du contexte, pas un coffre-fort : n'y place aucun secret.

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
- chats autonomes persistants avec reprise, pause et planification ;
- interface desktop, web et mobile.

## Dictee vocale locale (RTX 3060 Ti)

Le bouton micro du compositeur enregistre jusqu'a cinq minutes, transcrit la
voix avec `whisper.cpp`, puis reformule la dictee avec un petit modele Ollama.
Le resultat est insere dans le champ du chat pour relecture : il n'est jamais
envoye automatiquement.

Le profil par defaut est volontairement leger pour une carte de 8 Go :

- `ggml-small-q5_1` pour la transcription francaise (whisper.cpp CUDA) ;
- `qwen3:4b-instruct-2507-q4_K_M`, environ 2,5 Go, pour nettoyer la dictee sans perdre les chemins, commandes ou negations ;
- les deux moteurs tournent l'un apres l'autre pour limiter le pic de VRAM.

### Installation Windows

1. Installe [Ollama pour Windows](https://ollama.com/download/windows), puis
   rouvre PowerShell.
2. Depuis la racine du projet, lance :

```powershell
npm run voice:setup
```

Le script verifie le GPU, telecharge le binaire CUDA officiel de
[whisper.cpp](https://github.com/ggml-org/whisper.cpp), le runtime cuBLAS
officiel NVIDIA, le modele Whisper dans
`%APPDATA%\codex-switch-terminal\voice`, puis execute
`ollama pull qwen3:4b-instruct-2507-q4_K_M`. Redemarre ensuite l'application, ouvre un chat et
clique une fois sur le micro pour parler, puis une seconde fois pour terminer.

Windows ou le navigateur demandera l'autorisation du micro au premier usage.
En cas de refus, reactive **Microphone** pour l'application dans les parametres
de confidentialite Windows. Une interface web ouverte depuis un autre appareil
doit etre servie en HTTPS pour que le navigateur autorise le micro.

### Reglages optionnels

Les valeurs suivantes doivent etre definies avant de lancer l'application ou
`cst-server` :

```powershell
# Plus leger, avec une fidelite moindre sur les autocorrections orales
ollama pull qwen3:1.7b-q4_K_M
$env:CST_VOICE_OLLAMA_MODEL = "qwen3:1.7b-q4_K_M"

# Adresse de l'API Ollama locale si elle a ete personnalisee
$env:CST_VOICE_OLLAMA_URL = "http://127.0.0.1:11434"

# Dossier ou chemins personnalises
$env:CST_VOICE_HOME = "D:\modeles\cst-voice"
$env:CST_VOICE_WHISPER_BIN = "D:\whisper\whisper-cli.exe"
$env:CST_VOICE_WHISPER_MODEL = "D:\modeles\ggml-small-q5_1.bin"
```

Pour diagnostiquer l'acceleration apres une dictee :

```powershell
nvidia-smi
ollama ps
```

La page **Parametres > Voix et GPU** affiche aussi le statut en direct sans
charger de modele : calcul vocal en cours, modele Ollama charge en attente ou
inactif. Elle indique la topologie locale/distante, la VRAM allouee et
l'activite totale rapportee par `nvidia-smi`.

En mode web/mobile, la transcription et le resume sont executes sur la machine
qui heberge `cst-server`. C'est donc cette machine qui doit posseder le GPU,
Ollama et les fichiers Whisper ; le telephone ne charge aucun modele.

### GPU distant ou datacenter

Switch peut aussi conserver l'application sur le poste local et deporter les
deux calculs : transcription vers une API compatible OpenAI, reformulation vers
un Ollama distant. Les connexions non locales exigent HTTPS et les jetons Bearer
sont lus uniquement depuis les variables d'environnement.

Le configurateur n'installe aucun modele sur le poste client :

```powershell
npm run voice:remote -- `
  -TranscriptionUrl "https://gpu.example.net/stt/v1/audio/transcriptions" `
  -TranscriptionModel "Systran/faster-whisper-small" `
  -OllamaUrl "https://gpu.example.net/ollama"
```

Le guide [GPU vocal distant](docs/remote-voice-gpu.md) decrit l'architecture,
le deploiement Docker NVIDIA de reference, l'authentification, le repli local et
les variables de configuration.

## Agents autonomes 24/7

La vue **Autonomes** permet de donner un objectif durable, par exemple :

```text
Reduire et optimiser l'utilisation des ressources de la page web, avec des
mesures avant/apres et sans regression fonctionnelle.
```

Chaque agent peut etre cree a la volee avec un nom, un role, un objectif, un
compte, un dossier projet, un planning ou un declencheur, une memoire initiale et une commande de
test. Il conserve ensuite sa conversation, ses souvenirs structures et son
journal. L'agent peut proposer des souvenirs via `AUTONOMOUS_MEMORY:` ; ils sont
dedupliques, limites et reinjectes dans les tours suivants. L'utilisateur peut
aussi ajouter ou supprimer ces souvenirs depuis la carte de l'agent.

Un chat ordinaire peut aussi servir de point de depart : le bouton
**Autonomiser** de son bandeau ouvre une configuration pre-remplie avec le
compte, l'environnement, le dernier objectif et un extrait borne du contexte
recent. La conversation d'origine reste un chat normal et n'est ni effacee ni
verrouillee ; les cycles autonomes utilisent leur propre contexte pour eviter
deux executions concurrentes sur la meme session. Une fois l'agent cree, son
statut reste visible dans le bandeau et ce meme bouton permet de modifier son
nom, son role, son objectif, sa frequence, ses garde-fous, ses connecteurs et sa
commande de validation sans quitter le chat. Si un cycle est deja en cours,
l'editeur propose d'abord une mise en pause explicite.

Sur la version web, le chat dispose aussi nativement de l'outil MCP
`create_autonomous_agent`. Une demande explicite comme « cree un agent autonome
qui surveille les regressions toutes les heures » conduit donc le modele a
appeler lui-meme l'outil, sans renvoyer vers le formulaire. Une capacite
ephemere lie chaque appel au compte, au modele, au dossier et au chat courants ;
le nouvel agent apparait ensuite automatiquement dans le bandeau de cette
conversation. Les questions purement explicatives ne declenchent aucune
creation.

Chaque boucle commence aussi par un cycle de pilotage : l'agent decide quelles
informations meritent la memoire durable, segmente l'objectif en domaines et en
taches bornees, reconcilie ce qui est fait avec les preuves disponibles, puis
choisit une seule prochaine tache. Ce carnet de travail structure est persiste
avec la strategie de memoire, les statuts `todo`, `in_progress`, `done`,
`blocked` ou `cancelled`, le domaine, la preuve et l'identifiant de la prochaine
tache. Pour un agent de recherche de bugs, il sert directement de matrice de
couverture : domaines deja testes avec leurs resultats et domaines restant a
tester. Le moteur refuse une conclusion `complete` tant que le carnet est vide
ou contient encore du travail ouvert ; un echec de la validation finale cree
automatiquement une tache de correction prioritaire.

Une premiere etape demarre immediatement, puis le moteur reprend la meme
conversation a l'intervalle choisi. L'etat est ecrit atomiquement dans
`autonomous-agents.json`. Apres un redemarrage, un agent actif est replanifie ;
apres trois echecs consecutifs il passe en **Attention requise** au lieu de
boucler indefiniment. La saturation temporaire du modele est traitee a part :
elle ne penalise pas l'agent et declenche des relances automatiques avec un
delai progressif, plafonne a une minute, jusqu'a ce que le modele reponde. Au
demarrage, un agent precedemment suspendu uniquement pour cette saturation est
egalement repris automatiquement.

Un agent peut aussi utiliser le declencheur **Modification du projet**. Dans ce
mode, aucune premiere etape n'est lancee : le moteur calcule l'empreinte des
fichiers et dossiers relatifs configures, puis l'agent dort sans consommer de
tour. Une nouvelle empreinte doit rester identique pendant le delai de
stabilisation choisi avant de produire un evenement. L'agent se reveille alors,
recoit la cause du reveil et les chemins surveilles, traite cette occurrence,
puis se rearme et se rendort apres `AUTONOMOUS_STATUS: complete` et la validation
eventuelle. Un redemarrage conserve cet etat de veille ; seul un travail
interrompu est relance immediatement.

Le modele suggere **Publieur du build** configure ce mode pour `src`, `public`
et les fichiers de configuration frontend. Il valide le projet, construit le
frontend, cree un commit, execute `git push origin HEAD`, publie atomiquement le
build sur le noeud web local avec `npm run deploy:web:local -- -SkipBuild`, puis
execute le smoke test du site `:8080`. Sa validation finale
`npm run verify:published-build` refuse de conclure tant que le depot n'est pas
propre, que `origin/<branche>` ne pointe pas sur le commit local, ou que
`dist/index.html` et ses assets ne sont pas ceux effectivement servis. La cible
peut etre remplacee avec `CST_PUBLISH_SITE_URL`.

Pour eviter qu'un premier reveil publie des changements preexistants, cette
permission ne peut etre armee que depuis une branche propre possedant un remote
`origin`. La permission **Autoriser le push GitHub
et la publication du site** est distincte du mode Build et n'est activee que
pour ce modele ou lorsqu'elle est cochee explicitement. Elle n'autorise ni
`force push`, ni suppression de branche ou de donnees, ni changement de depot,
ni publication de secrets. Les chemins, le delai, l'objectif, la validation et
cette permission restent modifiables afin de creer d'autres agents
evenementiels.

Des qu'au moins un agent utilisateur est actif ou passe en **Attention
requise**, le moteur cree aussi un **Superviseur des agents autonomes** gere par
le systeme. Il recoit un etat borne de toute la flotte, lance un premier controle
immediat puis revient toutes les heures. Il repare automatiquement les
incoherences de planification, diagnostique les erreurs et validations echouees,
et peut corriger dans le dossier projet les bugs logiciels confirmes. Il ne
modifie jamais directement le fichier d'etat, ne contourne aucune review et ne
reprend pas un agent volontairement mis en pause ou termine. Sa configuration
est protegee dans l'interface ; il se met en veille quand aucun agent utilisateur
n'est encore active.

Lorsqu'une commande de test est configuree (par exemple `npm test && npm run
build`), une declaration `complete` ne suffit pas : le moteur execute la
commande dans le dossier projet, capture stdout/stderr et applique le timeout
choisi. Un succes valide l'objectif. Un echec est memorise et provoque une
nouvelle etape de correction ; trois validations echouees suspendent l'agent.
Le bouton **Tester maintenant** permet de lancer la meme validation a la
demande. Les formes courantes de secrets presentes dans la sortie sont masquees
avant persistance ; une commande de test ne doit malgre tout jamais imprimer de
credentials.

Un agent utilisant un compte **Codex** peut recevoir un acces explicite a
**Gmail** et/ou **Google Agenda** depuis sa fiche de creation. Les connecteurs
ne sont jamais actifs par defaut : le moteur desactive toutes les apps Codex
pour le tour autonome, puis ne reactive que celles cochees. Les lectures et
recherches peuvent s'executer seules. Avant un envoi d'e-mail, une creation ou
une modification d'evenement, l'agent doit produire une demande structuree dans
le moniteur ; l'autorisation de l'utilisateur ne vaut que pour l'action decrite
et pour le tour suivant. Les outils marques destructifs restent desactives.

La connexion Google reste geree par Codex et n'est pas stockee dans Codex
Switch Terminal :

1. ouvre Codex avec le meme compte / `CODEX_HOME` que l'agent autonome ;
2. ouvre `/plugins`, installe **Gmail** et/ou **Google Calendar**, puis active le
   plugin ;
3. termine l'authentification Google demandee par le connecteur ;
4. cree l'agent autonome et coche uniquement les services necessaires.

Avec `cst-server`, plugins et authentification doivent etre configures sur
l'hote serveur dans le `CODEX_HOME` du compte selectionne, pas seulement dans
le navigateur client. Les comptes Claude ne chargent pas ces connecteurs
Codex.

Sur le site web `:8080`, ouvre **Agents autonomes**, puis **Creer un agent
autonome** : les cases **Gmail** et **Google Agenda** sont affichees dans la
section **Services Google**. Le navigateur envoie uniquement la liste des
services autorises ; les outils et la session Google restent executes sur
l'hote `cst-server`.

- En desktop, le moteur reste actif tant que l'application est ouverte.
- Pour un vrai fonctionnement 24/7 independant du navigateur, lance
  `cst-server` avec le service systemd fourni dans
  `deploy/codex-switch-terminal.service` (ou la tache planifiee Windows du
  noeud local).
- Mettre un agent en pause arrete son tour courant. La reprise le replanifie
  immediatement.
- Le moteur n'autorise pas implicitement les actions externes irreversibles :
  l'agent doit demander une intervention humaine lorsqu'une autorisation, un
  secret ou une decision est indispensable.
- La commande de test est une commande shell arbitraire executee avec les
  droits du processus desktop ou `cst-server`. La creation d'un agent qui en
  contient une reste donc reservee aux appels admin et a des utilisateurs de
  confiance.

## Chats orchestres (beta)

La vue **Chats orchestres** est separee des conversations ordinaires et des
agents autonomes 24/7. Elle construit une feature avec une equipe de chats et
un protocole de validation impose :

1. un chat orchestrateur inspecte le projet et produit un plan structure ;
2. chaque partie du plan devient un chat travailleur distinct ;
3. chaque travailleur modifie son propre worktree Git et doit soumettre une
   preuve structuree avec les fichiers touches et des tests reussis ;
4. le patch est applique dans le worktree prive de l'orchestrateur, qui le
   relit, le teste et l'accepte ou le renvoie au meme travailleur avec un retour
   actionnable ;
5. une commande de validation choisie par l'utilisateur est executee reellement
   apres chaque acceptation et apres l'audit final ;
6. une fois toutes les taches acceptees, le diff complet est applique au dossier
   source sans creer de commit utilisateur.

Le mode beta exige actuellement un depot Git propre et execute les travailleurs
sequentiellement. Cette contrainte donne a chaque agent une base deterministe et
rend les retours de revue reversibles. Si le commit ou les fichiers du depot
source changent pendant l'execution, la publication est bloquee : le rendu reste
dans le sandbox orchestrateur au lieu d'ecraser le travail intervenu entre-temps.
Les worktrees sont conserves pour inspection jusqu'a la suppression explicite
du chat orchestre.

Une preuve et des tests reduisent le risque de regression, mais ne constituent
pas une garantie mathematique d'absence de tout bug. La commande de validation
est une commande shell arbitraire executee avec les droits de l'application ou
du serveur ; cette fonctionnalite doit rester reservee a des utilisateurs de
confiance.

## RDV Lab (prototype separe)

La vue **RDV Lab** est un assistant conversationnel separe des chats principaux.
Ecris par exemple `Trouve-moi un medecin generaliste a Paris` : il interprete la
demande, lance lui-meme la recherche, affiche les propositions, comprend un
choix comme `le 2`, puis attend un `oui` explicite avant toute reservation.

Le mode **Vrai compte Doctolib** est actif par defaut. A la premiere demande,
l'assistant verifie le profil navigateur persistant et ouvre Chrome si une
connexion ou une double authentification est necessaire. Une fois la session
verifiee, il reprend automatiquement la recherche. Le mode **Bac a sable** reste
disponible pour verifier l'interface : lance `npm run dev`, ouvre
**RDV Lab**, demande un generaliste a Paris dans le chat, garde ou change la
proposition, puis ecris `oui` ou clique **Oui, prendre ce RDV**. Le backend
consomme un jeton a usage unique
et renvoie une reference `LAB-*`; aucun appel de reservation n'est envoye a
Doctolib.

Le mode **Vrai compte Doctolib** est volontairement experimental. Dans l'application
desktop, il s'execute sur le poste. Sur le site `:8080`, il s'execute sur la
machine qui heberge `cst-server` :

1. Node.js, `playwright-core` et Google Chrome doivent etre disponibles.
2. Clique **Connecter Doctolib** et termine toi-meme la connexion, la 2FA ou un
   eventuel CAPTCHA dans la fenetre Chrome visible.
3. Relance la recherche. Le prototype lit les premiers creneaux publics qui
   acceptent de nouveaux patients.
4. Le clic **Oui** autorise uniquement le creneau recapitule. Le worker le
   selectionne, confirme lorsque le parcours ne demande aucun nouveau choix,
   puis exige une page Doctolib confirmee avant d'annoncer un succes.

L'option **Ajouter ensuite a Google Calendar** est active par defaut sur une
proposition reelle et reste visible avant le clic **Oui**. Google Calendar
utilise un second profil Chrome persistant, distinct de Doctolib. Ecris
`Connecte Google Calendar` (ou utilise le bouton), puis termine toi-meme la
connexion et la 2FA dans la page Google officielle. Avant une reservation,
l'assistant impose cette connexion si la synchronisation est cochee. Apres le
clic **Oui**, il ne cree l'evenement qu'une fois la confirmation Doctolib
verifiee, clique **Enregistrer** dans Google Calendar et exige le message de
succes de Google. Le bac a sable ne cree jamais d'evenement reel.

Si Doctolib demande un choix de patient, une reponse medicale ou une nouvelle
authentification, Chrome reste visible sur la machine qui execute le moteur afin
que l'utilisateur intervienne. Le prototype ne contourne jamais ces etapes. Les
creneaux peuvent changer entre la recherche et le clic ; dans ce cas il faut
relancer la recherche. Le bac a sable fonctionne sur desktop, web et mobile. Le
mode reel du site `:8080` suppose que Node.js, Chrome, le worker et une session
graphique sont disponibles sur l'hote ; depuis un telephone, il faut donc avoir
acces a l'ecran de cette machine pour la connexion ou les questions manuelles.

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

Sur un noeud Windows distant, le demarreur utilise par defaut le sandbox Codex
`unelevated`. Il conserve l'isolation native sans ouvrir de demandes UAC sur le
PC hote lorsque des chats sont lances via Tailscale. Ce choix ne modifie pas le
sandbox de l'application desktop locale.

Pour autoriser le port 8080 sur le profil reseau prive :

```powershell
& ".\Lancer Codex Switch Terminal.cmd" firewall
```

En mode serveur, une URL de depot est clonee normalement dans le repertoire de
donnees. Les chats et terminaux utilisent ensuite directement ce clone.

## Build et tests

La verification commune controle la coherence des versions, les tests frontend
et les tests Rust :

```powershell
npm run verify
```

`npm run build` et `npm run build:server` lancent automatiquement cette
verification avant de supprimer les anciens artefacts et de compiler. Le build
desktop local produit des installateurs non signes et ne demande donc aucune
cle privee. `npm run build:signed` conserve la generation des artefacts de mise
a jour signes lorsque `TAURI_SIGNING_PRIVATE_KEY` est configuree. Les builds
Android et iOS lancent au minimum la verification rapide des versions et du
frontend. Une release GitHub est egalement bloquee avant sa creation si la
verification ou le build frontend echoue ; elle continue d'utiliser la
configuration Tauri signee.

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

### VPS prive via SSH

Le premier flux VPS automatise l'installation sur Ubuntu/Debian par SSH et SCP,
laisse le runtime des chats lie a `127.0.0.1` sur le serveur, puis ouvre le
client desktop au travers d'un tunnel SSH :

```powershell
npm run deploy:vps -- -SshTarget ubuntu@IP_DU_VPS -IdentityFile "$HOME\.ssh\id_ed25519" -NodeId vps-paris
npm run connect:vps -- -Profile vps-paris
```

Le premier deploiement peut aussi enchainer directement la connexion avec
`-Connect`. La cible SSH accepte `root`, ou un utilisateur avec `sudo` sans mot
de passe. Les projets distants sont isoles dans `/srv/cst/workspaces`.

Aucun port applicatif n'est publie sur Internet dans ce mode. Le guide
[VPS via SSH](docs/vps-ssh.md) detaille les prerequis, la copie optionnelle des
comptes, les mises a jour et le diagnostic.

### Installation manuelle

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
