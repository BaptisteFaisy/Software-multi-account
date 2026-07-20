# Dockeriser et déployer un projet depuis son lien Git

La commande `dockerize:git` transforme un dépôt Git en paquet Docker portable. Elle clone une révision propre dans un dossier temporaire, analyse le projet, réutilise son `Dockerfile` s'il existe ou en génère un, construit l'image puis l'exporte dans `image.tar.gz`.

## Depuis un nouvel environnement Switch

Dans le sélecteur d'environnements, choisis **Depuis Git / Docker**. Le formulaire crée automatiquement un dossier durable sous `SwitchProjects`, l'active comme environnement de chat, puis propose trois actions sélectionnables :

- **Analyser et préparer** : clone et détecte le projet sans nécessiter Docker ;
- **Construire et exporter l'image** : produit le paquet portable sur la machine courante ;
- **Déployer et lancer sur un VPS** : construit nativement sur le VPS, démarre le conteneur et vérifie son état.

La branche, les ports et les paramètres SSH restent facultatifs. Si l'étape Docker échoue, le dépôt cloné est conservé et devient tout de même l'environnement actif afin de pouvoir corriger sa configuration.

## Construction locale avec un seul lien

Prérequis : Node.js, Git et un moteur Docker joignable.

```powershell
npm run dockerize:git -- https://github.com/organisation/projet.git
```

Le paquet est créé sous `.cst-images/<projet>/<commit>-<architecture>/` avec :

- `image.tar.gz`, chargeable sur un autre hôte avec `gzip -dc image.tar.gz | docker load` ;
- `run.sh`, qui charge puis lance l'image avec redémarrage automatique ;
- `compose.yaml`, pour les déploiements gérés avec Docker Compose ;
- `manifest.json`, qui conserve le commit, la détection, l'architecture, les ports, les noms de variables trouvés dans les modèles `.env`, la taille et le SHA-256 de l'archive ;
- le `Dockerfile` réellement utilisé et son fichier d'exclusion de sécurité.

Sur le VPS, copie ce dossier puis lance :

```sh
sh run.sh
```

Pour analyser et générer les fichiers sans démarrer Docker :

```powershell
npm run dockerize:git -- https://github.com/organisation/projet.git --dry-run
```

Un dry run ne construit aucune image.

## Déploiement direct sur un VPS

Avec une cible SSH, le mode automatique construit nativement sur le VPS. Il détecte `amd64` ou `arm64`, transfère un contexte sans historique Git, lance le conteneur et vérifie qu'il reste actif. Cette voie fonctionne même lorsque Docker n'est pas installé sur la machine qui exécute Codex Switch Terminal.

```powershell
npm run dockerize:git -- https://github.com/organisation/projet.git `
  --deploy ubuntu@203.0.113.10 `
  --ssh-key "$HOME\.ssh\id_ed25519" `
  --install-docker
```

`--install-docker` est explicite : il installe le paquet `docker.io` uniquement sur un VPS Debian ou Ubuntu disposant de `sudo -n`. Sans cette option, un Docker déjà fonctionnel est requis. L'empreinte SSH reste vérifiée par défaut ; `--accept-new-host-key` ne doit être utilisé qu'après comparaison avec l'empreinte affichée par l'hébergeur.

Options fréquentes :

```text
--ref v2.1.0                 branche, tag ou commit
--context apps/api           sous-projet d'un monorepo
--container-port 3000        port écouté dans le conteneur
--host-port 80               port publié sur le VPS
--env-file ./production.env  secrets injectés au lancement, jamais dans l'image
--platform linux/arm64       paquet ciblé pour un VPS ARM
--build-on local             construire localement puis transférer l'image
--no-export                  déployer sans rapatrier image.tar.gz
```

## Détection prise en charge

Le générateur couvre les projets suivants à la racine ou dans `--context` :

- Node.js, Next.js, Nuxt, Vite, Create React App, Vue CLI, Astro et SvelteKit ;
- Python avec FastAPI, Flask, Django WSGI ou un processus `web:` dans `Procfile` ;
- Go, Rust, Java avec Maven ou Gradle ;
- sites statiques avec `index.html`.

Un dépôt qui mélange plusieurs applications doit fournir un `Dockerfile` ou sélectionner un sous-dossier. Pour une technologie non reconnue, les paramètres `--base-image`, `--start-command`, `--install-command` et `--build-command` décrivent un conteneur générique sans exécuter ces commandes sur l'hôte.

## Sécurité et limites

- N'insère jamais un token dans l'URL Git. Utilise l'agent SSH ou le gestionnaire d'identifiants Git.
- Les commandes du projet sont exécutées pendant le build Docker, jamais directement sur la machine hôte.
- Les fichiers `.env`, clés privées, dépendances locales et historique `.git` sont exclus du contexte de build.
- Un `Dockerfile` fourni par le dépôt reste du code non fiable : relis-le avant de construire un dépôt inconnu.
- Une archive correspond à l'architecture inscrite dans `manifest.json`. Produis une archive par architecture, ou publie ensuite une image multi-architecture dans un registre.
- Le contrôle distant prouve que le conteneur tourne après son démarrage ; une application nécessitant une base de données ou des variables obligatoires doit recevoir son `--env-file` et ses services externes.
