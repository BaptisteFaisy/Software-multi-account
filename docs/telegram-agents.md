# Telegram pour les agents autonomes

Telegram est l’option de messagerie recommandée pour les agents : un bot classique suffit, sans compte Business, abonnement, numéro destinataire ou URL HTTPS publique.

## Connexion automatisée recommandée

Telegram permet depuis la Bot API 9.6 aux **bots gestionnaires** de créer et piloter d’autres bots. La première identité de gestion doit néanmoins être créée et autorisée par son propriétaire dans Telegram : cette confirmation ne peut pas être effectuée par l’application à sa place.

1. Dans Telegram, ouvrir [BotFather](https://t.me/BotFather).
2. Créer une seule fois un bot avec `/newbot`.
3. Ouvrir les réglages de ce bot dans la Mini App BotFather et activer **Bot Management Mode**.
4. Dans **Paramètres → Messages Telegram**, coller son jeton sous **Automatisation avec un bot gestionnaire**.
5. Choisir le nom et un `@username` unique finissant par `bot`, puis sélectionner **Préparer la création**.
6. Ouvrir le lien généré et confirmer la création dans Telegram sans modifier le `@username` proposé.

Le serveur reçoit alors l’événement officiel `managed_bot`, limite le nouveau bot à son propriétaire, récupère son jeton avec `getManagedBotToken` et le connecte automatiquement. Le jeton du bot enfant n’est jamais affiché dans le navigateur.

Il reste enfin à ouvrir le lien d’appairage du bot enfant et à appuyer sur **Démarrer**. Telegram interdit aux bots d’initier une conversation privée avec un utilisateur qui ne les a pas encore démarrés ; ce clic reste donc obligatoire.

La demande de création est suivie pendant 24 heures. Le lien d’appairage du bot enfant expire après 15 minutes et ne peut servir qu’à lier une conversation privée. Un nouveau lien peut être généré à tout moment.

## Connexion manuelle de secours

Si aucun bot gestionnaire n’est souhaité, ouvrir **Connexion manuelle d’un bot existant**, créer directement le bot de notification avec BotFather, coller son jeton, puis terminer l’appairage avec **Démarrer**.

Le bot gestionnaire et le bot de notification doivent être deux bots distincts, car chacun utilise son propre flux `getUpdates`.

## Activation sur un agent

À la création ou dans l’éditeur d’un agent, activer **Envoyer les rapports et parler à l’agent sur Telegram**. L’agent enverra alors :

- chaque nouveau compte rendu ;
- une alerte lorsqu’une intervention devient nécessaire ;
- ses réponses après un message reçu dans Telegram.

Une réponse directe à un compte rendu est routée vers l’agent qui l’a envoyé. Si plusieurs agents utilisent le même bot, envoyer `/agents`, puis utiliser `@identifiant message` ou `/agent identifiant message`.

## Sécurité et fonctionnement

- Le jeton du bot et les identifiants Telegram restent côté serveur et ne sont jamais renvoyés à l’interface.
- Le jeton du bot gestionnaire est soumis aux mêmes protections et ne peut jamais être récupéré depuis l’API publique.
- Aucun numéro de téléphone n’est demandé ni enregistré.
- Aucun code SMS, mot de passe 2FA, `api_id`, `api_hash` ou fichier de session du compte Telegram n’est nécessaire.
- Seuls le compte et la conversation privée appairés peuvent commander les agents.
- Pour un bot créé par le gestionnaire, l’appairage exige le même compte Telegram que celui qui a confirmé sa création. Un changement de propriétaire déconnecte le bot par sécurité.
- Les mises à jour sont dédupliquées et leur position est persistée avant traitement.
- Le serveur utilise le long polling officiel `getUpdates`; il ne nécessite donc ni webhook ni domaine public.
- Utiliser un bot dédié. La connexion est refusée si le bot possède déjà un webhook, afin de ne pas interrompre un autre service.
- Déconnecter Telegram efface les identifiants et le jeton. L’identifiant interne du canal reste stable pour que les agents puissent reprendre après une reconnexion.

La plateforme Bot Telegram est gratuite selon la [documentation officielle Telegram](https://core.telegram.org/bots). Le parcours des bots gestionnaires est décrit dans [Telegram Bot Features](https://core.telegram.org/bots/features#managed-bots), et les méthodes utilisées dans la [Bot API](https://core.telegram.org/bots/api#getmanagedbottoken).
