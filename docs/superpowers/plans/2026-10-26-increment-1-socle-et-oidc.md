# Incrément 1 : socle serveur et OIDC — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mettre le lecteur derrière une connexion OIDC (Authentik) avec sessions côté serveur, rôles `admin`/`user`, refus sans groupe, déconnexion, le tout dans une image Docker unique testable avec un fournisseur OIDC factice.

**Architecture:** Un serveur Hono sur Node 24 sert le build Vite et l'API `/api` sur le port 8080 ; SQLite (`node:sqlite`) dans `DATA_DIR` porte utilisateurs et sessions ; `openid-client` gère Authorization Code + PKCE et le rafraîchissement ; le frontend interroge `GET /api/session` avant d'afficher le lecteur. Le catalogue reste `music/data.json` et les médias restent dans `public/` pendant cet incrément.

**Tech Stack:** Node 24.6 (type stripping natif, `node:sqlite`, `node:test`), TypeScript 7, Hono 4.13, `@hono/node-server` 2.1, `openid-client` 6.8, `oidc-provider` 9.13 (dev/tests seulement), React 19, Vite 8, Playwright 1.64, Bun 1.2 (tests frontend existants).

**Spec:** `docs/superpowers/specs/2026-10-26-plateforme-serveur-et-oidc-design.md` (§4, §5.1, §5.3 `users`/`sessions`, §5.4 routes auth/session, §5.5, §5.9 porte d'entrée et déconnexion, §5.10, §6, §8 incrément 1).

## Global Constraints

- Node `>=24 <25`, Yarn 1.22.22, un seul `yarn.lock` ; dépendances épinglées en versions exactes comme le reste du `package.json`.
- Code serveur en TypeScript « effaçable » (exécuté par Node sans transpilation en dev et tests) : `verbatimModuleSyntax`, `erasableSyntaxOnly`, pas d'`enum`, pas de propriétés de paramètre, imports relatifs avec extension `.ts`.
- Secrets uniquement par variables d'environnement ; `.env.example` et `.env.development` sans secret réel ; `.gitignore` conserve `.env`, `.env.*`, `!.env.*.example`.
- Groupes par défaut `admin` et `users`, claim `groups`, configurables (`OIDC_GROUP_ADMIN`, `OIDC_GROUP_USERS`, `OIDC_GROUPS_CLAIM`).
- Cookie de session `player_session` : `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` si `APP_URL` commence par `https://`. Durée absolue `SESSION_TTL_HOURS` (défaut 12). Réévaluation des groupes au plus toutes les 15 minutes.
- Requêtes modifiantes : en-tête `X-Requested-With: player` obligatoire, sinon `403 { "error": { "code": "csrf" } }`.
- Erreurs JSON : `{ "error": { "code": string, "message": string } }`.
- Conteneur non-root (uid 101), `read_only`, seuls `/data` et `/tmp` inscriptibles ; healthcheck `GET /healthz` → `200 ok`.
- Aucun changement de disposition ou de style du lecteur existant hors de l'ajout du lien de déconnexion en bas à gauche et de l'écran de refus.
- Commits sans trailer d'attribution, messages en anglais à l'impératif comme l'historique.

## Review Focus

1. Un ID token sans claim `groups` (scope mapping Authentik manquant) : attendu `403 no_group` et un journal serveur explicite, jamais un rôle par défaut. Test ajouté en Task 4.
2. Une session dont le rafraîchissement échoue pendant que l'utilisateur écoute : attendu `401` sur la requête suivante et, côté client, arrêt du média puis redirection vers `/api/auth/login`. Tests en Task 7 (serveur) et Task 11 (client).
3. Un `state` ou un `nonce` qui ne correspond pas au cookie temporaire (lien de callback rejoué, deux onglets) : attendu `400 { code: "oidc_state" }` sans création de session. Test en Task 8.
4. Un `APP_URL` en `http://` en production : le cookie ne serait pas `Secure` ; attendu un avertissement au démarrage et refus si `NODE_ENV=production` et `APP_URL` non `https`. Test en Task 1.
5. Une requête directe `GET /index.html` ou `GET /assets/x.js` sans session : les fichiers statiques sont servis (le navigateur doit pouvoir charger l'app pour être redirigé), mais `GET /api/*` répond `401` ; les anciens médias `/Drops.mp3` restent accessibles pendant cet incrément (migration à l'incrément 2, documenté). Test en Task 9.

---

### Task 1 : Scaffold serveur et configuration

**Files:**

- Create: `server/tsconfig.json`, `server/src/config.ts`, `server/test/config.test.ts`, `.env.example`
- Modify: `package.json` (dépendances, scripts), `tsconfig.json` (exclure `server/` du typecheck frontend), `.oxlintrc.json` (override `server/**/*` dans la règle `no-em-dash-copy`), `.oxfmtrc.json` (inclure `server/`)

**Interfaces:**

- Produces: `loadConfig(env: Record<string, string | undefined>): AppConfig` et `class ConfigError extends Error`.

  ```ts
  export interface AppConfig {
    appUrl: URL;
    port: number;
    dataDir: string;
    nodeEnv: "development" | "production" | "test";
    oidc: {
      issuer: string;
      clientId: string;
      clientSecret: string;
      groupsClaim: string;
      groupAdmin: string;
      groupUsers: string;
    };
    session: {
      secret: Buffer /* 32 octets, décodé depuis base64 ou hex */;
      ttlMs: number;
      groupsRecheckMs: number;
    };
    trustProxy: boolean;
  }
  ```

  Valeurs par défaut : `PORT` 8080, `DATA_DIR` `/data`, `OIDC_GROUPS_CLAIM` `groups`, `OIDC_GROUP_ADMIN` `admin`, `OIDC_GROUP_USERS` `users`, `SESSION_TTL_HOURS` 12, `TRUST_PROXY` `false`, `NODE_ENV` `production`. `groupsRecheckMs` = 15 minutes.

- [ ] **Step 1 : Ajouter les dépendances et scripts**

```bash
yarn add --exact hono@4.13.14 @hono/node-server@2.1.5 openid-client@6.8.8
yarn add --dev --exact oidc-provider@9.13.0 concurrently@9.2.1
```

Scripts `package.json` :

- `"dev": "concurrently -n web,api,oidc \"vite\" \"yarn dev:server\" \"yarn dev:oidc\""`
- `"dev:server": "node --env-file=.env.development --no-warnings=ExperimentalWarning --watch server/src/main.ts"`
- `"dev:oidc": "node --watch server/dev/mock-oidc.ts"`
- `"build": "vite build && yarn build:server"`, `"build:server": "tsc -p server/tsconfig.json"`
- `"start": "node --no-warnings=ExperimentalWarning dist/server/main.js"`
- `"typecheck": "tsc --noEmit --incremental false && tsc --noEmit -p server/tsconfig.json"`
- `"test:server": "node --no-warnings=ExperimentalWarning --test \"server/test/**/*.test.ts\""`
- `"validate": "yarn lint && yarn format:check && yarn typecheck && yarn test && yarn test:server && yarn build"`

`server/tsconfig.json` : `module` et `moduleResolution` `nodenext`, `target` `es2022`, `strict`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `allowImportingTsExtensions`, `rewriteRelativeImportExtensions`, `outDir` `../dist/server`, `rootDir` `src`, `types: ["node"]`, `include: ["src"]`. Le `tsconfig.json` racine ajoute `"server"` à `exclude`.

- [ ] **Step 2 : Écrire le test de configuration**

`server/test/config.test.ts` (node:test, `assert/strict`) :

- `loadConfig` avec les variables minimales (`APP_URL=https://player.example`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `SESSION_SECRET` = 64 hex) retourne `port 8080`, `dataDir "/data"`, `oidc.groupAdmin "admin"`, `session.ttlMs 43_200_000`, `session.groupsRecheckMs 900_000`, `trustProxy false`.
- sans `OIDC_ISSUER` → lève `ConfigError` dont le message contient `OIDC_ISSUER`.
- `SESSION_SECRET` de 10 caractères → `ConfigError` mentionnant `32`.
- `NODE_ENV=production` et `APP_URL=http://player.example` → `ConfigError` mentionnant `https`.
- `NODE_ENV=development` et `APP_URL=http://localhost:3000` → accepté.

- [ ] **Step 3 : Lancer le test, vérifier l'échec** — `yarn test:server` → échec « Cannot find module … config.ts ».

- [ ] **Step 4 : Implémenter `loadConfig` et `ConfigError` dans `server/src/config.ts`** — parse manuelle, pas de bibliothèque ; `SESSION_SECRET` accepté en hex (64) ou base64 (44), décodé en `Buffer` de 32 octets.

- [ ] **Step 5 : Lancer le test, vérifier le succès** — `yarn test:server` → `pass 5`.

- [ ] **Step 6 : Écrire `.env.example`** avec chaque variable du §5.10 commentée, valeurs vides pour les secrets.

- [ ] **Step 7 : Commit** — `git add package.json yarn.lock server tsconfig.json .oxlintrc.json .oxfmtrc.json .env.example && git commit -m "Add server scaffold and configuration loader"`.

---

### Task 2 : Base SQLite et migrations

**Files:**

- Create: `server/src/db.ts`, `server/src/migrations.ts`, `server/test/db.test.ts`

**Interfaces:**

- Produces: `openDatabase(file: string): DatabaseSync` (crée le dossier parent, `PRAGMA journal_mode = WAL`, `PRAGMA foreign_keys = ON`) ; `migrate(db: DatabaseSync): number` (retourne le nombre de migrations appliquées, idempotent, table `schema_migrations(id INTEGER PRIMARY KEY, applied_at TEXT)`) ; `MIGRATIONS: { id: number; sql: string }[]`.
- Migration 1 :

  ```sql
  CREATE TABLE users (id TEXT PRIMARY KEY, issuer TEXT NOT NULL, subject TEXT NOT NULL, display_name TEXT, email TEXT, groups TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, UNIQUE(issuer, subject));
  CREATE TABLE sessions (id_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, refresh_token_sealed TEXT, id_token_sealed TEXT, groups_checked_at TEXT NOT NULL);
  CREATE INDEX sessions_user_id ON sessions(user_id);
  ```

- [ ] **Step 1 : Test** `server/test/db.test.ts` : `openDatabase(":memory:")` puis `migrate` retourne `1`, un second `migrate` retourne `0`, `PRAGMA journal_mode` vaut `memory` ou `wal`, et `INSERT INTO sessions` avec un `user_id` inconnu lève une erreur de clé étrangère.
- [ ] **Step 2 : Vérifier l'échec.**
- [ ] **Step 3 : Implémenter `db.ts` et `migrations.ts`** (`import { DatabaseSync } from "node:sqlite"`).
- [ ] **Step 4 : Vérifier le succès.**
- [ ] **Step 5 : Commit** — `git commit -m "Add SQLite database with migrations"`.

---

### Task 3 : Scellement des secrets et identifiants de session

**Files:**

- Create: `server/src/crypto.ts`, `server/test/crypto.test.ts`

**Interfaces:**

- Produces: `seal(plain: string, key: Buffer): string` (AES-256-GCM, format `base64url(iv).base64url(tag).base64url(ciphertext)`), `open(sealed: string, key: Buffer): string | null` (`null` si altéré ou mauvaise clé), `newSessionId(): string` (32 octets aléatoires en base64url), `hashSessionId(id: string): string` (sha256 hex).

- [ ] **Step 1 : Test** : round-trip `open(seal(x))` = `x` ; `open` avec un caractère modifié → `null` ; `open` avec une autre clé → `null` ; deux `seal` du même texte diffèrent ; `newSessionId()` fait 43 caractères et deux appels diffèrent ; `hashSessionId` est stable et fait 64 hex.
- [ ] **Step 2 : Échec.** — [ ] **Step 3 : Implémenter avec `node:crypto`.** — [ ] **Step 4 : Succès.**
- [ ] **Step 5 : Commit** — `git commit -m "Add sealing helpers for session secrets"`.

---

### Task 4 : Résolution du rôle depuis les groupes

**Files:**

- Create: `server/src/auth/roles.ts`, `server/test/roles.test.ts`

**Interfaces:**

- Produces: `type Role = "admin" | "user"` ; `resolveRole(claims: Record<string, unknown>, oidc: AppConfig["oidc"]): { role: Role | null; groups: string[]; reason?: "missing_claim" | "no_group" }`.

- [ ] **Step 1 : Test** : `{ groups: ["users"] }` → `user` ; `{ groups: ["admin"] }` → `admin` ; `{ groups: ["admin", "users"] }` → `admin` ; `{ groups: [] }` → `null`, `reason "no_group"` ; claim absente → `null`, `reason "missing_claim"` ; claim non tableau (`"users"`) → `null`, `reason "missing_claim"` ; claim personnalisée `OIDC_GROUPS_CLAIM=roles` avec `OIDC_GROUP_ADMIN=player-admin` → `admin`. (Couvre Review Focus 1.)
- [ ] **Step 2 : Échec.** — [ ] **Step 3 : Implémenter.** — [ ] **Step 4 : Succès.**
- [ ] **Step 5 : Commit** — `git commit -m "Resolve player role from OIDC groups"`.

---

### Task 5 : Adaptateur OIDC

**Files:**

- Create: `server/src/auth/oidc.ts`, `server/test/oidc-fake.ts` (faux adaptateur partagé par les tests suivants)

**Interfaces:**

- Produces:
  ```ts
  export interface LoginStart {
    url: URL;
    state: string;
    nonce: string;
    codeVerifier: string;
  }
  export interface TokenSet {
    idToken: string;
    refreshToken?: string;
    claims: Record<string, unknown>;
    expiresAt?: number;
  }
  export interface OidcAdapter {
    startLogin(redirectUri: URL): Promise<LoginStart>;
    completeLogin(
      callbackUrl: URL,
      expected: { state: string; nonce: string; codeVerifier: string; redirectUri: URL },
    ): Promise<TokenSet>;
    refresh(refreshToken: string): Promise<TokenSet>;
    endSessionUrl(idTokenHint: string | undefined, postLogoutRedirect: URL): URL | null;
    revoke(refreshToken: string): Promise<void>;
  }
  export async function createOidcAdapter(
    cfg: AppConfig["oidc"],
    opts?: { allowInsecure?: boolean },
  ): Promise<OidcAdapter>;
  ```
  Implémentation avec `openid-client` : `discovery(new URL(cfg.issuer), cfg.clientId, cfg.clientSecret, ClientSecretPost(...))`, `allowInsecureRequests` si `opts.allowInsecure` (issuer en `http://`, dev uniquement), scopes `openid profile email offline_access <groupsClaim>` (le nom de la claim sert aussi de scope, `groups` par défaut), `buildAuthorizationUrl` avec `code_challenge` S256, `authorizationCodeGrant(config, callbackUrl, { pkceCodeVerifier, expectedState, expectedNonce })`, `refreshTokenGrant`, `buildEndSessionUrl` si l'issuer expose `end_session_endpoint`, `tokenRevocation` si `revocation_endpoint`.
- `server/test/oidc-fake.ts` : `createFakeOidc(accounts: Record<string, { claims: Record<string, unknown>; refreshFails?: boolean }>)` qui renvoie un `OidcAdapter` dont `startLogin` fixe `state`/`nonce`/`codeVerifier` connus et `completeLogin` lit `code=<accountId>` dans l'URL de callback et renvoie `claims` de ce compte, `idToken "fake-id-<accountId>"`, `refreshToken "fake-rt-<accountId>"` ; `refresh` renvoie les claims courantes du compte (modifiables par le test via l'objet `accounts`) ou lève si `refreshFails`.

- [ ] **Step 1 : Écrire `oidc-fake.ts`** et un test minimal `server/test/oidc-fake.test.ts` (completeLogin renvoie les claims du compte `admin`).
- [ ] **Step 2 : Implémenter `oidc.ts`** (pas de test unitaire réseau ; couvert par l'e2e de la Task 12). Vérifier `yarn typecheck`.
- [ ] **Step 3 : Commit** — `git commit -m "Add OIDC adapter and test double"`.

---

### Task 6 : Utilisateurs et sessions en base

**Files:**

- Create: `server/src/auth/users.ts`, `server/src/auth/sessions.ts`, `server/test/sessions.test.ts`

**Interfaces:**

- Produces:

  ```ts
  export interface UserRecord {
    id: string;
    issuer: string;
    subject: string;
    displayName: string | null;
    email: string | null;
    groups: string[];
  }
  export function upsertUser(
    db,
    input: {
      issuer: string;
      subject: string;
      displayName?: string;
      email?: string;
      groups: string[];
    },
    now: Date,
  ): UserRecord;
  export interface SessionRecord {
    id: string;
    userId: string;
    createdAt: Date;
    expiresAt: Date;
    groupsCheckedAt: Date;
    refreshToken: string | null;
    idToken: string | null;
  }
  export function createSession(
    db,
    key: Buffer,
    input: { userId: string; refreshToken?: string; idToken?: string; ttlMs: number },
    now: Date,
  ): SessionRecord; // retourne l'id en clair, stocke le hash
  export function findSession(db, key: Buffer, id: string, now: Date): SessionRecord | null; // null si inconnue ou expirée (et supprime si expirée)
  export function markGroupsChecked(
    db,
    id: string,
    tokens: { refreshToken?: string; idToken?: string },
    key: Buffer,
    now: Date,
  ): void;
  export function deleteSession(db, id: string): void;
  export function deleteUserSessions(db, userId: string): void;
  ```

  `id` d'utilisateur : `crypto.randomUUID()`. Dates ISO 8601.

- [ ] **Step 1 : Test** : `upsertUser` deux fois avec le même `(issuer, subject)` garde le même `id` et met à jour `groups` ; `createSession` puis `findSession` retourne l'enregistrement avec `refreshToken` déchiffré ; `findSession` avec un id inconnu → `null` ; session créée avec `ttlMs 1000` consultée à `now + 2000` → `null` et la ligne a disparu ; `deleteSession` puis `findSession` → `null` ; en base, `refresh_token_sealed` ne contient pas la valeur en clair.
- [ ] **Step 2 : Échec.** — [ ] **Step 3 : Implémenter.** — [ ] **Step 4 : Succès.**
- [ ] **Step 5 : Commit** — `git commit -m "Store users and sessions in SQLite"`.

---

### Task 7 : Application Hono, middleware de session et `GET /api/session`

**Files:**

- Create: `server/src/app.ts`, `server/src/auth/middleware.ts`, `server/src/http.ts` (helpers `jsonError(c, status, code, message)`, cookie `player_session` lecture/écriture avec les attributs de la section Global Constraints), `server/test/app-session.test.ts`, `server/test/helpers.ts` (`createTestApp(opts)` : base `:memory:` migrée, config de test, `createFakeOidc`, retourne `{ app, db, oidc, accounts, config, now: () => Date }` avec une horloge injectable)

**Interfaces:**

- Produces:

  ```ts
  export interface AppDeps { config: AppConfig; db: DatabaseSync; oidc: OidcAdapter; now?: () => Date; staticDir?: string; log?: (event: string, data?: Record<string, unknown>) => void }
  export function createApp(deps: AppDeps): Hono
  // Variables Hono posées par le middleware : c.get("session"): SessionRecord, c.get("user"): UserRecord, c.get("role"): Role
  export const requireSession: MiddlewareHandler  // 401 session_required ; 403 no_group
  export const requireAdmin: MiddlewareHandler    // 403 admin_required
  export const requireRequestedWith: MiddlewareHandler // 403 csrf sur POST/PATCH/PUT/DELETE sans X-Requested-With: player
  ```

  Politique du middleware : cookie absent ou session introuvable → `401`. Si `now - groupsCheckedAt >= groupsRecheckMs` : `oidc.refresh(refreshToken)` ; succès → `upsertUser` avec les nouvelles claims, `markGroupsChecked` ; échec → `deleteSession`, cookie effacé, `401 { code: "session_expired" }`. Rôle calculé par `resolveRole` sur `user.groups` ; `null` → `403 no_group` (session conservée pour permettre le logout).
  `GET /api/session` → `200 { user: { id, displayName }, role, expiresAt }`.
  En-têtes posés sur toutes les réponses : `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Cache-Control: no-store` sur `/api/*`.
  `GET /healthz` → `200 text/plain "ok\n"` sans session.

- [ ] **Step 1 : Test** `app-session.test.ts` : sans cookie → `401 session_required` ; avec une session `users` créée directement en base (helper `loginAs(accountId)` dans `helpers.ts` qui fait `upsertUser` + `createSession` et renvoie le cookie) → `200` avec `role "user"` ; compte `admin` → `role "admin"` ; compte sans groupe → `403 no_group` ; après 16 minutes d'horloge, `accounts.user.claims.groups = []` puis requête → `403 no_group` et `users.groups` mis à jour ; `accounts.user.refreshFails = true` + 16 minutes → `401 session_expired`, cookie `Max-Age=0`, session supprimée en base (Review Focus 2) ; `GET /healthz` → `200 "ok\n"` ; `POST /api/session` sans en-tête → `403 csrf` (route de test ou `405`, au choix du constructeur, mais le 403 CSRF doit précéder).
- [ ] **Step 2 : Échec.** — [ ] **Step 3 : Implémenter `http.ts`, `middleware.ts`, `app.ts`.** — [ ] **Step 4 : Succès.**
- [ ] **Step 5 : Commit** — `git commit -m "Add Hono app with session middleware and /api/session"`.

---

### Task 8 : Routes d'authentification

**Files:**

- Create: `server/src/routes/auth.ts`, `server/test/auth-routes.test.ts`
- Modify: `server/src/app.ts` (monter les routes)

**Interfaces:**

- `GET /api/auth/login` : `oidc.startLogin(`${appUrl}/api/auth/callback`)`, pose le cookie `player_oidc` = `seal(JSON { state, nonce, codeVerifier, createdAt })`, `HttpOnly`, `SameSite=Lax`, `Max-Age=600`, puis `302` vers `url`.
- `GET /api/auth/callback` : cookie absent/illisible/plus vieux que 10 min → `400 oidc_state` ; `completeLogin` lève (state/nonce/code invalides) → `400 oidc_state` ; sinon `resolveRole` (le résultat `null` n'empêche pas la session : l'écran de refus l'affichera), `upsertUser`, `createSession`, cookie `player_session`, suppression de `player_oidc`, `302 /`.
- `POST /api/auth/logout` (avec `requireRequestedWith`, sans exiger un rôle) : session présente → `oidc.revoke(refreshToken)` en meilleur effort, `deleteSession`, cookie effacé ; réponse `200 { redirect }` où `redirect` = `oidc.endSessionUrl(idToken, appUrl)` ou `"/api/auth/login"` ; sans session → `200 { redirect: "/api/auth/login" }`.

- [ ] **Step 1 : Test** : `GET /api/auth/login` → `302`, `Location` commence par l'URL du faux autorise, `Set-Cookie` contient `player_oidc` `HttpOnly` ; callback avec le cookie et `?code=admin&state=<state>` → `302 /`, `Set-Cookie player_session` avec `HttpOnly; SameSite=Lax; Path=/` (et `Secure` quand `APP_URL` est https — tester les deux configs), `player_oidc` effacé, un utilisateur et une session en base ; callback sans cookie → `400 oidc_state` et zéro session en base ; callback rejoué avec le même cookie après succès (le cookie a été effacé → absent) → `400` (Review Focus 3) ; `completeLogin` qui lève → `400 oidc_state` ; `POST /api/auth/logout` sans en-tête → `403 csrf` ; avec en-tête et session → `200`, `redirect` contient `end_session` du faux, session supprimée ; sans session → `200 { redirect: "/api/auth/login" }`.
- [ ] **Step 2 : Échec.** — [ ] **Step 3 : Implémenter.** — [ ] **Step 4 : Succès.**
- [ ] **Step 5 : Commit** — `git commit -m "Add OIDC login, callback and logout routes"`.

---

### Task 9 : Fichiers statiques, en-têtes et point d'entrée

**Files:**

- Create: `server/src/static.ts`, `server/src/main.ts`, `server/test/static.test.ts`
- Modify: `server/src/app.ts`

**Interfaces:**

- `mountStatic(app: Hono, dir: string)` : `serveStatic` de `@hono/node-server/serve-static` sur `dir` ; `/assets/*` avec `Cache-Control: public, max-age=31536000, immutable` ; tout autre chemin sans extension → `index.html` avec `Cache-Control: no-cache` ; fichiers commençant par `.` → `404` ; `/api/*` et `/healthz` ne passent jamais par le statique (montés avant).
- `main.ts` : `loadConfig(process.env)` (sortie `1` et message sur `ConfigError`), `openDatabase(join(dataDir, "player.sqlite"))`, `migrate`, `createOidcAdapter(config.oidc, { allowInsecure: config.nodeEnv !== "production" })`, `createApp({ …, staticDir: "dist" })`, `serve({ fetch: app.fetch, port })`, journal `listening` ; `SIGTERM` → fermeture du serveur et de la base.

- [ ] **Step 1 : Test** `static.test.ts` avec un dossier temporaire contenant `index.html`, `assets/app.js`, `.secret` : `GET /` → `200` HTML `no-cache` ; `GET /assets/app.js` → `200` avec `immutable` ; `GET /quelconque/route` → `index.html` ; `GET /.secret` → `404` ; `GET /api/session` → `401` JSON (pas `index.html`) (Review Focus 5) ; tous portent `X-Frame-Options: DENY`.
- [ ] **Step 2 : Échec.** — [ ] **Step 3 : Implémenter `static.ts`, `main.ts`.** — [ ] **Step 4 : Succès** et `yarn build:server` produit `dist/server/main.js`.
- [ ] **Step 5 : Commit** — `git commit -m "Serve the built frontend from the API server"`.

---

### Task 10 : Fournisseur OIDC factice et environnement de développement

**Files:**

- Create: `server/dev/mock-oidc.ts`, `.env.development`
- Modify: `vite.config.ts` (proxy `/api` → `http://localhost:8080`), `.gitignore` (déjà conforme : `.env.development` est ignoré par `.env.*` — le plan le **retire** de l'ignore en ajoutant `!.env.development` puisqu'il ne contient aucun secret), `package.json` (scripts de la Task 1 déjà en place)

**Interfaces:**

- `mock-oidc.ts` : `oidc-provider` sur `http://localhost:3002` (`MOCK_OIDC_PORT`), client `player-dev` / secret `player-dev-secret`, `redirect_uris` `http://localhost:8080/api/auth/callback` et `http://localhost:3000/api/auth/callback`, `post_logout_redirect_uris` idem sans le chemin, `grant_types` `authorization_code refresh_token`, `scopes` `openid profile email groups offline_access`, `claims: { groups: ["groups"], profile: ["name"], email: ["email"] }`, `features: { devInteractions: { enabled: true }, revocation: { enabled: true }, rpInitiatedLogout: { enabled: true } }`, `issueRefreshToken` toujours vrai, `findAccount` sur une `Map` de trois comptes : `admin@test` (`groups ["admin"]`, name « Admin Test »), `user@test` (`["users"]`), `nobody@test` (`[]`) ; mot de passe quelconque accepté par `devInteractions`. Route de contrôle hors provider : `POST /mock/accounts/:id` corps `{ groups?: string[]; disabled?: boolean }` ; un compte `disabled` fait échouer `findAccount` (donc le refresh). `GET /mock/accounts` liste l'état.
- `.env.development` : `NODE_ENV=development`, `APP_URL=http://localhost:3000`, `PORT=8080`, `DATA_DIR=./.data`, `OIDC_ISSUER=http://localhost:3002`, `OIDC_CLIENT_ID=player-dev`, `OIDC_CLIENT_SECRET=player-dev-secret`, `SESSION_SECRET=<64 hex fixes>`, `TRUST_PROXY=false`. `.data/` ajouté au `.gitignore`.
- Note : en dev, le navigateur parle à Vite (`:3000`) qui proxifie `/api` vers `:8080` ; `APP_URL` est donc `http://localhost:3000` et le callback revient par le proxy.

- [ ] **Step 1 : Implémenter `mock-oidc.ts`** et vérifier à la main : `yarn dev:oidc` puis `curl -s localhost:3002/.well-known/openid-configuration | grep -o '"end_session_endpoint":"[^"]*"'` renvoie une URL.
- [ ] **Step 2 : Vérifier le flux complet en dev** : `yarn dev`, ouvrir `http://localhost:3000/api/auth/login`, se connecter `user@test`, puis `curl` n'est pas possible (cookie) → vérifier dans le navigateur que `GET /api/session` renvoie `role "user"`. Documenter ces étapes dans `docs/architecture.md` (section « Développement »).
- [ ] **Step 3 : Commit** — `git commit -m "Add mock OIDC provider for development and tests"`.

---

### Task 11 : Porte d'entrée frontend, écran de refus, déconnexion

**Files:**

- Create: `lib/api.ts`, `lib/hooks/use-session.ts`, `components/auth-gate.tsx`, `components/access-denied.tsx`, `components/logout-link.tsx`, `tests/unit/api.test.ts`
- Modify: `src/app.tsx` (`<AuthGate>` autour de `<MusicPlayer />`), `components/player.tsx` (monter `<LogoutLink>` à côté de `NowPlaying`/`UpNext`, masqué quand le visualiseur est agrandi), `lib/player-runtime.ts` (option `onSessionLost`)

**Interfaces:**

- `lib/api.ts` :
  ```ts
  export class ApiError extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string,
    );
  }
  export async function api<T>(path: string, init?: RequestInit): Promise<T>; // ajoute X-Requested-With: player, credentials "same-origin", Accept JSON ; 401 → ApiError("session_required"|"session_expired") ; autres erreurs → ApiError(code du corps)
  export interface SessionInfo {
    user: { id: string; displayName: string | null };
    role: "admin" | "user";
    expiresAt: string;
  }
  export function fetchSession(): Promise<SessionInfo>; // GET /api/session
  export function logout(): Promise<{ redirect: string }>; // POST /api/auth/logout
  export function redirectToLogin(): void; // window.location.assign("/api/auth/login")
  ```
- `use-session.ts` : `useSession(): { status: "loading" } | { status: "ready"; session: SessionInfo } | { status: "denied"; reason: "no_group" } ` ; sur `401` appelle `redirectToLogin()` et reste en `loading`.
- `auth-gate.tsx` : `loading` → le même écran « Chargement du lecteur… » que `player.tsx` ; `denied` → `<AccessDenied />` ; `ready` → `children` avec `session` fournie par un contexte `SessionContext` (`useSessionInfo()`).
- `access-denied.tsx` : texte « Accès refusé », « Ton compte n'appartient à aucun groupe autorisé. », bouton « Se déconnecter » (style `buttonVariants({ variant: "ghost" })`) qui appelle `logout()` puis `window.location.assign(redirect)`. Même fond shader que le lecteur n'est pas requis : fond `body` suffit.
- `logout-link.tsx` : lien nu en bas à gauche, `fixed left-3 bottom-3 md:left-4 md:bottom-4`, même style que `up-next.tsx` (texte `text-sm text-purple-200/70`, icône 14 px « sortie »), `pointer-events-auto`, `aria-label "Se déconnecter"`. Affiché pour tous les rôles dans cet incrément (le panel admin, incrément 3, reprendra l'emplacement pour les admins).
- Perte de session en cours d'écoute : `api()` lève `ApiError` 401 → `player-runtime` option `onSessionLost` appelle `playback.stop()` puis `redirectToLogin()`. Dans cet incrément la seule requête périodique est `fetchSession` rejouée par `useSession` toutes les 5 minutes (`setInterval`), ce qui suffit à détecter l'expiration (Review Focus 2 côté client).

- [ ] **Step 1 : Test Bun** `tests/unit/api.test.ts` avec `globalThis.fetch` remplacé : `api()` envoie `X-Requested-With: player` et `credentials "same-origin"` ; réponse `401 { error: { code: "session_expired" } }` → rejette avec `ApiError.status 401`, `code "session_expired"` ; réponse `200` JSON → valeur.
- [ ] **Step 2 : Échec.** — [ ] **Step 3 : Implémenter `lib/api.ts`.** — [ ] **Step 4 : Succès.**
- [ ] **Step 5 : Implémenter le hook, la porte, l'écran de refus, le lien, et brancher `app.tsx` et `player.tsx`.** `yarn typecheck && yarn lint`.
- [ ] **Step 6 : Adapter `tests/e2e/player.spec.ts`** : le scénario « opens the built player » doit maintenant se connecter d'abord (voir Task 12 pour le helper) — à faire dans la Task 12 ; ici, marquer le test `test.skip` provisoirement n'est **pas** accepté : la Task 12 suit immédiatement.
- [ ] **Step 7 : Commit** — `git commit -m "Gate the player behind the server session"`.

---

### Task 12 : E2E Playwright avec le fournisseur factice

**Files:**

- Create: `tests/e2e/auth.helpers.ts`, `tests/e2e/auth.spec.ts`
- Modify: `playwright.config.ts`, `tests/e2e/player.spec.ts`

**Interfaces:**

- `playwright.config.ts` : `webServer` devient un tableau : (1) `node server/dev/mock-oidc.ts` sur `http://127.0.0.1:3002/.well-known/openid-configuration` ; (2) `yarn build && DATA_DIR=<tmp> NODE_ENV=test APP_URL=http://127.0.0.1:4173 OIDC_ISSUER=http://127.0.0.1:3002 OIDC_CLIENT_ID=player-dev OIDC_CLIENT_SECRET=player-dev-secret SESSION_SECRET=<hex> PORT=4173 yarn start` sur `http://127.0.0.1:4173/healthz`. `baseURL` inchangé. `PLAYER_TEST_URL` garde son rôle (serveurs externes) ; `redirect_uris` du mock incluent donc aussi `http://127.0.0.1:4173/api/auth/callback`.
- `auth.helpers.ts` : `loginAs(page, account: "admin@test" | "user@test" | "nobody@test")` : `page.goto("/")`, attendre l'URL du mock, remplir `input[name=login]` et `input[name=password]`, soumettre, accepter l'écran de consentement de `devInteractions` (`button[type=submit]` « Continue »), attendre le retour sur `baseURL`.

- [ ] **Step 1 : Écrire `auth.spec.ts`** : `user@test` → le lecteur s'affiche (`main` visible, premier titre du catalogue visible) et le lien « Se déconnecter » est visible en bas à gauche ; `admin@test` → `GET /api/session` via `page.request` renvoie `role "admin"` ; `nobody@test` → texte « Accès refusé » visible et `main` absent ; clic sur « Se déconnecter » → l'URL quitte l'origine de l'app vers le mock (`end_session`) puis revient, et `GET /api/session` renvoie `401` ; anonyme : `GET /api/session` → `401`, `GET /` → `200` HTML (l'app charge puis redirige : vérifier que la page atterrit sur le mock).
- [ ] **Step 2 : Adapter `player.spec.ts`** : préfixer le scénario du lecteur par `loginAs(page, "user@test")` ; le scénario Range reste anonyme (médias encore publics, voir Review Focus 5) avec un commentaire renvoyant à l'incrément 2.
- [ ] **Step 3 : `yarn test:e2e`** → 7 scénarios passent.
- [ ] **Step 4 : Commit** — `git commit -m "Add end-to-end authentication scenarios on the mock provider"`.

---

### Task 13 : Image Docker unique et Compose

**Files:**

- Modify: `Dockerfile`, `docker-compose.yml`, `docker-compose.local.yml`, `.dockerignore` (créer si absent : `node_modules`, `dist`, `.data`, `.env*`, `reports`, `test-results`, `playwright-report`), `docs/ci.md`, `README.md`
- Delete: `docker/default.conf`, dossier `docker/` si vide

**Interfaces:**

- `Dockerfile` : étape `build` (`node:24.6.0-alpine` au même digest qu'aujourd'hui) : `yarn install --frozen-lockfile`, `COPY . .`, `yarn build` ; étape `runtime` (même base) : `WORKDIR /app`, `COPY package.json yarn.lock`, `yarn install --frozen-lockfile --production`, `COPY --from=build /app/dist ./dist`, `COPY --from=build /app/server/src/migrations.ts` n'est pas nécessaire (compilé dans `dist/server`), `RUN mkdir -p /data && chown 101:101 /data`, `USER 101:101`, `ENV NODE_ENV=production PORT=8080 DATA_DIR=/data`, `EXPOSE 8080`, `HEALTHCHECK … wget -q -O /dev/null http://127.0.0.1:8080/healthz`, `CMD ["node", "--no-warnings=ExperimentalWarning", "dist/server/main.js"]`. Pas de `oidc-provider` ni `concurrently` dans l'image (devDependencies).
- `docker-compose.yml` : service `player` avec `env_file: .env`, `volumes: ["${PLAYER_DATA_PATH:-player-data}:/data"]`, `volumes: { player-data: {} }`, `read_only`, `tmpfs /tmp`, `cap_drop ALL`, `no-new-privileges` conservés. `docker-compose.local.yml` inchangé (port).
- `docs/ci.md` : section « Déploiement » réécrite (image unique, `.env` obligatoire, `PLAYER_DATA_PATH`, pré-requis Authentik du design §5.5, URL de redirection) ; `README.md` : section « Développement » (`yarn dev` lance Vite + API + OIDC factice, comptes de test) et « Docker ».

- [ ] **Step 1 : Écrire le Dockerfile et le compose.**
- [ ] **Step 2 : Vérifier localement** : `docker compose -f docker-compose.yml -f docker-compose.local.yml --env-file .env.example up -d --build --wait` échoue proprement sans `OIDC_ISSUER` (log `ConfigError`) ; avec un `.env` de test pointant vers `host.docker.internal:3002` et `yarn dev:oidc` lancé sur l'hôte : `curl -s -o /dev/null -w '%{http_code}' localhost:8080/healthz` → `200`, `curl -s localhost:8080/api/session` → `401` JSON, `curl -sI localhost:8080/assets/` → pas de listing, `docker compose exec player id` → `uid=101`, `docker compose exec player touch /app/x` → refusé. Puis `down --volumes`.
- [ ] **Step 3 : Commit** — `git commit -m "Ship a single Node image serving the app and the API"`.

---

### Task 14 : CI

**Files:**

- Modify: `.github/workflows/lint.yml` (typecheck couvre déjà `server/` via le script), `.github/workflows/test.yml` (ajouter `yarn test:server` ; l'étape Playwright n'a plus besoin de `dist` récupéré séparément si `webServer` construit, sinon garder l'artefact et retirer le `yarn build` du `webServer` via `PLAYER_SKIP_BUILD=1`), `.github/workflows/deploy.yml` (contrôles : `/healthz` 200, `/api/session` 401, `/` 200, uid 101, Range sur `/Drops.mp3` conservé jusqu'à l'incrément 2 ; fournir un `.env` de CI avec le mock OIDC lancé en service ou `OIDC_ISSUER` pointant vers un conteneur `mock-oidc` ajouté au job), `docs/ci.md`

- [ ] **Step 1 : Mettre à jour les workflows** ; `actionlint` et `shellcheck scripts/ci/*.sh` passent en local.
- [ ] **Step 2 : `yarn validate` et `yarn test:e2e` verts en local.** Le blocage de facturation GitHub Actions reste documenté ; la CI distante est non vérifiée tant qu'il n'est pas levé — l'écrire dans `docs/ci.md` sans statut artificiel.
- [ ] **Step 3 : Commit** — `git commit -m "Cover the server in CI and Docker checks"`.

---

## Auto-revue

- **Couverture du design (incrément 1)** : §5.1 conteneur unique → T9, T13 ; §5.3 `users`/`sessions` → T2, T6 ; §5.4 auth/session/healthz/CSRF/erreurs JSON → T7, T8 ; §5.5 flux, identité, rôle, cookie, réévaluation 15 min, invalidation stricte, déconnexion, pré-requis Authentik documentés → T4, T5, T7, T8, T13 ; §5.9 porte, refus, déconnexion bas-gauche → T11 ; §5.10 config → T1 ; §6 dev, mock, tests unitaires/API/e2e, CI → T10, T12, T14 ; §8 point 0 déjà fait (commit `d2e5c5e`). Hors incrément : catalogue serveur, médias privés, migration, panel admin.
- **Types** : `AppConfig`, `OidcAdapter`, `TokenSet`, `SessionRecord`, `UserRecord`, `Role`, `SessionInfo` nommés une fois et réutilisés. `createFakeOidc` en T5 est consommé par T7, T8 via `helpers.ts`.
- **Review Focus** : 1 → T4 ; 2 → T7 et T11 ; 3 → T8 ; 4 → T1 ; 5 → T9 et T12.
- **Proportion** : le plan fixe interfaces, valeurs et tests ; les corps restent au constructeur.
