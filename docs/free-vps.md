# Choisir et preparer un VPS gratuit pour les chats

Comparaison verifiee le **15 juillet 2026** sur les pages officielles des
fournisseurs. Les offres gratuites peuvent changer : verifier encore le
recapitulatif de prix affiche par le fournisseur avant de creer une ressource.

## Choix recommande

Pour plusieurs chats ou agents autonomes, le meilleur point de depart est une
seule VM **Oracle Cloud Infrastructure Ampere A1 Always Free** :

- 2 OCPU Arm et 12 Go de RAM au total pour un compte Always Free ;
- jusqu'a 200 Go de Block Volume Always Free pour les disques de demarrage ;
- offre sans date d'expiration, tant que la ressource reste eligible et que le
  compte respecte les conditions du Free Tier ;
- Ubuntu est une image eligible et le serveur `cst-server` prend en charge
  `aarch64`.

Sources : [ressources OCI Always Free](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
et [fonctionnement du Free Tier OCI](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier.htm).

Oracle peut recuperer une VM Always Free consideree inactive sur une periode de
sept jours. La page officielle definit l'inactivite par une faible utilisation
simultanee du CPU, du reseau et, pour A1, de la memoire. Il faut donc conserver
une sauvegarde de `/srv/cst`; ne pas fabriquer de charge artificielle pour
contourner cette politique.

## Pourquoi les autres offres sont moins adaptees

| Fournisseur | Offre gratuite actuelle | Verdict pour ce projet |
| --- | --- | --- |
| Oracle Cloud | A1 Always Free, 2 OCPU et 12 Go de RAM au total | **Recommande** pour commencer avec 2 chats concurrents |
| Google Cloud | Une `e2-micro`, 1 Go de RAM, 30 Go de disque standard et 1 Go de trafic sortant par mois | Trop juste pour compiler Rust et faire tourner plusieurs CLI |
| Microsoft Azure | 750 h/mois de B1s, B2pts v2 et B2ats v2 pendant 12 mois ; ces trois petites tailles ont 1 Go de RAM | Valable pour un essai temporaire, pas pour plusieurs chats |
| AWS | Jusqu'a 200 USD de credits et un plan gratuit limite a 6 mois pour les nouveaux comptes depuis juillet 2025 | Bon essai temporaire, pas un hebergement gratuit durable |

Sources officielles : [Google Cloud Free Tier](https://docs.cloud.google.com/free/docs/free-cloud-features),
[caracteristiques `e2-micro`](https://docs.cloud.google.com/compute/docs/general-purpose-machines),
[services gratuits Azure](https://azure.microsoft.com/en-us/pricing/free-services/),
[taille Azure B1s](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/bv1-series),
[tailles Azure B2pts v2](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/bpsv2-series),
[tailles Azure B2ats v2](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/basv2-series)
et [nouveau Free Tier AWS](https://aws.amazon.com/about-aws/whats-new/2025/07/aws-free-tier-credits-month-free-plan/).

## Configuration de la VM Oracle

Lors de l'inscription, choisir soigneusement la **home region** : Oracle ne
permet pas de la changer ensuite et les VM Always Free doivent etre creees dans
cette region. Une region proche reduit la latence, mais la capacite A1 gratuite
peut etre temporairement indisponible. En cas de message `out of host capacity`,
essayer un autre availability domain s'il existe ou recommencer plus tard.

Creer ensuite une instance avec ces valeurs :

| Reglage | Valeur |
| --- | --- |
| Image | Canonical Ubuntu 24.04, Always Free eligible |
| Shape | `VM.Standard.A1.Flex` |
| Ressources | 2 OCPU, 12 Go de RAM |
| Boot volume | 50 Go, pour garder de la marge dans le quota de 200 Go |
| Cle SSH publique | `$env:USERPROFILE\.ssh\id_ed25519.pub` |
| IP | IPv4 publique ephemere |
| Entree reseau | TCP 22 uniquement, idealement depuis l'IP publique du PC en `/32` |
| Port 8080 | Ne pas l'ouvrir ; l'application l'atteint dans un tunnel SSH |

Avant de valider la creation, le recapitulatif OCI doit identifier la shape et
le volume comme **Always Free eligible** et afficher un cout estime nul. La
creation d'un compte demande generalement un telephone et une carte bancaire,
mais Oracle indique que la carte n'est pas facturee sans passage explicite vers
un compte payant.

Une fois le profil OCI `CST` authentifie, le provisionneur automatise ce parcours.
Sans option, il reste en lecture seule et controle la region d'origine, les VM
A1 existantes, tous les volumes accessibles et les limites du compte :

```powershell
npm run provision:oracle
```

Apres un preflight valide, creer la pile puis deployer CST :

```powershell
npm run provision:oracle -- -Apply -Deploy -SkipAccountSeed -Connect
```

La pile cree un compartiment `cst`, un VCN dedie, une VM Ubuntu A1 de 2 OCPU et
12 Go avec un volume de 50 Go, puis autorise uniquement TCP 22 depuis l'IPv4
publique actuelle du PC. Relancer la commande met a jour cette regle `/32` si
l'adresse du PC change. Le script s'arrete avant toute creation si le total
projete depasse 2 OCPU, 12 Go de RAM ou 200 Go de volumes.

Verifier d'abord la cle SSH (elle etait deja presente sur le poste utilise pour
preparer ce setup), puis afficher uniquement sa partie publique a coller dans
OCI :

```powershell
Test-Path "$env:USERPROFILE\.ssh\id_ed25519"
Get-Content "$env:USERPROFILE\.ssh\id_ed25519.pub"
```

Ne jamais copier le fichier `id_ed25519` sans extension dans une console web ou
un ticket : c'est la cle privee.

## Precontrole puis deploiement

Remplacer `IP_DU_VPS` par l'adresse de l'instance. Au premier contact, verifier
dans OCI que l'IP correspond bien a l'instance, puis accepter uniquement cette
nouvelle cle d'hote :

```powershell
npm run check:vps -- `
  -SshTarget ubuntu@IP_DU_VPS `
  -IdentityFile "$env:USERPROFILE\.ssh\id_ed25519" `
  -AcceptNewHostKey
```

Le precontrole est en lecture seule. Il confirme Ubuntu/Debian, `systemd`,
`sudo` non interactif, l'architecture, la RAM et au moins 8 Go de disque libre.

Le premier deploiement recommande ne copie pas les sessions locales. Il
installe le serveur, le CLI Codex et le service 24/7, puis ouvre le client au
travers du tunnel SSH :

```powershell
npm run deploy:vps:portable -- `
  -SshTarget ubuntu@IP_DU_VPS `
  -IdentityFile "$env:USERPROFILE\.ssh\id_ed25519" `
  -NodeId oracle-free `
  -NodeLabel "Oracle Free" `
  -Capacity 2 `
  -SkipAccountSeed `
  -Connect
```

Dans le client distant, ajouter ensuite le compte voulu et lancer `codex login`
dans son terminal. Pour initialiser a la place le VPS avec les comptes locaux,
omettre `-SkipAccountSeed`; leur etat est alors transporte par SCP chiffre et
uniquement lors de la premiere installation.

Verifier le noeud sans ouvrir l'application :

```powershell
npm run connect:vps -- -Profile oracle-free -CheckOnly
```

Le runtime reste lie a `127.0.0.1:8080` sur le VPS. Seul SSH est public, le
token administrateur est genere sans etre affiche et son exemplaire local est
protege par Windows. Les projets distants sont stockes dans
`/srv/cst/workspaces`.

Pour une mise a jour, relancer exactement la commande `deploy:vps:portable` avec le meme
`NodeId`. Le guide [deploiement VPS via SSH](vps-ssh.md) couvre le tunnel, les
profils, les sauvegardes de comptes, le diagnostic et le rollback.

## Monter en charge

Pour repartir de nouveaux chats entre plusieurs noeuds deja autorises et
deployes, utilise :

```powershell
npm run connect:vps:pool -- -Profiles oracle-a,oracle-b -PrimaryProfile oracle-a
```

Oracle precise qu'une personne n'a droit qu'a un seul compte Free
Trial/Always Free et interdit les comptes gratuits multiples. Ne cree donc pas
plusieurs comptes Oracle gratuits pour une meme personne : le pool multi-VPS
sert aux VM/comptes legitimement autorises ou a plusieurs fournisseurs. Voir la
[FAQ Oracle Cloud Free Tier](https://www.oracle.com/fr/cloud/free/faq/).

Commencer avec `-Capacity 2`. Cette valeur exprime la capacite annoncee du
noeud ; elle ne remplace pas la surveillance reelle. Deux chats actifs peuvent
compiler, tester ou ouvrir des terminaux en meme temps sans reserver toute la
machine. Augmenter progressivement a 3 ou 4 uniquement apres observation de la
RAM (`free -h`) et de la charge (`uptime`).

Une `e2-micro`, une B1s ou une B2* gratuite a 1 Go peut eventuellement servir de
sonde ou de bastion, mais pas de noeud de chats generaliste. Ajouter du swap
peut permettre une compilation lente ; cela ne transforme pas 1 Go de RAM en
capacite fiable pour plusieurs processus Codex.
