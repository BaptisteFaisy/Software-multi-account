# Deployer le runtime des chats sur un VPS via SSH

> Pour les nouvelles installations, utiliser de preference le guide
> [Ansible + Docker Compose](portable-vps.md). Cette page documente aussi le
> chemin natif historique, utile pour les migrations et le diagnostic.

Ce premier mode VPS garde `cst-server` prive sur `127.0.0.1` de la machine
distante. Le client desktop ouvre un tunnel SSH, puis transporte dans ce tunnel
les appels HTTP et WebSocket des chats, terminaux et agents autonomes. Seul le
port SSH du VPS doit etre accessible depuis Internet.

## Prerequis

- un VPS Ubuntu ou Debian avec `systemd`, `apt-get` et assez de ressources pour
  compiler le serveur Rust ;
- une cle SSH chargee dans `ssh-agent` (ou indiquee avec `-IdentityFile`) ; la
  cible peut etre `root@hote`, ou un utilisateur autorise a executer `sudo`
  sans mot de passe ;
- OpenSSH (`ssh` et `scp`), `tar`, Git, Node.js et npm sur le PC Windows ;
- facultatif : des comptes deja prepares par le serveur local dans
  `%APPDATA%\codex-switch-terminal-server`.

Le premier deploiement installe les dependances systeme, Rust, le CLI Codex, le
service `codex-switch-terminal.service`, compile le serveur sur le VPS et
demarre le runtime. Les redeploiements utilisent le mecanisme de drain et de
bascule atomique existant afin de ne pas couper un chat actif.

La cible `cst-server` est compilee en mode headless : elle n'installe ni GTK,
ni WebKit, ni le runtime graphique Tauri sur le VPS. Une premiere compilation
prend typiquement quelques minutes ; les suivantes reutilisent le cache Rust.
Prevoir au moins 5 Go de disque libre pour les paquets, les sources et ce cache.

## Depuis l'onglet VPS du site :8080

Dans l'interface web locale, ouvre **VPS** dans la barre laterale (ou dans
**Menu > VPS** sur mobile). Si tu es connecte avec un compte utilisateur, la
vue demande une fois le jeton administrateur avant d'autoriser les operations
d'infrastructure.

Renseigne la cible `utilisateur@hote`, le chemin local de la cle SSH, les ports,
le nom du noeud et sa capacite, puis clique sur **Deployer via SSH**. Le chemin
de cle est resolu par le serveur Windows : le contenu de la cle privee ne
transite jamais dans le navigateur. La vue suit le build, le transfert SCP,
l'installation systemd et la sonde de sante dans un journal limite et masque
les lignes susceptibles de contenir un secret. Un seul deploiement peut etre
actif a la fois.

Apres le succes, l'onglet affiche la commande `connect:vps` correspondant au
profil cree. Le tunnel reste volontairement une action locale : le navigateur
ne rend jamais le port 8080 du VPS public.

## Premier deploiement

Depuis la racine du depot :

```powershell
npm run deploy:vps -- `
  -SshTarget ubuntu@203.0.113.10 `
  -IdentityFile "$HOME\.ssh\id_ed25519" `
  -NodeId vps-paris `
  -NodeLabel "VPS Paris" `
  -Capacity 2
```

Ajoute `-Connect` pour ouvrir le client automatiquement des que l'installation
est saine :

```powershell
npm run deploy:vps -- -SshTarget ubuntu@203.0.113.10 -NodeId vps-paris -Connect
```

Si cette machine n'existe pas encore dans `known_hosts`, verifie d'abord son
empreinte SSH aupres de l'hebergeur, puis ajoute `-AcceptNewHostKey` au premier
deploiement. Cette option accepte uniquement une nouvelle cle ; une cle deja
connue mais differente reste refusee.

Pour une automatisation stricte ou un fichier separe du `known_hosts` personnel,
fournis directement le fichier dont tu as verifie l'empreinte :

```powershell
npm run deploy:vps -- `
  -SshTarget ubuntu@203.0.113.10 `
  -KnownHostsFile "$PWD\vps-known-hosts" `
  -NodeId vps-paris
```

Le chemin est memorise dans le profil et reutilise par `connect:vps`.

Pour un port SSH non standard, ajoute `-SshPort 2222`. `RemotePort` vaut 8080
par defaut mais reste lie au loopback du VPS : le script n'ajoute aucune regle
de pare-feu et ne publie pas ce port.

Par defaut, `settings.json` et les `codex-homes` locaux sont chiffres pendant
le transport SSH et servent uniquement a initialiser un VPS neuf. Cette copie
inclut les sessions des fournisseurs configurees : ne la fais que vers une
machine que tu controles. Pour partir sans compte :

```powershell
npm run deploy:vps -- -SshTarget ubuntu@203.0.113.10 -NodeId vps-paris -SkipAccountSeed
```

Un token administrateur long est repris depuis le noeud local ou genere. Il
n'est pas affiche. Le profil de connexion est stocke dans
`%APPDATA%\codex-switch-terminal\vps\vps-paris.json` et son token est protege
avec le chiffrement Windows lie a l'utilisateur courant.

## Ouvrir les chats distants

```powershell
npm run connect:vps -- -Profile vps-paris
```

Pour verifier uniquement la connexion SSH, le tunnel et le token sans lancer
le client desktop :

```powershell
npm run connect:vps -- -Profile vps-paris -CheckOnly
```

Le script :

1. ouvre `127.0.0.1:8080` sur le PC vers `127.0.0.1:8080` sur le VPS avec
   `ssh -L` ;
2. attend la sonde de sante distante et verifie l'API authentifiee ;
3. lance le client desktop avec l'URL et le token du profil ;
4. ferme le tunnel lorsque le client se termine.

Si le port 8080 du PC est deja pris, choisis-en un autre sans modifier le VPS :

```powershell
npm run connect:vps -- -Profile vps-paris -LocalPort 18080
```

Le binaire `Codex Switch Terminal Cloud.exe` de la racine est choisi en
priorite. Un autre build peut etre indique avec `-ClientExe`.

## Utiliser le micro avec un chat du VPS

Le client desktop capture toujours le micro du PC. Lorsqu'il est relie au VPS,
il utilise d'abord Whisper et Ollama installes sur le PC avec
`npm run voice:setup`; si ce moteur local est indisponible, il essaie ensuite
le moteur vocal configure sur `cst-server`.

Le tunnel expose le site sur `http://127.0.0.1`, qui est une origine securisee
pour l'API microphone. Pour ouvrir le site depuis un telephone ou un autre PC,
utilise une URL HTTPS valide : les navigateurs refusent le micro sur une URL
publique `http://IP:8080`. Dans ce mode web/mobile, configure Whisper et Ollama
sur le serveur, ou les endpoints GPU distants `CST_VOICE_*` decrits dans le
[guide vocal distant](remote-voice-gpu.md).

## Allouer les chats entre plusieurs VPS

Pour plusieurs noeuds neufs, copie d'abord le manifeste sans secret puis
remplace les IP, labels et chemins de cles :

```powershell
Copy-Item config/oracle-vps-pool.example.json config/oracle-vps-pool.json
npm run deploy:vps:pool -- -Config config/oracle-vps-pool.json -PreflightOnly
npm run deploy:vps:pool -- -Config config/oracle-vps-pool.json
```

Le precontrole passe sur tous les noeuds avant le premier deploiement. Le
manifeste ne contient aucun token administrateur : chaque token reste genere et
protege dans le profil Windows par `deploy:vps`. Avant le premier contact,
verifie les empreintes des serveurs puis ajoute-les au `known_hosts` indique.
`acceptNewHostKey` doit rester `false` sauf acceptation explicite d'une nouvelle
empreinte que tu viens de verifier.

Chaque deploiement cree un profil distinct dans
`%APPDATA%\codex-switch-terminal\vps`. Pour ouvrir tous les profils disponibles
et lancer le client avec le repartiteur :

```powershell
npm run connect:vps:pool
```

Pour limiter le pool et choisir le serveur principal :

```powershell
npm run connect:vps:pool -- `
  -Profiles oracle-paris,oracle-marseille `
  -PrimaryProfile oracle-paris
```

Verifier tous les tunnels et tokens sans lancer le client :

```powershell
npm run connect:vps:pool -- -Profiles oracle-paris,oracle-marseille -CheckOnly
```

Le lanceur ouvre un port local consecutif a partir de `18080` pour chaque VPS.
`-StartLocalPort 19080` permet de changer cette plage. Les tokens dechiffres ne
sont jamais affiches. La liste multi-noeuds est transmise au processus client
par son environnement, sans etre enregistree dans le profil WebView, puis elle
est retiree de l'environnement du lanceur.

Pour chaque nouveau chat, le client sonde les noeuds en parallele et choisit le
noeud sain, pret et non draine qui possede le compte demande et dont le ratio de
charge est le plus faible. Un noeud sous sa capacite annoncee passe avant un
noeud sature. Apres le premier tour, la session, son transcript, ses actions et
ses tours suivants restent attaches au noeud d'origine. Il n'y a pas de
basculement silencieux d'une reprise : les fichiers et l'historique ne sont pas
supposes partages entre les VPS.

Pour qu'un meme compte de chat puisse etre alloue a n'importe quel noeud,
deploie chaque VPS avec le meme seed de comptes (comportement par defaut de
`deploy:vps`) ou configure le meme identifiant de compte sur chaque serveur.
Un noeud qui n'annonce pas ce compte est automatiquement exclu pour ce chat.
Les chats visibles et les terminaux utilisent le pool ; les agents autonomes et
orchestrations restent geres par le serveur principal dans cette premiere
version.

Important : Oracle indique qu'une personne ne peut ouvrir qu'un seul compte
Free Trial/Always Free et que plusieurs comptes gratuits sont interdits. Le
pool doit donc reunir des VM et comptes dont l'usage est legitimement autorise
(plusieurs VM dans une tenancy, comptes d'organisations distinctes, ou autres
fournisseurs), sans contourner cette regle. Voir la
[FAQ Oracle Cloud Free Tier](https://www.oracle.com/fr/cloud/free/faq/).

Les depots et dossiers manipules par les chats distants vivent par defaut dans
`/srv/cst/workspaces` sur le VPS. Ils ne sont pas les dossiers du PC Windows :
importe ou clone le projet sur le noeud avant de reprendre un travail qui en
depend. Les chats sans dossier projet, les modes Build/Plan/Ask, les reprises,
les agents autonomes et les chats orchestres utilisent tous le meme runtime
Linux.

## Mettre a jour le noeud

Relance la commande `deploy:vps` avec le meme `NodeId`, la meme cible SSH et le
meme port distant. Le profil local reutilise le token existant. Par securite,
le script refuse de changer implicitement le token ou le port d'un noeud deja
installe. Chaque mise a jour construit une release immutable, attend la fin des
chats actifs, bascule atomiquement puis verifie version, commit, disponibilite
et sortie du drain. Si la nouvelle release ne demarre pas, la precedente est
restauree et verifiee automatiquement.

## Diagnostic

Verifier le service sans exposer son port :

```powershell
ssh ubuntu@203.0.113.10 "sudo systemctl status codex-switch-terminal --no-pager"
ssh ubuntu@203.0.113.10 "curl -fsS http://127.0.0.1:8080/healthz"
```

Consulter les derniers journaux :

```powershell
ssh ubuntu@203.0.113.10 "sudo journalctl -u codex-switch-terminal -n 100 --no-pager"
```

Ce jalon ne gere pas encore l'approvisionnement du VPS chez un fournisseur, la
rotation guidee des cles/secrets, un reverse-proxy HTTPS public, le stockage
partage entre noeuds ni la migration automatique d'une session active.

La validation reproductible locale compile `cst-server` sous Ubuntu puis teste
l'authentification, Build/Plan/Ask, la reprise d'une session, un cycle autonome
et une orchestration complete avec worktrees Git. Le parcours d'integration a
aussi ete execute sur une Ubuntu Base 24.04.4 vierge avec un vrai OpenSSH et
systemd : installation, tunnel authentifie, mise a jour, echec volontaire et
rollback automatique. Cela reduit fortement le risque de regression. Le CLI
fournisseur des tests de chats est simule pour rendre le resultat deterministe :
le dernier jalon reste un essai avec un vrai compte sur le VPS. Cette validation
ne constitue pas une promesse d'absence totale de bug sur toute image VPS ou
panne reseau possible.

Pour verifier aussi le trajet Windows -> OpenSSH -> Linux avec le connecteur
reel, WSL Ubuntu et un binaire Linux deja compile :

```powershell
npm run test:vps:ssh -- `
  -ServerBinary /home/votre-utilisateur/.cache/cst-vps-target/debug/cst-server
```

Le test cree des cles, un profil DPAPI, trois ports et un `sshd` temporaires,
verifie l'empreinte hote et l'API authentifiee dans `ssh -L`, puis supprime les
processus et donnees WSL. Il extrait le paquet OpenSSH dans `/tmp` sans
l'installer comme service et ne modifie pas le vrai `known_hosts` Windows.
