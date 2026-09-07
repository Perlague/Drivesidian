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

module.exports = { success, error, validationError };
