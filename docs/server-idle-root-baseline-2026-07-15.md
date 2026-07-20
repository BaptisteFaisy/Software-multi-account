# Baseline du serveur racine au repos — 15 juillet 2026

## Résultat retenu

La référence au repos est une instance Windows isolée du même binaire que le
serveur principal, sans client HTTP, terminal ni tour Codex. Le binaire mesuré
porte le commit `3bce641` et le SHA-256
`CDF4F7D6A2E1E996B846E454713F44B2A8E5A77EE890DCD6EDFAFC62DA9F78A3`.
L’instance est liée uniquement à `127.0.0.1` sur un port éphémère, utilise un
dossier de données jetable et est arrêtée avec son propre arbre après la
capture. Aucun serveur ou terminal existant n’est modifié.

Paramètres reproductibles : 30 secondes demandées, un échantillon par seconde
et un rafraîchissement de l’arbre toutes les quatre secondes. La capture a
couvert 30,050 secondes et produit 31 échantillons exploitables.

| Mesure | Arbre complet | `cst-server` seul |
| --- | ---: | ---: |
| CPU sur la fenêtre | 0 CPU-s | 0 CPU-s |
| Processus au pic | 2 | 1 |
| Working set au pic | 29,80 Mio | 20,16 Mio |
| Mémoire privée au pic | 3,59 Mio | 2,04 Mio |
| Threads au pic | 22 | 18 |
| Handles au pic | 232 | 110 |

Le second processus est `conhost`, créé par l’hébergement Windows du binaire ;
aucun `codex`, `node`, `cmd` ou `powershell` n’est observé. Le endpoint
`/healthz` est contrôlé après la fenêtre pour ne pas ajouter de requête à la
mesure : le serveur est prêt et annonce zéro terminal actif.

Une seconde exécution complète du harness a couvert 30,057 secondes avec
31 échantillons : 0 CPU-s, 2 processus, 29,71 Mio de working set, 3,60 Mio de
mémoire privée, 21 threads et 237 handles au pic. Elle a respecté tous les
contrats du budget, ce qui confirme que la première capture est reproductible
avec les marges retenues.

## Charge d’une interface ouverte, distincte du repos

Une observation séparée du même binaire sur le port portable, sans tour Codex
ni terminal mais avec 13 connexions locales établies, a couvert 30,048 secondes.
Elle a consommé 0,469 CPU-s, soit 1,56 % d’un cœur, avec 42,77 Mio de working set
pour l’arbre. Cette capture n’est pas éligible à la référence idle : elle mesure
le coût d’une interface ouverte et de ses synchronisations.

La lecture du code explique le delta sans désigner encore un endpoint par
profilage direct : la vue chat demande `/api/chat/turns/active` chaque seconde,
la liste des agents autonomes toutes les deux secondes et les limites toutes
les trente secondes. Les discussions utilisent déjà un WebSocket et ne font un
poll REST toutes les deux secondes que si ce flux n’est pas vivant. Les workers
Rust des agents et orchestrations se réveillent aussi chaque seconde, mais leur
coût cumulé reste sous la résolution du compteur CPU dans le scénario isolé.

Le prochain domaine d’optimisation est donc la synchronisation d’une interface
ouverte : supprimer les polls vides au profit d’un signal partagé, puis rejouer
le scénario connecté avec un nombre de clients et de chats fixé. Une simple
augmentation arbitraire des intervalles risquerait de dégrader la réactivité et
ne constitue pas la preuve recherchée.

## Reproduction et garde-fou

La mesure autonome s’exécute avec :

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File scripts\measure-server-idle-resources.ps1 `
  -ServerPath <chemin-vers-cst-server.exe>
```

Le budget `config/server-idle-resource-budget.json` accepte un maximum de
0,25 CPU-s sur la fenêtre identique, interdit tout fournisseur ou shell dans
l’arbre et conserve une marge sur les compteurs mémoire, threads et handles.
Une capture enregistrée se vérifie avec :

```powershell
node scripts\verify-server-resource-budget.mjs `
  --capture <capture-idle.json> `
  --budget config\server-idle-resource-budget.json
```
