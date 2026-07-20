# Deploiement portable avec Ansible et Docker Compose

Ce chemin installe le meme runtime de chats sur un VPS Ubuntu ou Debian, quel
que soit le fournisseur. Ansible configure l'hote par SSH ; Docker Compose
execute l'application et conserve les comptes, historiques et workspaces dans
`/srv/cst`.

Le port applicatif reste lie a `127.0.0.1` sur le VPS. Seul SSH doit etre
autorise depuis Internet, puis le client ouvre un tunnel local chiffre.

## Premier deploiement sans registre

Depuis Windows, WSL Ubuntu est utilise comme controleur Ansible. Le wrapper
cree automatiquement un environnement Python isole pour Ansible, transfere le
contexte Docker courant, initialise les comptes, les conversations et les
agents autonomes, puis copie le projet dans
`/srv/cst/workspaces/codex-switch-terminal` lors du premier passage :

La migration conserve les sessions, authentifications, memoires, skills et
bases d'etat Codex. Elle ignore uniquement les journaux diagnostics, caches et
sandboxes Windows regenerables, qui peuvent peser plusieurs gigaoctets et ne
sont pas reutilisables par le conteneur Linux. La copie distante remplace aussi
le shell Windows par `/bin/bash` et remappe le workspace courant vers
`/srv/cst/workspaces/codex-switch-terminal`, sans modifier les reglages locaux.

```powershell
npm run deploy:vps:portable -- `
  -SshTarget ubuntu@203.0.113.10 `
  -IdentityFile "$HOME\.ssh\id_ed25519" `
  -NodeId oracle-free `
  -NodeLabel "Oracle Free" `
  -Capacity 2 `
  -AcceptNewHostKey
```

Sans `-Image`, la premiere image est construite sur le VPS. Les passages
suivants sont idempotents : Ansible garde les donnees et reutilise l'image si
le contenu source n'a pas change.

Options utiles :

- `-SkipAccountSeed` demarre sans copier les connexions locales ;
- `-NoWorkspaceSeed` ne copie pas le projet courant ;
- `-WorkspaceName mon-projet` choisit le dossier distant initial ;
- `-Connect` ouvre le tunnel et le client apres un deploiement reussi.

## Deploiement en moins de cinq minutes

Le workflow [container.yml](../.github/workflows/container.yml) construit et
publie dans GHCR une image unique pour `linux/amd64` et `linux/arm64`. Apres sa
premiere execution, un nouveau VPS n'a plus besoin de compiler Rust ou le
frontend :

```powershell
npm run deploy:vps:portable -- `
  -SshTarget ubuntu@203.0.113.10 `
  -IdentityFile "$HOME\.ssh\id_ed25519" `
  -NodeId vps-paris `
  -NodeLabel "VPS Paris" `
  -Image ghcr.io/baptistefaisy/software-multi-account:latest
```

Si le paquet GHCR est prive, place un token `read:packages` dans un fichier
local exclu de Git, puis ajoute `-RegistryUsername NOM` et
`-RegistryTokenFile CHEMIN`. Le token est transmis dans un fichier temporaire,
masque par Ansible et jamais stocke dans le depot.

Le delai de moins de cinq minutes suppose que la VM est deja joignable, que
l'image est publiee et que sa bande passante permet de la telecharger. La
creation de la VM par le fournisseur reste un delai separe.

## Oracle Always Free

Le profil OCI `CST` peut creer la VM, attendre `cloud-init`, puis appeler ce
deploiement portable :

```powershell
npm run provision:oracle -- -Apply -Deploy
```

Si Oracle repond `out of host capacity`, la configuration n'est pas en cause :
la capacite A1 de la home region est temporairement epuisee. Le retry borne
controle d'abord le profil 2 OCPU / 12 Go, puis le profil de repli 1 OCPU /
6 Go. Il ne lance aucune VM tant que les deux sont indisponibles, puis termine
le provisionnement des qu'une capacite exploitable apparait :

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File scripts/retry-oracle-provision.ps1 `
  -IncludeAccountSeed
```

## Google Cloud avec l'essai gratuit

L'onglet **VPS** de l'interface web integre le parcours Google Cloud :

1. **Connecter Google** installe le CLI officiel dans WSL si necessaire, puis
   ouvre OAuth dans le navigateur Windows ;
2. **Activer l'essai** ouvre la page officielle Google. L'adresse, le moyen de
   paiement, le mot de passe et le MFA sont saisis uniquement chez Google ;
3. apres le retour dans CST, **Creer et deployer** cree un projet dedie, une VM
   Ubuntu 24.04 `e2-standard-2` (2 vCPU, 8 Go), puis lance Ansible et Compose.

Le provisionneur reste dans `europe-west1`, essaie trois zones et ne publie que
SSH depuis l'IPv4 publique courante en `/32`. La VM n'a ni compte de service ni
scope API. CST ne propose dans l'interface que les projets portant le label
`cst-managed=true`, afin d'eviter de modifier un projet Google existant.

Par defaut, Google supprimera automatiquement la VM et son disque de demarrage
apres 75 jours. Cette echeance absolue ne se prolonge pas lors d'un redemarrage
et laisse une marge avant la fin des 90 jours de l'essai. Exporte `/srv/cst`
avant cette date si tu veux conserver les donnees au-dela de l'essai.

La VM `e2-standard-2` n'appartient pas au niveau Compute Engine gratuit
permanent : son cout est couvert uniquement tant que le credit d'essai est
valide. Les conditions courantes de l'essai (credit, duree et passage volontaire
au compte payant) restent celles de la
[documentation officielle Google](https://docs.cloud.google.com/free/docs/free-cloud-features).

Le meme parcours reste disponible en ligne de commande apres la connexion :

```powershell
npm run provision:google -- -Apply -Deploy
```

Pour ouvrir l'interface web via un tunnel SSH detachable :

```powershell
npm run connect:vps:web -- -Profile google-trial
```

Le token du profil chiffre est copie dans le presse-papiers et n'est jamais
ecrit dans l'etat du tunnel. Pour fermer le tunnel :

```powershell
npm run connect:vps:web:stop -- -Profile google-trial
```

## Mettre un VPS a jour depuis GitHub

Chaque profil VPS peut etre reconstruit a la demande depuis la branche ou le
tag GitHub choisi. Le script resout d'abord le commit exact, clone cette
revision dans un dossier temporaire, puis relance le deploiement Ansible et
valide `/healthz` apres le remplacement :

```powershell
npm run update:vps:github -- -Profile google-trial
```

Pour verifier si une mise a jour est disponible sans rien modifier :

```powershell
npm run update:vps:github -- -Profile google-trial -CheckOnly
```

La branche par defaut est `main` du depot configure comme remote Git local.
`-Repository proprietaire/depot` et `-Ref branche-ou-tag` permettent de choisir
une autre source. Le commit effectivement deploye est ensuite enregistre dans
le profil VPS.

Le script ne reinitialise ni les comptes, ni les conversations, ni les agents,
ni le workspace persistant sous `/srv/cst`. Il refuse aussi de remplacer une
image construite avec des changements locaux non publies. Apres avoir publie
et verifie ces changements sur GitHub, autorise cette transition une seule
fois avec :

```powershell
npm run update:vps:github -- `
  -Profile google-trial `
  -ReplaceDirtyDeployment
```

Les mises a jour suivantes n'ont plus besoin de cette option.

Pour ne plus avoir aucune action a effectuer apres la carte, active le
surveillant local. Il controle la facturation toutes les deux minutes, ignore
les executions concurrentes, lance le provisionnement des que Google confirme
le compte et se desactive apres le premier deploiement reussi :

```powershell
npm run provision:google:auto
```

Son etat et son journal se trouvent dans
`%APPDATA%\codex-switch-terminal\google-cloud`. Il ne stocke aucune donnee
bancaire ni aucun jeton Google.

Le premier passage genere aussi la paire `~/.ssh/id_ed25519` si elle n'existe
pas. Une VM deja creee par CST est reutilisee ou redemarree sans supprimer ses
donnees.

## Choisir Oracle pour un nouveau chat

Une fois le profil connecte :

```powershell
npm run connect:vps -- -Profile oracle-free
```

Dans **Nouveau chat**, le champ **Machine d'execution** propose :

- **Automatique** pour prendre le noeud sain le moins charge ;
- **Oracle Free** (ou le nom du profil) pour imposer ce VPS.

La cible explicite concerne uniquement la creation de la session. Toutes les
reprises restent ensuite collees au noeud qui possede son historique ; elles ne
basculent jamais silencieusement vers un autre fournisseur.

## Donnees et sauvegarde

- `/srv/cst/settings.json` et `/srv/cst/codex-homes` : comptes et connexions ;
- `/srv/cst/autonomous-agents.json` : objectifs, planning, memoire et rapports
  des agents autonomes ;
- `/srv/cst/workspaces` : projets manipules par les chats ;
- `/etc/codex-switch-terminal/cst.env` : secrets du service, mode `0600` ;
- `/opt/codex-switch-terminal/compose.yaml` : definition active de la pile.

Sauvegarde `/srv/cst` independamment de l'image Docker. Une image ou un nouveau
deploiement remplace le logiciel, jamais les donnees persistantes.
