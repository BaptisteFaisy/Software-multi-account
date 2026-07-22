# GPU vocal distant

Switch peut conserver la capture du microphone sur le poste utilisateur tout en
executant la transcription et la reformulation sur une machine GPU distante.
Le mode local reste le mode par defaut et aucun audio ne quitte la machine tant
que `transcriptionMode` n'est pas passe a `remote`.

## Architecture

```text
Microphone -> Switch/cst-server -> HTTPS + Bearer -> proxy du datacenter
                                             |-> API STT compatible OpenAI
                                             |     (Speaches/faster-whisper)
                                             `-> API Ollama /api/chat
```

Le contrat reseau n'est lie a aucun fournisseur cloud :

- STT : `POST /v1/audio/transcriptions` en `multipart/form-data`, avec les
  champs `file`, `model`, `language` et `response_format=json`. La reponse doit
  contenir `{ "text": "..." }` ;
- reformulation : `POST /api/chat`, au format natif Ollama ;
- authentification : `Authorization: Bearer <jeton>` sur les deux appels ;
- transport : HTTPS obligatoire pour une adresse non locale. HTTP ne peut etre
  active qu'explicitement avec `CST_VOICE_ALLOW_INSECURE_REMOTE=1`.

L'onglet **Transcrire** reutilise le meme endpoint STT, mais envoie directement
le fichier d'origine (WAV, MP3, M4A, FLAC, OGG, OPUS ou WebM) et restitue le
transcript sans reformulation Ollama. La limite applicative est de 100 Mo.

## Serveur GPU de reference

Une machine Linux avec pilote NVIDIA, Docker et NVIDIA Container Toolkit suffit.
Utilise les instructions courantes du
[NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html),
puis verifie d'abord :

```bash
docker run --rm --gpus all ubuntu nvidia-smi
```

### 1. Transcription avec Speaches

[Speaches](https://speaches.ai/) expose une API de transcription compatible
OpenAI, utilise faster-whisper et fournit une image CUDA. Le port est lie a
`127.0.0.1` pour ne pas publier directement le moteur :

```bash
docker run --detach \
  --restart unless-stopped \
  --gpus all \
  --publish 127.0.0.1:8000:8000 \
  --volume speaches-models:/home/ubuntu/.cache/huggingface/hub \
  --name speaches \
  ghcr.io/speaches-ai/speaches:latest-cuda

curl -X POST \
  http://127.0.0.1:8000/v1/models/Systran/faster-whisper-small
```

Le modele `small` est un bon point de depart pour conserver le profil actuel.
Une machine de datacenter disposant de plus de VRAM pourra ensuite tester
`Systran/faster-whisper-large-v3` sans changement dans Switch.

Pour une pile Codex Switch Terminal deja geree par Docker Compose, le fichier
`compose.gpu.yaml` fournit cette topologie sans publier le port 8000 :

```bash
docker compose -f compose.yaml -f compose.gpu.yaml up -d --wait
```

Le deploiement Ansible equivalent s'active avec `-GpuTranscription`; il installe
NVIDIA Container Toolkit, verifie l'acces CUDA depuis Docker et conserve le
cache des modeles dans un volume dedie.

### 2. Reformulation avec Ollama

La documentation Ollama fournit une image NVIDIA officielle. Ici aussi, le port
reste accessible uniquement depuis le serveur :

```bash
docker run --detach \
  --restart unless-stopped \
  --gpus all \
  --publish 127.0.0.1:11434:11434 \
  --volume ollama-models:/root/.ollama \
  --name ollama \
  ollama/ollama

docker exec ollama ollama pull qwen3:4b-instruct-2507-q4_K_M
```

### 3. Terminer par HTTPS et l'authentification

Place un reverse proxy ou une passerelle d'API devant les deux services. Il doit :

- terminer TLS avec un certificat valide ;
- valider un jeton Bearer avant de transmettre la requete ;
- limiter la taille des requetes audio a 15 Mio ;
- appliquer un timeout d'au moins cinq minutes pour la transcription ;
- conserver `8000` et `11434` fermes sur le pare-feu public ;
- ne pas journaliser le corps multipart, le transcript ou l'en-tete
  `Authorization`.

Ollama ne doit pas etre expose directement sur Internet. Le fait que Switch
envoie un en-tete Bearer ne protege rien si le proxy ne le valide pas.

Une topologie simple peut publier deux routes :

```text
https://gpu.example.net/stt/v1/audio/transcriptions -> 127.0.0.1:8000/v1/audio/transcriptions
https://gpu.example.net/ollama/api/chat             -> 127.0.0.1:11434/api/chat
```

## Configurer Switch

Depuis PowerShell, sur la machine qui execute Switch ou `cst-server` :

```powershell
npm run voice:remote -- `
  -TranscriptionUrl "https://gpu.example.net/stt/v1/audio/transcriptions" `
  -TranscriptionModel "Systran/faster-whisper-small" `
  -OllamaUrl "https://gpu.example.net/ollama" `
  -SummaryModel "qwen3:4b-instruct-2507-q4_K_M"

$env:CST_VOICE_TRANSCRIPTION_API_KEY = Read-Host "Jeton STT"
$env:CST_VOICE_OLLAMA_API_KEY = Read-Host "Jeton Ollama"
npm run dev
```

Les URL et noms de modeles sont ecrits dans
`%APPDATA%\codex-switch-terminal\voice\config.json`. Les jetons ne le sont pas :
ils doivent etre injectes au processus par le gestionnaire de secrets du poste,
du service Windows, du conteneur ou de l'orchestrateur.

Ajoute `-FallbackLocal` a `voice:remote` si le poste conserve l'installation
Whisper locale et doit continuer a transcrire pendant une panne reseau. Le
repli est explicite et affiche un avertissement dans l'interface.

## Variables disponibles

| Variable | Usage |
| --- | --- |
| `CST_VOICE_TRANSCRIPTION_MODE` | Surcharge `local` ou `remote` |
| `CST_VOICE_TRANSCRIPTION_URL` | URL complete de `/v1/audio/transcriptions` |
| `CST_VOICE_TRANSCRIPTION_MODEL` | Identifiant du modele STT distant |
| `CST_VOICE_TRANSCRIPTION_ACCELERATOR` | `auto`, `gpu` ou `cpu`, affiche dans le statut de l'onglet |
| `CST_VOICE_TRANSCRIPTION_API_KEY` | Jeton Bearer STT, jamais lu depuis le JSON |
| `CST_VOICE_OLLAMA_URL` | Base Ollama locale ou distante |
| `CST_VOICE_OLLAMA_MODEL` | Modele de reformulation |
| `CST_VOICE_OLLAMA_API_KEY` | Jeton Bearer Ollama, jamais lu depuis le JSON |
| `CST_VOICE_ALLOW_INSECURE_REMOTE` | Autorise explicitement HTTP non local |

Pour revenir entierement au GPU local, relance simplement :

```powershell
npm run voice:setup
```

## Capacite et confidentialite

Le WAV mono 16 kHz represente environ 32 ko/s : une dictee de trente secondes
fait environ 1 Mo et la limite de cinq minutes reste sous 10 Mo. En mode distant,
le WAV est envoye au service STT puis le transcript au service Ollama. La
politique de conservation cote datacenter doit donc etre explicite, idealement
sans stockage et sans logs de contenu.

Pour plusieurs utilisateurs, ajoute une file d'attente et limite le nombre de
transcriptions simultanees par GPU. Les URL et modeles resteront identiques :
seule la passerelle ou l'orchestrateur changera lors du passage a plusieurs GPU.
