'use strict';

const { z } = require('zod');

// Usado por el panel web en PATCH /api/users/me/notifications.
const notificationsSchema = z.object({
  notify_enabled: z.boolean({
    error: (issue) =>
      issue.input === undefined
        ? 'notify_enabled es requerido.'
        : 'notify_enabled debe ser true o false.',
  }),
});

module.exports = { notificationsSchema };
