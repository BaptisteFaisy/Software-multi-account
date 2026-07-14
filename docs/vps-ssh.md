# Deployer le runtime des chats sur un VPS via SSH

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
installe.

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

Ce jalon gere un noeud Linux et un tunnel lance depuis le client Windows. Il ne
gere pas encore l'approvisionnement du VPS chez un fournisseur, la rotation
guidee des cles/secrets, un reverse-proxy HTTPS public ni l'equilibrage entre
plusieurs VPS.

La validation reproductible locale compile `cst-server` sous Ubuntu puis teste
l'authentification, Build/Plan/Ask, la reprise d'une session, un cycle autonome
et une orchestration complete avec worktrees Git. Elle reduit fortement le
risque de regression. Le CLI fournisseur y est simule pour rendre le test
deterministe : le dernier jalon reste un essai avec un vrai compte sur le VPS.
Cette validation ne constitue pas une promesse d'absence totale de bug sur
toute image VPS ou panne reseau possible.
