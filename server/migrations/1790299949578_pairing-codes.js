'use strict';

exports.shorthands = undefined;

exports.up = (pgm) => {
  // Vinculación del agente por código (patrón device-code, tipo `gh auth login`).
  // El usuario final no copia ningún token a mano: el agente pide un código,
  // abre el navegador, y recoge su token cuando el humano aprueba.
  pgm.createTable('pairing_codes', {
    id: { type: 'bigserial', primaryKey: true },
    code: { type: 'text', notNull: true, unique: true },
    // SHA-256 de un secreto que solo conoce el agente que pidió el código.
    // Quien vea el código en pantalla no puede canjear el token sin él —
    // mismo principio que PKCE.
    verifier_hash: { type: 'text', notNull: true },
    // Nulos hasta que un humano aprueba desde el navegador.
    user_id: { type: 'bigint', references: 'users' },
    agent_token_id: { type: 'bigint', references: 'agent_tokens' },
    // Vaults que el agente detectó en la máquina, para que el usuario elija
    // si hay más de uno.
    vaults: { type: 'jsonb', notNull: true, default: '[]' },
    selected_vault: { type: 'text' },
    device_name: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    expires_at: { type: 'timestamptz', notNull: true },
    approved_at: { type: 'timestamptz' },
    consumed_at: { type: 'timestamptz' },
  });

  // La poda por expiración barre por fecha.
  pgm.createIndex('pairing_codes', 'expires_at');
};

exports.down = (pgm) => {
  pgm.dropTable('pairing_codes');
};
