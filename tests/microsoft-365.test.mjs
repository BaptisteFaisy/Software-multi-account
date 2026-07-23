import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
/// Un fichier absent doit faire echouer le seul test qui le couvre, pas rendre
/// tout le module illisible : les autres proprietes restent verifiables.
const readOptional = (path) => {
  try {
    return read(path);
  } catch {
    return null;
  }
};

const backend = read("../src-tauri/src/microsoft.rs");
const server = read("../src-tauri/src/server.rs");
const chat = read("../src-tauri/src/chat.rs");
const modelTools = read("../src-tauri/src/chat_model_tools.rs");
const readme = read("../README.md");
const serverEnvExample = read("../deploy/cst-server.env.example");
const containerEnvExample = read("../deploy/cst-container.env.example");
const vpsDeploy = read("../scripts/deploy-vps.ps1");
const ansibleDeploy = read("../scripts/deploy-vps-ansible.ps1");
const oracleDeploy = read("../scripts/deploy-oracle-node.ps1");
const docs = readOptional("../docs/microsoft-365.md");

/// Les trois proprietes qui blessent l'utilisateur (heure locale, corps entier,
/// echappement) ne se lisent pas dans une regex : on execute reellement le
/// module. `./platform` touche localStorage des le chargement, il est donc
/// remplace par deux stubs — c'est la seule adaptation faite a la source.
const microsoftSource = read("../src/microsoft.ts");
assert.match(
  microsoftSource,
  /^import \{[^}]*\} from "\.\/platform";$/m,
  "l'import de ./platform a change de forme : le stub ci-dessous ne s'applique plus",
);
const microsoft = await import(
  `data:text/javascript;base64,${Buffer.from(
    ts.transpileModule(
      microsoftSource.replace(
        /^import \{[^}]*\} from "\.\/platform";$/m,
        'const isRemoteMode = () => true;\nconst remoteBaseUrl = () => "https://node.test";',
      ),
      { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
    ).outputText,
  ).toString("base64")}`
);

/// Rend les cartes reellement produites pour une liste d'actions donnee.
const renderPendingActions = async (actions, linkRequest = null) => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => JSON.stringify({ actions, linkRequest }),
  });
  try {
    await microsoft.refreshMicrosoftPendingActions();
  } finally {
    globalThis.fetch = previousFetch;
  }
  return microsoft.renderMicrosoftPendingActions();
};

const between = (source, from, to) => {
  const start = source.indexOf(from);
  assert.ok(start >= 0, `« ${from} » est introuvable`);
  const end = source.indexOf(to, start + from.length);
  assert.ok(end > start, `« ${to} » est introuvable apres « ${from} »`);
  return source.slice(start, end);
};

const fnBody = (source, name) => {
  const start = source.search(new RegExp(`(?:async )?fn ${name}\\(`));
  assert.ok(start >= 0, `la fonction ${name} est introuvable`);
  const rest = source.slice(start);
  const next = rest.slice(1).search(/\n\s*(?:pub(?:\(crate\))?\s+)?(?:async\s+)?fn\s/);
  return next >= 0 ? rest.slice(0, next + 1) : rest;
};

const structFields = (source, name) => {
  const declaration = `struct ${name} {`;
  const start = source.indexOf(declaration);
  assert.ok(start >= 0, `la structure ${name} est introuvable`);
  const end = source.indexOf("\n}", start);
  assert.ok(end > start, `la structure ${name} n'est pas refermee`);
  const body = source.slice(start + declaration.length, end);
  return [...body.matchAll(/^\s*([a-z_][a-z0-9_]*):/gm)].map((match) => match[1]);
};

/// Nom de la constante Rust -> valeur vue par le modele. Les quatre endroits
/// synchronises ci-dessous doivent tous parler de la meme chaine.
const microsoftTools = {
  LIST_OUTLOOK_MESSAGES_TOOL_NAME: "list_outlook_messages",
  LIST_CALENDAR_EVENTS_TOOL_NAME: "list_calendar_events",
  SEND_OUTLOOK_EMAIL_TOOL_NAME: "send_outlook_email",
  CREATE_CALENDAR_EVENT_TOOL_NAME: "create_calendar_event",
  UPDATE_CALENDAR_EVENT_TOOL_NAME: "update_calendar_event",
};

const microsoftEnvironment = [
  "CST_MICROSOFT_CLIENT_ID",
  "CST_MICROSOFT_CLIENT_SECRET",
  "CST_MICROSOFT_TENANT_ID",
  "CST_MICROSOFT_REDIRECT_URI",
];

test("les huit routes Microsoft sont montees sous /api/microsoft", () => {
  const router = between(backend, "fn router(manager: MicrosoftManager)", ".with_state(manager)");
  assert.match(router, /\.route\("\/connection", get\(api_connection\)\.delete\(api_disconnect\)\)/);
  assert.match(router, /\.route\("\/start", get\(api_start\)\)/);
  assert.match(router, /\.route\("\/callback", get\(api_callback\)\)/);
  assert.match(router, /\.route\("\/pending-actions", get\(api_pending_actions\)\)/);
  assert.match(router, /\.route\("\/pending-actions\/:id\/confirm", post\(api_confirm\)\)/);
  assert.match(router, /\.route\("\/pending-actions\/:id\/cancel", post\(api_cancel\)\)/);
  assert.match(server, /\.nest\("\/api\/microsoft", microsoft::router\(microsoft\)\)/);
  // Le retour du fournisseur ne rend que ces codes : l'interface n'a rien
  // d'autre a traduire, et rien de Microsoft n'atterrit dans l'URL.
  assert.match(backend, /"\/\?microsoft=linked"/);
  assert.match(backend, /"\/\?microsoft_error=\{code\}"/);
  for (const code of ["cancelled", "invalid", "conflict", "session", "failed"]) {
    assert.match(backend, new RegExp(`Err\\("${code}"\\)`), `le code ${code} n'est jamais emis`);
  }
});

test("la vue publique de la liaison ne peut laisser fuir aucun jeton", () => {
  assert.deepEqual(structFields(backend, "MicrosoftConnectionView"), [
    "configured",
    "connected",
    // Drapeau d'etat, pas un secret : il dit seulement que Microsoft a revoque
    // l'autorisation. La liste reste exhaustive, donc tout futur champ — jeton
    // ou non — fait toujours echouer ce test tant qu'il n'a pas ete relu ici.
    "needs_relink",
    "email",
    "display_name",
    "scopes",
    "linked_at",
    "tenant",
    "redirect_uri",
    "login_url",
  ]);
  const publicView = between(backend, "struct MicrosoftConnectionView", "struct PendingLink");
  assert.doesNotMatch(publicView, /token/i);
  assert.doesNotMatch(publicView, /secret/i);
  // L'absence ci-dessus n'est pas un effet de bord d'une extraction vide : le
  // meme fichier stocke bien deux jetons, simplement hors de la vue serialisee.
  const stored = structFields(backend, "StoredLink");
  assert.ok(stored.includes("access_token"));
  assert.ok(stored.includes("refresh_token"));
});

test("la deconnexion et les deux mutations d'action exigent l'en-tete de confirmation", () => {
  const guard = fnBody(backend, "require_same_site");
  assert.match(guard, /headers\s*\.get\("x-cst-confirm"\)/);
  assert.match(guard, /value == "1"/);
  assert.match(guard, /MicrosoftError::forbidden/);
  for (const handler of ["api_disconnect", "api_confirm", "api_cancel"]) {
    const body = fnBody(backend, handler);
    assert.match(body, /let identity = manager\.identity\(&headers\)\?;/, handler);
    assert.match(body, /require_same_site\(&headers\)\?;/, handler);
  }
  // Une lecture ne doit pas l'exiger : la liste des cartes doit survivre a un
  // simple rechargement de page, sans en-tete applicatif.
  assert.doesNotMatch(fnBody(backend, "api_pending_actions"), /require_same_site/);
});

test("les cinq outils Microsoft restent synchronises aux quatre endroits", () => {
  const declarations = between(modelTools, "pub const LIST_OUTLOOK_MESSAGES_TOOL_NAME", "\n\n");
  // Ancre volontairement ouverte sur la parenthese : la propriete verifiee est
  // la presence des cinq outils dans la reponse, pas la liste des parametres de
  // la fonction, qui a deja gagne un `scope` sans rien changer a la garantie.
  const toolsList = between(modelTools, "fn tools_list_response(id: Value", "\npub(crate) fn tool_microsoft_data_response");
  const allowList = between(server, '"tools/call" => {', "let context_result");
  const dispatch = between(server, "let arguments = payload", '_ => unreachable!("outil valide avant le dispatch")');
  const allowedTools = between(chat, '.arg("--allowedTools")', "));");
  const enabledTools = between(chat, "{prefix}.enabled_tools=[", "\n");

  for (const [constant, wireName] of Object.entries(microsoftTools)) {
    assert.match(
      declarations,
      new RegExp(`pub const ${constant}: &str = "${wireName}";`),
      `${constant} ne vaut plus ${wireName}`,
    );
    assert.match(toolsList, new RegExp(`"name": ${constant},`), `${constant} manque a tools/list`);
    assert.match(allowList, new RegExp(`name != ${constant}`), `${constant} manque a l'autorisation`);
    assert.match(dispatch, new RegExp(`\\b${constant}\\b`), `${constant} manque au dispatch`);
    assert.match(
      allowedTools,
      new RegExp(`mcp__\\{MCP_SERVER_NAME\\}__\\{${constant}\\}`),
      `${constant} manque a --allowedTools`,
    );
    assert.match(enabledTools, new RegExp(`\\\\"\\{${constant}\\}\\\\"`), `${constant} manque a enabled_tools`);
  }
});

test("les trois outils d'ecriture n'aboutissent que par la file de confirmation", () => {
  const dispatch = between(server, "let arguments = payload", '_ => unreachable!("outil valide avant le dispatch")');
  assert.match(dispatch, /\.microsoft\s*\.enqueue\(&owner_id, draft, context\.source_chat_key/);
  assert.doesNotMatch(dispatch, /sendMail|\.execute\(/);
  assert.doesNotMatch(server, /sendMail/);

  // Un seul envoi Graph dans tout le module, atteignable depuis le seul
  // handler de confirmation : aucun bras d'outil ne peut le court-circuiter.
  assert.equal(backend.match(/\/me\/sendMail/g).length, 1);
  assert.match(fnBody(backend, "execute"), /\/me\/sendMail/);
  assert.equal(backend.match(/\.execute\(&action\)/g).length, 1);
  assert.match(fnBody(backend, "api_confirm"), /manager\.execute\(&action\)\.await/);

  const enqueue = fnBody(backend, "enqueue");
  assert.doesNotMatch(enqueue, /graph_post|sendMail|\.patch\(/);
  assert.match(enqueue, /state\.actions\.push\(action\.clone\(\)\)/);
});

test("les variables CST_MICROSOFT_* sont documentees et transportees jusqu'au serveur", () => {
  for (const name of microsoftEnvironment) {
    assert.match(readme, new RegExp(name), `${name} n'est pas documente dans README.md`);
    assert.match(serverEnvExample, new RegExp(name), `${name} manque a cst-server.env.example`);
    assert.match(containerEnvExample, new RegExp(name), `${name} manque a cst-container.env.example`);
    // Sans entree dans la liste blanche, la variable reste sur le poste local
    // et l'integration se desactive silencieusement sur le noeud deploye.
    assert.match(vpsDeploy, new RegExp(`["']${name}["']`), `${name} manque a deploy-vps.ps1`);
    assert.match(ansibleDeploy, new RegExp(`["']${name}["']`), `${name} manque a deploy-vps-ansible.ps1`);
    assert.match(oracleDeploy, new RegExp(`["']${name}["']`), `${name} manque a deploy-oracle-node.ps1`);
  }

  // CST_MICROSOFT_SCOPES est facultatif, donc absent du README qui ne garde que
  // l'essentiel. Mais des lors que docs/microsoft-365.md dit qu'il se pose avec
  // les autres, il doit aussi arriver jusqu'au noeud : sinon la portee retiree
  // sur le poste local reste accordee en production.
  assert.match(docs ?? "", /CST_MICROSOFT_SCOPES/, "CST_MICROSOFT_SCOPES n'est plus documente");
  for (const [label, source] of [
    ["cst-server.env.example", serverEnvExample],
    ["cst-container.env.example", containerEnvExample],
    ["deploy-vps.ps1", vpsDeploy],
    ["deploy-vps-ansible.ps1", ansibleDeploy],
    ["deploy-oracle-node.ps1", oracleDeploy],
  ]) {
    assert.match(source, /CST_MICROSOFT_SCOPES/, `CST_MICROSOFT_SCOPES manque a ${label}`);
  }
});

test("la documentation existe et n'affirme pas que les jetons ne sont pas stockes", () => {
  assert.ok(docs, "docs/microsoft-365.md est absent");
  assert.match(docs, /Entra|Azure/i);
  assert.match(docs, /\/api\/microsoft\/callback/);
  // Les jetons vivent bel et bien sur le serveur : la page qui explique la
  // liaison ne doit pas promettre le contraire a l'utilisateur.
  assert.match(docs, /jetons?/i);
  assert.match(docs, /stock|conserv|enregistr/i);
  for (const claim of [
    /aucun jeton n['’]est (?:jamais )?(?:stock|conserv|enregistr)/i,
    /jetons? ne (?:sont|est) (?:jamais |pas )?(?:stock|conserv|enregistr)/i,
    /ne (?:stocke|conserve|enregistre) (?:aucun|pas de) jeton/i,
  ]) {
    assert.doesNotMatch(docs, claim, "la documentation nie le stockage des jetons");
  }
});

test("un horaire UTC sans suffixe est lu en UTC, jamais en heure locale", () => {
  // `graph_instant` (microsoft.rs) emet exactement ce format. Lu tel quel par
  // new Date(), il serait pris pour une heure locale et la carte afficherait
  // 12:00 pour un rendez-vous reellement fixe a 14:00 heure de Paris.
  const midi = Date.UTC(2026, 6, 25, 12, 0, 0);
  assert.equal(microsoft.microsoftGraphInstant("2026-07-25T12:00:00").getTime(), midi);
  assert.equal(microsoft.microsoftGraphInstant("2026-07-25T12:00:00Z").getTime(), midi);
  assert.equal(microsoft.microsoftGraphInstant("2026-07-25T12:00:00.0000000").getTime(), midi);
  // Un decalage deja present ne doit surtout pas etre ecrase par un « Z ».
  assert.equal(
    microsoft.microsoftGraphInstant("2026-07-25T14:00:00+02:00").getTime(),
    midi,
    "un decalage explicite a ete ignore",
  );
  assert.equal(microsoft.microsoftGraphInstant(""), null);
  assert.equal(microsoft.microsoftGraphInstant("pas une date"), null);

  // Fuseau fige pendant l'assertion : sur une machine reglee en UTC, un rendu
  // qui oublierait la conversion resterait invisible. Ici 12:00 UTC doit se
  // lire 14:00, et le module doit rendre exactement la meme chaine.
  const previousTz = process.env.TZ;
  process.env.TZ = "Europe/Paris";
  try {
    const attendu = new Date(midi).toLocaleString("fr-FR", { dateStyle: "full", timeStyle: "short" });
    assert.match(attendu, /14:00/, "le fuseau de reference n'a pas ete pris en compte");
    assert.equal(microsoft.formatMicrosoftInstant("2026-07-25T12:00:00"), attendu);
  } finally {
    if (previousTz === undefined) delete process.env.TZ;
    else process.env.TZ = previousTz;
  }
  assert.equal(microsoft.formatMicrosoftInstant(null), "Date inconnue");
  assert.equal(microsoft.microsoftEventDuration("2026-07-25T12:00:00", "2026-07-25T13:30:00"), "1 h 30");
});

test("l'en-tete de la carte annonce la meme heure que la ligne Debut", async () => {
  // Resume produit par MicrosoftDraft::summary() : il cite l'instant brut.
  const summary = "Nouvel evenement « Point equipe » le 2026-07-25T12:00:00";
  const localized = microsoft.formatMicrosoftInstant("2026-07-25T12:00:00");
  assert.equal(
    microsoft.localizeMicrosoftSummary(summary),
    `Nouvel evenement « Point equipe » le ${localized}`,
  );

  const html = await renderPendingActions([
    {
      id: "act-1",
      kind: "createEvent",
      summary,
      sourceChatKey: null,
      createdAt: 1_800_000_000,
      expiresAt: 1_800_021_600,
      draft: {
        kind: "createEvent",
        subject: "Point equipe",
        start: "2026-07-25T12:00:00",
        end: "2026-07-25T13:00:00",
        attendees: [],
        location: null,
        body: null,
        onlineMeeting: false,
      },
    },
  ]);
  assert.doesNotMatch(html, /2026-07-25T12:00:00/, "un horaire UTC brut reste affiche");
  // Le meme instant, deux fois : en-tete et ligne « Debut ».
  assert.equal(html.split(localized).length - 1, 2);
});

test("le corps complet de l'e-mail est affiche, echappe et jamais tronque", async () => {
  const payload = `<img src=x onerror="alert(1)">`;
  const body = [
    `Bonjour, ${payload}`,
    "Corps volontairement long. ".repeat(600),
    "SIGNATURE-DE-FIN",
  ].join("\n");
  const html = await renderPendingActions([
    {
      id: "act-2",
      kind: "sendEmail",
      summary: `E-mail « ${payload} » a client@example.com`,
      sourceChatKey: null,
      createdAt: 1_800_000_000,
      expiresAt: 1_800_021_600,
      draft: {
        kind: "sendEmail",
        to: ["client@example.com"],
        cc: [],
        subject: payload,
        body,
      },
    },
  ]);

  // Le bloc rendu doit etre le corps entier, caractere pour caractere : ni
  // coupe, ni resume par des points de suspension.
  const shown = between(html, `<pre tabindex="0">`, "</pre>").slice(`<pre tabindex="0">`.length);
  const escaped = body
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
  assert.equal(shown, escaped);
  assert.match(shown, /SIGNATURE-DE-FIN$/);

  // Le contenu venant du modele n'entre jamais tel quel dans le HTML : ni dans
  // le corps, ni dans l'objet, ni dans le resume de l'en-tete.
  assert.ok(!html.includes(payload), "la charge du modele est ressortie telle quelle");
  assert.doesNotMatch(html, /<img/i, "une balise du modele a survecu au rendu");
  assert.doesNotMatch(html, /onerror="/i, "un attribut d'evenement a survecu au rendu");
  assert.equal(html.split("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;").length - 1, 3);
});

const userAuth = read("../src/user-auth.ts");
const mainSource = read("../src/main.ts");
const autonomous = read("../src-tauri/src/autonomous.rs");

test("la liaison Microsoft se pilote depuis Mon compte, pas depuis les Parametres", () => {
  // La liaison est nominative : elle suit la personne connectee, pas le poste
  // ni le serveur. La rendre dans les Parametres, a cote de Telegram et
  // WhatsApp qui sont des reglages d'instance, invite a la confusion sur un
  // noeud partage par plusieurs comptes.
  assert.match(userAuth, /renderMicrosoftConnectionSettings\(\)/);
  assert.match(userAuth, /class="user-profile-services"/);
  assert.match(userAuth, /renderMicrosoftPendingActions\(\)/);

  // Les Parametres ne doivent plus rendre la carte elle-meme, seulement y renvoyer.
  assert.doesNotMatch(
    mainSource,
    /\$\{renderMicrosoftConnectionSettings\(\)\}/,
    "la carte de liaison est encore rendue dans les Parametres : deux sources de verite",
  );
  assert.match(mainSource, /renderMicrosoftAccountShortcut\(\)/);
  assert.match(mainSource, /#settingsMicrosoftAccount/);

  // Sans relais de clic dans la modale, les boutons Envoyer et Annuler des
  // cartes de confirmation y seraient inertes.
  assert.match(userAuth, /handleMicrosoftPendingActionClick/);

  // Le retour de Microsoft doit rouvrir Mon compte, sinon les messages de
  // succes et d'echec traduits ne sont jamais lus.
  assert.match(mainSource, /takeMicrosoftOAuthResultRedirect\(\)\)\s*openUserProfileModal\(\)/);

  assert.ok(docs, "docs/microsoft-365.md est absent");
  assert.match(docs, /Mon compte\*\*, puis descendre jusqu’à la carte \*\*Microsoft 365/);
});

test("les actions deposees par un agent restent visibles hors de toute conversation", () => {
  // Un agent autonome depose ses brouillons pendant que personne ne regarde.
  // Sans compteur global ni sondage, ils n'apparaitraient qu'a la prochaine
  // ouverture d'un chat, puis expireraient au bout de six heures.
  assert.match(userAuth, /microsoftPendingActionCount\(\)/);
  assert.match(userAuth, /class="user-profile-pending"/);
  assert.match(microsoftSource, /export const startMicrosoftPendingPolling/);
  assert.match(mainSource, /startMicrosoftPendingPolling\(render\)/);
});

test("un agent autonome n'agit que pour un proprietaire nominatif et sur les seuls outils Microsoft", () => {
  // owner_id impose par le serveur : un client ne doit pas pouvoir creer un
  // agent qui travaillerait sur la boite de quelqu'un d'autre.
  assert.match(autonomous, /pub owner_id: Option<String>/);
  assert.match(
    autonomous,
    /#\[serde\(skip\)\]\s*\n\s*pub owner_id: Option<String>/,
    "owner_id est deserialise depuis le corps de la requete de creation",
  );
  assert.match(server, /request\.owner_id = actor\.user\(\)\.map\(/);

  // Portee restreinte : un agent qui pourrait creer d'autres agents ou ouvrir
  // des chats echapperait a tout controle humain.
  assert.match(modelTools, /enum ChatToolScope/);
  assert.match(modelTools, /PersonalDataOnly/);
  assert.match(server, /scope: ChatToolScope::PersonalDataOnly/);
  assert.match(server, /scope: ChatToolScope::Full/);

  // Le filtre doit s'appliquer AUX DEUX endroits : la liste des outils et le
  // dispatch. Ne filtrer que la liste laisserait un appel direct passer.
  assert.match(server, /tools_list_response\(\s*id,\s*capability\.scope,?\s*\)/);
  assert.match(server, /if !capability\.scope\.allows\(name\)/);

  // Sans proprietaire, aucun outil : deviner une boite reviendrait a ecrire
  // depuis celle de quelqu'un d'autre.
  assert.match(server, /let owner_id = agent\.owner_id\.clone\(\)\?;/);
});

test("une conversation qui reclame la boite propose de connecter le compte", async () => {
  // Sans cette carte, le modele annonce un echec et l'utilisateur n'a aucun
  // moyen, depuis la ou il est, de le reparer : il doit deviner qu'il faut
  // ouvrir Mon compte.
  const html = await renderPendingActions([], {
    requestedAt: 1_800_000_000,
    expiresAt: 1_800_003_600,
    configured: true,
    needsRelink: false,
    loginUrl: "https://cst.example.test/api/microsoft/start",
  });
  assert.match(html, /microsoft-link-request/);
  assert.match(html, /Connecter Microsoft 365/);
  assert.match(html, /href="https:\/\/cst\.example\.test\/api\/microsoft\/start"/);

  // Serveur sans configuration Entra : proposer un bouton mènerait l'utilisateur
  // vers une page d'erreur Microsoft. La carte doit l'expliquer.
  const unconfigured = await renderPendingActions([], {
    requestedAt: 1_800_000_000,
    expiresAt: 1_800_003_600,
    configured: false,
    needsRelink: false,
    loginUrl: null,
  });
  assert.match(unconfigured, /microsoft-link-request/);
  assert.doesNotMatch(unconfigured, /microsoft-connect-button/);
  assert.match(unconfigured, /docs\/microsoft-365\.md/);

  // Aucune demande : aucune carte, la conversation reste propre.
  assert.equal(await renderPendingActions([], null), "");
});

test("un brouillon prepare sans compte lie garde son contenu et bloque l'envoi", async () => {
  const body = "Bonjour,\n\nVoici le point demande.\n\nSIGNATURE";
  const html = await renderPendingActions(
    [
      {
        id: "action-9",
        kind: "sendEmail",
        summary: "E-mail « Point » a client@example.com",
        sourceChatKey: "chat-1",
        createdAt: 1_800_000_000,
        expiresAt: 1_800_021_600,
        requiresLink: true,
        draft: {
          kind: "sendEmail",
          to: ["client@example.com"],
          cc: [],
          subject: "Point",
          body,
        },
      },
    ],
    {
      requestedAt: 1_800_000_000,
      expiresAt: 1_800_003_600,
      configured: true,
      needsRelink: false,
      loginUrl: "https://cst.example.test/api/microsoft/start",
    },
  );

  // Le travail du modele n'est pas perdu : le corps redige est toujours la.
  assert.ok(html.includes("SIGNATURE"), "le corps du brouillon a disparu");
  assert.match(html, /is-blocked/);

  // Le bouton d'envoi doit etre ferme : laisser cliquer produirait une erreur
  // que rien dans la carte n'aurait annoncee.
  const confirm = between(html, 'data-microsoft-action="confirm"', "</button>");
  assert.match(confirm, /disabled/);
  // Annuler reste possible : on doit pouvoir jeter un brouillon sans lier de compte.
  const cancel = between(html, 'data-microsoft-action="cancel"', "</button>");
  assert.doesNotMatch(cancel, /disabled/);

  // La proposition de liaison precede le brouillon qu'elle debloque.
  assert.ok(
    html.indexOf("microsoft-link-request") < html.indexOf("data-microsoft-pending-action"),
    "la carte de liaison doit preceder les brouillons",
  );
});

test("la demande de liaison a une route dediee et n'echappe pas au garde CSRF", () => {
  assert.match(backend, /\.route\("\/link-request", axum::routing::delete\(api_dismiss_link_request\)\)/);
  const handler = between(backend, "async fn api_dismiss_link_request", "\n}\n");
  assert.match(handler, /require_same_site\(&headers\)\?/);
  assert.match(handler, /manager\.identity\(&headers\)\?/);

  // La demande ne doit naitre que d'un compte absent ou revoque : un 502 de
  // Graph proposerait de relier un compte pourtant valide.
  const noted = between(backend, "async fn access_token_for_owner", "async fn resolve_access_token");
  assert.match(noted, /StatusCode::NOT_FOUND \| StatusCode::UNAUTHORIZED/);
  assert.match(noted, /self\.note_link_request\(owner_id\)/);
});
