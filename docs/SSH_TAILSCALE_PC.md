# Pont SSH Tailscale vers le PC fixe

Dans les terminaux Switch de production Azure, la connexion de retour vers le
PC fixe est exposee par ces alias SSH :

```sh
ssh pc-fixe
ssh pc-fixe-tailscale
```

Les alias historiques `pc` et `local` restent disponibles.

Verification rapide :

```sh
ssh pc-fixe hostname
```

Sur l'installation de production, la reponse attendue est
`DESKTOP-86F938L`.

## Chemin de la connexion

Le PC maintient un reverse-forward SSH sur le reseau Tailscale vers le VPS
Azure. Depuis le conteneur, `host.docker.internal` rejoint l'extremite de ce
forward sur l'hote VPS, qui renvoie ensuite la connexion vers le serveur
OpenSSH du PC.

Il est donc normal qu'aucun processus Tailscale ne tourne dans le conteneur.
L'identite privee est montee dans `/srv/cst/ssh/id_back` et ne doit jamais etre
affichee, copiee ou ajoutee au depot.

La cible est configurable sans reconstruire l'image :

- `CST_SSH_LOCAL_HOST` : extremite visible depuis le conteneur ;
- `CST_SSH_LOCAL_PORT` : port du reverse-forward ;
- `CST_SSH_LOCAL_USER` : compte Windows cible.
