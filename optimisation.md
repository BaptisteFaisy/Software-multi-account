# Optimisation des performances

Date de l'audit : 13 juillet 2026

## Résultat mesuré

La mesure reproductible disponible dans ce dépôt est la taille du build Vite de production. Les tailles « avant » ont été relevées sur `c6fd114` avant toute modification. Le résultat final est rebasé sur `d3ef08d`, qui contient aussi 19 commits fonctionnels ajoutés en parallèle pendant l'audit (Stats, état et défilement du chat, Goal, déploiement, etc.). Les temps de chargement réels n'ont pas été inventés : ils devront être mesurés sur les appareils et les volumes de données de production.

| Ressource sur le chemin initial | Avant | Après | Évolution |
| --- | ---: | ---: | ---: |
| JavaScript brut | 557 874 octets | 278 404 octets | **-50,1 %** |
| JavaScript gzip | 142 896 octets | 78 760 octets | **-44,9 %** |
| JavaScript Brotli | 119 235 octets | 65 718 octets | **-44,9 %** |
| CSS brut initial | 155 205 octets | 156 437 octets | +0,8 % |
| CSS gzip initial | 27 105 octets | 27 411 octets | +1,1 % |

Le terminal est maintenant un bloc différé de 289 316 octets (68 205 octets gzip) et 2 853 octets de CSS (778 octets gzip). Il n'est téléchargé et interprété qu'à la première ouverture d'un terminal. Le module de mise à jour est également différé : 1 456 octets, 735 octets gzip. Ces blocs ne font plus partie du premier affichage. La légère hausse du CSS critique inclut les nouvelles interfaces livrées par les 19 commits concurrents ; le CSS xterm, auparavant critique, est bien sorti de ce total.

La dépendance aux polices Google a été supprimée du chemin critique. Le navigateur utilise immédiatement les polices système, sans attendre une feuille de style tierce ni ses fichiers de police.

## Ce qui a été fait

### Démarrage et chargement du code

- Séparation de `xterm`, de son addon et de son CSS dans `src/terminal-runtime.ts`, chargé à la demande.
- Chargement dynamique du module de mise à jour Tauri pendant une période d'inactivité, uniquement dans l'application desktop.
- Premier rendu lancé avant le scan des discussions ; la restauration des chats arrive ensuite de façon asynchrone.
- Initialisations indépendantes lancées en parallèle : événements, registre des environnements et état plein écran.
- Écran de démarrage critique intégré directement dans `index.html`, pour éviter une fenêtre vide pendant l'initialisation.
- Cible JavaScript passée à ES2022 et polyfill `modulepreload` inutile désactivé.
- Suppression de l'import bloquant Google Fonts.

### Rendu, DOM et utilisation CPU

- Remplacement du passage global de Lucide par un rendu d'icônes limité au sous-arbre réellement modifié. Les SVG déjà présents ne sont plus détruits et recréés à chaque rafraîchissement.
- Signatures de rendu pour les flux de chat, états d'exécution, discussions, limites, usage, pool et collaboration. Un état identique ne déclenche plus de reconstruction DOM.
- Cache LRU du rendu Markdown, limité à 128 entrées et à un poids cumulé d'environ un million de caractères. Les anciens messages ne sont plus reparsés à chaque fragment reçu, et la mémoire reste bornée.
- `content-visibility: auto` sur les anciens tours de chat et les longues listes. Le navigateur peut ignorer le layout et la peinture des éléments hors écran.
- Synchronisation et polling limités aux chats visibles sur la page courante. Les réponses continuent côté backend ; leur état est resynchronisé lorsque le chat redevient visible.
- Remplacement de la recherche linéaire d'un terminal pour chaque paquet PTY par une `Map` indexée par identifiant.
- Vérification de l'environnement avant d'appliquer une réponse asynchrone de collaboration, afin de ne pas peindre les données de l'environnement précédent.

### Polling, réseau et tâches en arrière-plan

- Tous les intervalles coûteux sont suspendus lorsque la page est masquée, puis les données utiles sont actualisées dès le retour au premier plan.
- Protection « single flight » sur les scans de discussions et les requêtes pool, usage, Kombai et collaboration : deux ticks ne peuvent plus lancer la même opération simultanément.
- La collaboration demande uniquement les messages postérieurs au dernier curseur, déduplique les réponses et conserve au maximum 500 messages dans le DOM, au lieu de recharger tout l'historique chaque seconde.
- Le polling local des transcripts inactifs passe de 1 à 2 secondes. Le statut d'un tour actif garde sa fréquence de 550 ms pour préserver la réactivité.
- Les sondes de santé simultanées des nœuds de terminal distants sont fusionnées. Le résultat n'est volontairement pas conservé après le vol courant : une nouvelle ouverture revalide immédiatement l'état `draining/ready` et ne peut pas réintroduire un nœud en maintenance.
- Les fallbacks de polling restent présents si un WebSocket est indisponible, mais ils ne travaillent plus en arrière-plan lorsque l'onglet est caché.

### Discussions et backend Rust

- Cache par fichier des résumés Codex et Claude, invalidé par chemin, compte, taille et date de modification. Quand un transcript change, seul ce fichier est reparsé ; les milliers de fichiers inchangés sont réutilisés.
- Cache du tableau de bord complet par révision des discussions.
- Le WebSocket réutilise la révision qu'il vient de calculer au lieu de refaire immédiatement une seconde énumération des fichiers.
- Nettoyage des entrées de cache correspondant à un fichier supprimé ou à un compte renommé/modifié.
- Profil de production Rust renforcé : optimisation niveau 3, Thin LTO, une unité de génération de code et symboles retirés.

### Serveur web, cache HTTP et PWA

- Assets Vite nommés par hash : cache immuable d'un an.
- Icônes : cache de sept jours avec `stale-while-revalidate` ; manifeste, skills et audit Impeccable : cache d'une heure avec réutilisation pendant la revalidation.
- `index.html` et le service worker utilisent maintenant `no-cache, must-revalidate` : le navigateur peut obtenir une réponse `304` au lieu de retélécharger le fichier, sans conserver une version périmée sans validation.
- Preflights CORS mis en cache 24 heures sur le serveur principal et le pool, ce qui évite un `OPTIONS` avant chaque série de requêtes cross-origin.
- La compression Brotli/gzip déjà configurée côté serveur a été conservée et vérifiée.
- Service worker enregistré après le chargement, pendant une période d'inactivité, sans appel de mise à jour immédiatement redondant.
- Version du cache PWA dérivée de l'identifiant unique généré par chaque build Vite ; une nouvelle publication ne réutilise pas silencieusement l'ancien shell.
- Shell de navigation préchargé et servi en `stale-while-revalidate`, avec page hors ligne en secours. Les routes API, WebSocket et MCP privées restent explicitement exclues de tout cache.
- Audit des ressources statiques : les images PWA sont déjà petites (la plus grande fait 9 460 octets). Le détecteur Impeccable de 225 992 octets est déjà chargé uniquement lors d'un audit et n'a donc pas été ajouté au démarrage.

### Terminaux

- Runtime xterm chargé uniquement au premier besoin.
- Restauration des terminaux par lots de quatre au lieu d'un démarrage strictement séquentiel.
- Un seul rendu de progression par lot pendant la restauration, au lieu de deux rendus complets par terminal.
- Index direct des sessions par identifiant PTY pour les événements de sortie et de données.

### Garde-fous ajoutés

- Tests de performance structurels pour empêcher le retour de xterm ou de l'updater dans le bundle initial, du rendu global des icônes, des polices Google, des scans concurrents et des anciens en-têtes HTTP.
- Mise à jour du test de polling des quotas pour couvrir la suspension lorsque la page est cachée.

## Validation effectuée

- `npm run test:frontend` : **135 tests réussis, 0 échec**.
- `npm run build:frontend` : TypeScript et build Vite de production réussis.
- `cargo check --manifest-path src-tauri/Cargo.toml --bin codex-switch-terminal` : réussi.
- `cargo check --manifest-path src-tauri/Cargo.toml --bin cst-server` : réussi.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib` : **146 tests réussis, 0 échec**.
- `rustfmt --edition 2021 --check` sur les trois modules Rust modifiés : réussi.
- `git diff --check` : réussi.

Un avertissement de constante inutilisée, déjà présent dans `vendor/portable-pty`, reste sans rapport avec cette optimisation.

## Ce qu'il reste à faire

### Priorité 0 — mesurer la production

- Ajouter les Web Vitals (LCP, INP, CLS), les longues tâches et les erreurs de navigation avec un échantillonnage respectueux de la vie privée.
- Exécuter Lighthouse sur mobile et desktop, puis profiler le démarrage Tauri avec des machines lentes et un cache froid.
- Instrumenter les percentiles p50/p95/p99 des endpoints, du scan de discussions et de la lecture de transcript.
- Construire un jeu de charge représentatif : milliers de discussions, transcript très long, 16 chats et 16 terminaux. Fixer ensuite des budgets chiffrés en CI.

Sans ces données réelles, les réductions de bundle ci-dessus sont certaines, tandis que le gain exact de LCP/INP ou de latence disque reste à mesurer.

### Priorité 1 — chantiers architecturaux à fort gain

- Découper `src/main.ts` (environ 465 Ko et 11 900 lignes) par vue et charger dynamiquement les vues d'administration. Le bundle initial est revenu à une taille raisonnable, mais il contient encore du code sans rapport avec le chat initial.
- Découper/purger `src/style.css` (environ 213 Ko source) par fonctionnalité. Le CSS produit reste le plus gros bloc bloquant après le JavaScript initial.
- Remplacer les reconstructions `innerHTML` restantes des longues conversations par une liste virtualisée avec patchs indexés par identifiant de message.
- Côté desktop, suivre la fin des JSONL de façon incrémentale et utiliser un watcher de fichiers au lieu de relire un transcript complet à chaque changement.
- Remplacer les derniers fallbacks de polling par des événements Tauri ou des flux WebSocket, notamment pour la collaboration locale et les limites.
- Pour des dizaines de milliers de sessions, maintenir un index persistant des métadonnées de discussions au lieu d'énumérer tous les chemins afin de calculer chaque révision.

### Priorité 2 — livraison et budgets

- Servir les fichiers `.br`/`.gz` précompressés depuis le reverse proxy ou un CDN, et vérifier HTTP/2 ou HTTP/3 en production. Le serveur compresse déjà les réponses, mais la précompression économiserait du CPU.
- Ajouter un budget CI qui échoue si le JavaScript initial dépasse, par exemple, 300 Ko brut ou 85 Ko gzip.
- Étendre les tests du cache PWA versionné pour simuler une mise à jour complète entre deux builds déployés.
- Restreindre les origines CORS autorisées en production. La politique permissive existait déjà ; son `max-age` a été optimisé, mais son durcissement relève de la sécurité de déploiement.
- Si la typographie de marque doit être conservée, auto-héberger uniquement les variantes réellement utilisées en WOFF2 et les précharger avec parcimonie. Les polices système restent l'option la plus rapide.
- Mesurer le binaire release avec Thin LTO sur les plateformes cibles afin de confirmer le compromis entre durée de compilation, taille et temps de démarrage.

## Compromis connus

- La première ouverture d'un terminal paie désormais le téléchargement du bloc xterm ; les ouvertures suivantes le réutilisent. Ce coût a été déplacé hors du démarrage général, pas supprimé.
- Le shell PWA peut afficher instantanément la dernière version validée pendant que la suivante est récupérée en arrière-plan. Les données applicatives privées ne sont jamais servies par ce cache.
- Les polices système peuvent légèrement modifier la métrique et l'apparence du texte selon l'OS, en échange d'un affichage immédiat et sans dépendance réseau tierce.
