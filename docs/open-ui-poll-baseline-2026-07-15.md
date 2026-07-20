# Baseline d'une interface chat distante ouverte — 15 juillet 2026

## Résultat retenu

La référence est un serveur Windows x64 isolé, relié à une page Chrome headless
de 1 440 × 900 dont `document.visibilityState` vaut `visible`, contenant quatre
chats. Le scénario ne contient aucun tour
actif, agent autonome utilisateur ni terminal. Sept phases de 30 secondes sont
jouées deux fois en ordre inversé : synchronisation partagée seule, chacune des
cinq routes périodiques isolée, puis interface complète.

Le binaire mesuré annonce `cst-server 0.1.0 (3bce641)` et porte le SHA-256
`EE8DB6AB87338E71719CA2009F3A04F0FB3BE29A4D4C475BA32DDFB254C412BA`.
Le frontend contient 36 fichiers, 2 101 847 octets, avec l'empreinte SHA-256
`E871371DE93738C6D1C4574B235F58E96B3C83CF23EA45F374504EFF7B011503`.
Le harnais copie ces deux artefacts dans son dossier jetable avant de démarrer :
un build concurrent ne peut donc plus modifier une capture en cours.

## Trafic périodique attribué

Les deux phases `full-interface` ont produit exactement le même trafic :

| Route | Intervalle UI | GET en 30 s |
| --- | ---: | ---: |
| `/api/chat/turns/active` | 1 s | 30 |
| `/api/autonomous-agents` | 2 s | 15 |
| `/api/limits` | 30 s | 1 |
| `/api/private-messages/users` | 8 s | 3 |
| `/api/private-messages/conversations` | 8 s | 3 |
| **Total** |  | **52** |

Les deux premières routes représentent 45 requêtes sur 52, soit 86,5 % du
trafic périodique observé. Les discussions utilisent déjà leur WebSocket :
aucun poll REST `/api/discussions`, aucune fermeture, et deux trames reçues et
deux trames envoyées par fenêtre.

Le harnais attend deux cycles de la messagerie chargée en idle, refuse tout HTTP
non attribué et vérifie la cadence de chaque poll. Une première capture rejetée
n'avait exécuté que 23 polls actifs ; avec la protection contre le throttling
Chrome, les 14 fenêtres retenues respectent toutes leur plage et comptent
31 échantillons sur 30,028 à 30,096 secondes.

## CPU : limite de résolution explicite

Le sampler mesure uniquement l'arbre serveur, pas le navigateur qui génère le
trafic. L'arbre contient seulement `cst-server` et `conhost`. La phase complète
a consommé 0,156 puis 0 CPU-s, soit une médiane de 0,078 CPU-s (0,26 % d'un
cœur). La phase partagée a consommé 0,031 puis 0 CPU-s.

Ces répétitions ne sont pas stables à la résolution Windows de 0,016 CPU-s. Le
modèle additif candidat prédit 0,156 CPU-s pour la phase complète alors que sa
médiane observée vaut 0,078 CPU-s, soit un résidu de -0,078 CPU-s. Aucun coût CPU
par route n'est donc attribué : les deltas bruts sont conservés dans la capture,
mais tous sont marqués non mesurables. Cette conclusion évite de transformer du
bruit d'ordonnancement en gain attendu.

Sur les 14 fenêtres, le maximum observé est de 2 processus, 29,46 Mio de working
set, 6,09 Mio de mémoire privée, 26 threads et 228 handles. La phase complète a
atteint 29,17 puis 28,01 Mio de working set.

## Reproduction

```powershell
node scripts\measure-open-ui-baseline.mjs `
  --server-path <cst-server-release.exe> `
  --static-dir <frontend-build> `
  --duration-seconds 30 `
  --repetitions 2 `
  --chat-count 4 `
  --output <capture.json>
```

La capture retenue est
`.codex-proof/open-ui-poll-baseline-validated-2026-07-15.json`. Elle exclut les
PID, ports, jetons et données de session jetables. Le prochain gain prioritaire
est de remplacer les polls tours actifs et agents par un signal authentifié
partagé avec reconnexion, puis de rejouer exactement ce scénario. La messagerie
privée constitue une tranche séparée à cause de son isolation par utilisateur.
