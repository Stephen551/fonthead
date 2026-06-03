-- Better Auth core tables (email/password). SQLite/D1: dates are ISO-8601
-- text, booleans are integer 0/1. `user` is quoted (reserved word).
-- `handle` is a fonthead addition (the maker handle) used from M3 onward;
-- nullable here so the auth spike can create users without one.

CREATE TABLE "user" (
  "id"            text PRIMARY KEY NOT NULL,
  "name"          text NOT NULL,
  "email"         text NOT NULL UNIQUE,
  "emailVerified" integer NOT NULL DEFAULT 0,
  "image"         text,
  "handle"        text UNIQUE,
  "createdAt"     date NOT NULL,
  "updatedAt"     date NOT NULL
);

CREATE TABLE "session" (
  "id"        text PRIMARY KEY NOT NULL,
  "expiresAt" date NOT NULL,
  "token"     text NOT NULL UNIQUE,
  "createdAt" date NOT NULL,
  "updatedAt" date NOT NULL,
  "ipAddress" text,
  "userAgent" text,
  "userId"    text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE
);
CREATE INDEX "session_userId_idx" ON "session" ("userId");

CREATE TABLE "account" (
  "id"                    text PRIMARY KEY NOT NULL,
  "accountId"             text NOT NULL,
  "providerId"            text NOT NULL,
  "userId"                text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "accessToken"           text,
  "refreshToken"          text,
  "idToken"               text,
  "accessTokenExpiresAt"  date,
  "refreshTokenExpiresAt" date,
  "scope"                 text,
  "password"              text,
  "createdAt"             date NOT NULL,
  "updatedAt"             date NOT NULL
);
CREATE INDEX "account_userId_idx" ON "account" ("userId");

CREATE TABLE "verification" (
  "id"         text PRIMARY KEY NOT NULL,
  "identifier" text NOT NULL,
  "value"      text NOT NULL,
  "expiresAt"  date NOT NULL,
  "createdAt"  date NOT NULL,
  "updatedAt"  date NOT NULL
);
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");
