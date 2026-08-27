import assert from "node:assert/strict";
import test from "node:test";

import {
  TerminalInputBuffer,
  terminalInputRequiresBuffer,
  terminalSessionIsMissingError,
  terminalTransportErrorMessage,
} from "../src/terminal-transport.ts";

test("la saisie recue pendant la connexion est restituee dans l'ordre", () => {
  const buffer = new TerminalInputBuffer();
  buffer.append(12, "bonjour");
  buffer.append(12, " le terminal");

  assert.equal(buffer.take(12), "bonjour le terminal");
  assert.equal(buffer.take(12), "");
});

test("la saisie suit l'identifiant definitif attribue par le serveur", () => {
  const buffer = new TerminalInputBuffer();
  buffer.append(12, "avant");
  buffer.append(34, "apres");

  buffer.move(12, 34);

  assert.equal(buffer.take(12), "");
  assert.equal(buffer.take(34), "avantapres");
});

test("fermer un terminal supprime sa saisie en attente", () => {
  const buffer = new TerminalInputBuffer();
  buffer.append(12, "a ne pas envoyer");

  buffer.clear(12);

  assert.equal(buffer.take(12), "");
});

test("une frappe reste bufferisee pendant toute reconnexion d'un PTY connu", () => {
  assert.equal(terminalInputRequiresBuffer({
    socketOpen: false,
    socketConnecting: false,
    terminalStarting: false,
    routeKnown: true,
  }), true);
  assert.equal(terminalInputRequiresBuffer({
    socketOpen: false,
    socketConnecting: true,
    terminalStarting: false,
    routeKnown: false,
  }), true);
  assert.equal(terminalInputRequiresBuffer({
    socketOpen: true,
    socketConnecting: false,
    terminalStarting: false,
    routeKnown: true,
  }), false);
});

test("seule une disparition confirmee du PTY autorise l'abandon du buffer", () => {
  assert.equal(terminalSessionIsMissingError(new Error("Session terminal introuvable")), true);
  assert.equal(terminalSessionIsMissingError(new Error("404 terminal not found")), true);
  assert.equal(terminalSessionIsMissingError(new TypeError("Failed to fetch")), false);
  assert.equal(terminalSessionIsMissingError(new Error("WebSocket closed")), false);
});

test("une panne fetch devient un message terminal utile", () => {
  const message = terminalTransportErrorMessage(
    "http://127.0.0.1:8080",
    new TypeError("Failed to fetch"),
  );

  assert.match(message, /Serveur terminal inaccessible/);
  assert.match(message, /127\.0\.0\.1:8080/);
  assert.doesNotMatch(message, /TypeError|Failed to fetch/);
});

test("une erreur applicative du serveur reste precise", () => {
  assert.equal(
    terminalTransportErrorMessage("http://127.0.0.1:8080", new Error("Session terminal introuvable")),
    "Error: Session terminal introuvable",
  );
});
