# Messages WhatsApp des agents autonomes

Codex Switch Terminal utilise l’API officielle **WhatsApp Business Cloud** de Meta. Un compte WhatsApp personnel et l’automatisation de WhatsApp Web ne sont pas pris en charge.

## Prérequis Meta

1. Créer ou sélectionner une application dans [Meta for Developers](https://developers.facebook.com/apps/).
2. Ajouter le produit WhatsApp et rattacher un compte WhatsApp Business.
3. Récupérer l’**ID du numéro de téléphone**, le **secret de l’application** et un jeton autorisé à envoyer des messages (`whatsapp_business_messaging`).
4. Choisir le numéro personnel autorisé au format international, par exemple `+33612345678`. Pour un numéro français, remplacer le `0` initial par `+33`.
5. Pour recevoir des notifications en dehors de la fenêtre de conversation de 24 heures, créer un modèle approuvé contenant exactement une variable dans le corps : `{{1}}`.

La collection officielle [WhatsApp Cloud API de Meta](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api) décrit l’endpoint `/{PHONE_NUMBER_ID}/messages`, les jetons et les modèles.

## Liaison dans l’application

Dans **Paramètres → Notifications WhatsApp** :

1. saisir le jeton Meta, le secret de l’application, l’ID du numéro Business et le numéro personnel autorisé ;
2. ajouter facultativement le nom et la langue du modèle approuvé ;
3. cliquer sur **Lier WhatsApp Business** ;
4. utiliser **Envoyer un test** pour confirmer que Meta accepte le message.

Le jeton est conservé uniquement côté serveur dans `whatsapp-connections.json`. Il n’est jamais inclus dans les réglages publics, les agents ou les réponses API. Sous Unix, le fichier reçoit les permissions `0600`.

## Activer la conversation entrante

La réception exige que le serveur soit joignable depuis Meta avec une URL HTTPS publique. Configurer `CST_PUBLIC_BASE_URL` avec l’origine publique du serveur, par exemple `https://switch.example.com`, puis redémarrer le serveur.

Après la liaison, l’application affiche deux valeurs à reporter dans **Meta for Developers → WhatsApp → Configuration** :

1. l’URL de rappel, terminée par `/api/notifications/whatsapp/webhook` ;
2. le jeton de vérification généré par Switch ;
3. une fois le webhook validé, abonner l’application au champ `messages` ;
4. vérifier que le WhatsApp Business Account est bien abonné à l’application.

Chaque requête entrante est contrôlée avec `X-Hub-Signature-256` et le secret de l’application. Seul le numéro personnel enregistré peut transmettre une consigne ; les autres expéditeurs sont ignorés. Les identifiants de messages récents empêchent un doublon Meta d’exécuter deux fois la même consigne.

## Activation pour un agent

Dans le formulaire de création d’un agent, ouvrir **Plus d’options → Services et sécurité**, puis activer **Envoyer les comptes rendus sur WhatsApp**.

Le canal est enregistré par identifiant stable. Reconfigurer ou renouveler le jeton ne nécessite donc pas de recréer les agents. Une notification est mise en file lorsqu’un nouveau compte rendu est publié ou quand l’agent est suspendu après plusieurs échecs.

Pour parler à un agent depuis WhatsApp :

- répondre directement à l’une de ses notifications ;
- si un seul agent utilise le canal, envoyer simplement le message ;
- si plusieurs agents utilisent le canal, écrire `@NomAgent ton message` ou envoyer `agents` pour obtenir la liste des identifiants disponibles.

Le message est ajouté à la mémoire durable de l’agent et planifie immédiatement un nouveau cycle lorsque son état l’autorise. Une confirmation est envoyée sur WhatsApp, puis le compte rendu de l’agent arrive sur le même canal.

Sans modèle approuvé, l’application envoie du texte libre. Meta peut le refuser si le destinataire n’a pas écrit au numéro Business dans les 24 dernières heures.
