# Messages TikTok de test depuis un chat VPS

Codex Switch Terminal peut preparer sur le VPS une campagne de messages directs,
puis la transmettre au poste Windows qui execute TikMatrix et l'emulateur
Android. L'API TikMatrix reste exclusivement sur `127.0.0.1` : aucun port de
l'agent n'est publie sur Internet ou dans le tunnel SSH.

## Prerequis locaux

- TikMatrix doit etre lance et son agent local doit etre operationnel.
- L'emulateur Android doit etre visible dans TikMatrix.
- TikTok global (`com.zhiliaoapp.musically`) doit etre installe.
- Le compte expediteur doit etre connecte.
- **Match Accounts** doit avoir reconnu au moins un compte.
- Le client **Codex Switch Terminal Cloud** connecte au VPS doit rester ouvert :
  il constitue le connecteur sortant entre la file du VPS et TikMatrix.

Aucun mot de passe, code 2FA, cookie ou jeton TikTok n'est transmis au VPS.

## Utilisation dans un chat

La demande peut contenir le message exact et jusqu'a cinq comptes secondaires
controles par l'utilisateur :

```text
Prepare ce message pour mes comptes de test :
@compte_test_1
@compte_test_2

Message exact : Ceci est un test.
```

Le chat utilise les outils suivants :

1. `prepare_tiktok_dm_campaign` valide les noms, la limite de cinq comptes, le
   message et la cadence. Il cree uniquement un brouillon idempotent.
2. Le chat affiche l'apercu exact.
3. `send_tiktok_dm_campaign` place le brouillon dans la file seulement apres
   confirmation explicite que tous les destinataires appartiennent a
   l'utilisateur et que ce message exact doit etre envoye.
4. `list_tiktok_dm_campaigns` suit la file et indique si le connecteur Windows
   est en ligne.

Un ordre deja explicite peut contenir la confirmation dans la meme demande :

```text
Ces cinq @username sont mes comptes secondaires de test. Envoie maintenant le
message exact suivant a chacun : Ceci est un test.
```

L'agent ne doit jamais deduire la propriete des comptes ni reutiliser une
ancienne confirmation avec une autre liste ou un autre message.

## Extraire les followers d'un compte autorise

Le chat peut aussi demander une collecte bornee :

```text
Le compte @mon_compte_test m'appartient. Extrais tous les followers disponibles
en une seule operation et rends-moi les @username.
```

`extract_tiktok_followers` place l'operation dans la file du connecteur
uniquement lorsque la demande confirme que le compte source appartient a
l'utilisateur ou qu'il est autorise a l'utiliser. TikMatrix execute son script
**Scrape Users** en mode `followers`. Pour « tous les followers disponibles »,
le chat demande automatiquement le maximum TikMatrix de 1 000 : l'utilisateur
n'a aucun lot de 50 a gerer. Le connecteur attend la fin de la tache, lit le
fichier `exported_users_...txt` cree dans le dossier `download`, normalise et
dedoublonne les noms, puis les remonte au VPS.
`list_tiktok_follower_extractions` permet de suivre les statuts `queued`,
`claimed`, `submitted`, `completed` ou `failed` et retourne `usernames` lorsque
la collecte est terminee.

TikMatrix indique toutefois que TikTok ne rend souvent qu'environ 50 profils
visibles par operation. Relancer la meme collecte ne constitue pas une
pagination fiable et peut retourner les memes noms. Le resultat affiche donc
toujours le nombre effectivement obtenu et n'est jamais presente comme
exhaustif lorsque TikTok en masque une partie.

### Relier la collecte a un brouillon de message

Le chat peut preparer le raccordement dans la meme demande :

```text
Le compte @ma_page_test m'appartient. Extrais ses followers disponibles.
Parmi les resultats, garde uniquement @secondaire_1 et @secondaire_2, qui sont
mes comptes de test. Prepare pour eux le message exact : Ceci est un test.
```

L'option `dmPipeline` de `extract_tiktok_followers` conserve une allowlist
separee d'au plus cinq comptes secondaires confirmes comme controles. A la fin
de la collecte, le serveur calcule l'intersection entre cette allowlist et les
noms effectivement trouves. Il cree alors un brouillon TikTok uniquement pour
cette intersection.

Les autres followers extraits ne deviennent jamais des destinataires. Le chat
doit afficher l'apercu du brouillon termine, puis attendre une nouvelle
confirmation humaine avant d'appeler `send_tiktok_dm_campaign`.

La liste collectee ne devient jamais automatiquement une liste de destinataires.
Une campagne DM reste limitee a cinq comptes de test controles et conserve son
propre apercu ainsi que sa confirmation explicite.

## Execution et anti-doublon

Une campagne confirmee passe par les statuts suivants :

`draft` -> `queued` -> `claimed` -> `submitted`

Le connecteur :

- recupere une lease bornee a deux minutes ;
- verifie l'agent TikMatrix, l'appareil et le compte reconnu ;
- refuse de demarrer lorsqu'une autre tache TikMatrix est active ;
- ecrit la liste sous le dossier de donnees TikMatrix ;
- met a jour `mass_dm_settings.json` avec le message exact ;
- appelle localement `POST /api/message_now` ;
- enregistre un recu durable avant de confirmer la soumission au VPS.

Le recu local empeche un second appel TikMatrix si la connexion au VPS coupe
juste apres la soumission. Le statut `submitted` signifie que TikMatrix a accepte
la tache ; le resultat final de chaque livraison reste visible dans les taches
TikMatrix et depend aussi des reglages de messages TikTok des destinataires.

## Bornes

- cinq destinataires maximum ;
- un seul message, sur une seule ligne, de 500 caracteres maximum ;
- intervalle aleatoire de 1 a 10 minutes entre les operations ;
- un seul appareil est choisi automatiquement ; avec plusieurs appareils,
  `deviceSerial` devient obligatoire ;
- uniquement des comptes secondaires controles et des tests consentis ;
- demande unique limitee a 1 000 followers disponibles, avec une limite de
  visibilite TikTok souvent proche de 50, et uniquement pour un compte source
  appartenant a l'utilisateur ou explicitement autorise ;
- raccordement scrape-vers-DM limite a une allowlist explicite de cinq comptes
  secondaires controles, avec brouillon et confirmation humaine separes ;
- aucune prospection non sollicitee ou tentative de contournement.
