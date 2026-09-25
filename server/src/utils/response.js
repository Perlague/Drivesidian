'use strict';

const success = (res, data, status = 200) => {
  res.status(status).json({ success: true, data });
};

const error = (res, message, status = 400) => {
  res.status(status).json({ success: false, error: { message } });
};

// zodError: resultado de schema.safeParse(req.body).error — cada issue trae
// su propio mensaje (required_error / invalid_type_error / min / max / etc,
// definidos en el schema), así que cada campo puede fallar con un mensaje distinto.
const validationError = (res, zodError) => {
  const fields = {};
  for (const issue of zodError.issues) {
    const field = issue.path.join('.') || '(body)';
    fields[field] = issue.message;
  }
  const message = zodError.issues[0]?.message || 'Datos inválidos.';
  res.status(400).json({ success: false, error: { message, fields } });
};

// yours: lo que mandó el cliente. server: el estado actual en Postgres.
//
// `reason` distingue los dos 409 que puede recibir el agente, que necesitan
// reacciones distintas: ante `version_mismatch` congela esa nota y espera a que
// un humano resuelva desde el panel; ante `resync_required` tiene que
// reconciliar su estado local antes de volver a subir nada.
const conflict = (res, yours, server, reason = 'version_mismatch', message = null) => {
  res.status(409).json({
    success: false,
    error: {
      message: message || 'La nota fue modificada por otra fuente. Revisa ambas versiones.',
    },
    conflict: { reason, yours, server },
  });
};

module.exports = { success, error, validationError, conflict };
