'use strict';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('users', {
    id: { type: 'bigserial', primaryKey: true },
    email: { type: 'text', notNull: true, unique: true },
    password_hash: { type: 'text', notNull: true },
    totp_secret: { type: 'text' },
    role: { type: 'text', notNull: true, default: 'user' },
    failed_2fa_attempts: { type: 'integer', notNull: true, default: 0 },
    locked_until: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('users', 'users_role_check', "CHECK (role IN ('user', 'admin'))");

  pgm.createTable('notes', {
    id: { type: 'bigserial', primaryKey: true },
    user_id: {
      type: 'bigint',
      notNull: true,
      references: 'users',
    },
    vault_path: { type: 'text', notNull: true },
    content: { type: 'text', notNull: true },
    content_hash: { type: 'text', notNull: true },
    version: { type: 'integer', notNull: true, default: 1 },
    sync_status: { type: 'text', notNull: true, default: 'pending' },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('notes', 'notes_sync_status_check', "CHECK (sync_status IN ('pending', 'synced'))");
  pgm.addConstraint('notes', 'notes_user_id_vault_path_key', {
    unique: ['user_id', 'vault_path'],
  });
  // El worker de sincronización agrupa por usuario filtrando sync_status = 'pending'.
  pgm.createIndex('notes', ['user_id', 'sync_status']);

  pgm.createTable('agent_tokens', {
    id: { type: 'bigserial', primaryKey: true },
    user_id: {
      type: 'bigint',
      notNull: true,
      references: 'users',
    },
    token_hash: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    revoked_at: { type: 'timestamptz' },
  });
  pgm.createIndex('agent_tokens', 'user_id');
};

exports.down = (pgm) => {
  pgm.dropTable('agent_tokens');
  pgm.dropTable('notes');
  pgm.dropTable('users');
};
