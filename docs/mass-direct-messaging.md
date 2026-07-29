# Campagnes de messages directs

Codex Switch Terminal permet de préparer et d'exécuter des campagnes de messages
sur sa messagerie interne. L'implémentation est indépendante de TikTok et ne
pilote ni navigateur ni appareil Android.

## Depuis l'interface

1. Ouvrir **Messagerie**, puis **Campagnes**.
2. Nommer la campagne et sélectionner les destinataires connus.
3. Saisir une ou plusieurs variantes, séparées par une ligne contenant `---`.
4. Utiliser si besoin `{{username}}`, `{{index}}` et `{{total}}`.
5. Choisir l'intervalle entre deux envois.
6. Enregistrer un brouillon, ou confirmer le consentement de l'audience avant de
   lancer la campagne.

Une campagne peut ensuite être démarrée, mise en pause, reprise ou annulée. Son
avancement et le statut de chaque livraison sont persistés. Après un redémarrage,
le worker reprend la file sans renvoyer une livraison déjà enregistrée.

## Limites

- 100 destinataires maximum par campagne.
- 20 variantes maximum.
- 4 000 caractères maximum par message rendu.
- Intervalle compris entre 5 secondes et 1 heure.
- Les destinataires en doublon sont supprimés.

## Agents autonomes

Les agents ayant accès aux données personnelles disposent des outils MCP
suivants :

- `list_private_message_users`
- `list_private_message_campaigns`
- `create_private_message_campaign`
- `control_private_message_campaign`

Un agent doit d'abord récupérer les utilisateurs réels, ne jamais inventer
d'identifiant, et créer un brouillon par défaut. Il ne peut demander un démarrage
immédiat que si le consentement de l'audience est explicitement établi.

`create_private_message_campaign` exige une `idempotencyKey` stable. Une nouvelle
tentative avec la même clé et le même expéditeur renvoie la campagne existante au
lieu d'en créer une seconde.

Exemple de séquence :

1. Appeler `list_private_message_users`.
2. Composer la liste des `recipientIds` à partir du résultat.
3. Appeler `create_private_message_campaign` avec un nom, les variantes, la
   cadence et une clé d'idempotence stable.
4. Contrôler l'état via `list_private_message_campaigns`.
5. Utiliser `control_private_message_campaign` pour mettre en pause, reprendre ou
   annuler.

## Connecteur TikMatrix séparé

Le dépôt TikMatrix est installé séparément dans
`%USERPROFILE%\tikmatrix-desktop`. Aucun code TikMatrix n'est copié dans
l'application. Un connecteur local distinct peut cependant soumettre à son agent
loopback des campagnes TikTok de test préparées sur le VPS. Ce parcours est
décrit dans [Messages TikTok de test depuis un chat VPS](tiktok-vps-messaging.md).
