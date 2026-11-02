import { escapeHtml } from './email-verification.js';

const TEXT_MAX_LENGTH = 500;
const LABEL_MAX_COUNT = 12;
const ALERT_MAX_COUNT = 50;
/** Labels already shown elsewhere in the email. */
const SHOWN_LABELS = new Set(['alertname', 'severity']);

const isObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function text(value) {
  if (typeof value !== 'string') return '';
  return value.length > TEXT_MAX_LENGTH
    ? `${value.slice(0, TEXT_MAX_LENGTH - 1)}…`
    : value;
}

/** RFC 3339 from Alertmanager -> "2026-11-02 16:00:05 UTC"; its zero time means "not yet". */
export function formatTime(value) {
  const time = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(time) || new Date(time).getUTCFullYear() < 2000) {
    return null;
  }
  return `${new Date(time).toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}

/**
 * Reads an Alertmanager webhook body (version 4). Returns null when it is not
 * one, so the route answers 400 instead of sending an empty email.
 */
export function parseAlertPayload(body) {
  if (
    !isObject(body) ||
    !Array.isArray(body.alerts) ||
    body.alerts.length === 0 ||
    body.alerts.length > ALERT_MAX_COUNT
  ) {
    return null;
  }
  const alerts = [];
  for (const alert of body.alerts) {
    if (
      !isObject(alert) ||
      !['firing', 'resolved'].includes(alert.status) ||
      !isObject(alert.labels) ||
      typeof alert.labels.alertname !== 'string' ||
      !alert.labels.alertname
    ) {
      return null;
    }
    const annotations = isObject(alert.annotations) ? alert.annotations : {};
    alerts.push({
      status: alert.status,
      name: text(alert.labels.alertname),
      severity: text(alert.labels.severity) || 'unknown',
      summary: text(annotations.summary),
      description: text(annotations.description),
      startsAt: formatTime(alert.startsAt),
      endsAt: alert.status === 'resolved' ? formatTime(alert.endsAt) : null,
      labels: Object.entries(alert.labels)
        .filter(
          ([key, value]) => !SHOWN_LABELS.has(key) && typeof value === 'string',
        )
        .slice(0, LABEL_MAX_COUNT)
        .map(([key, value]) => [text(key), text(value)]),
    });
  }
  // Firing alerts first, the most severe first among them.
  const rank = (alert) =>
    (alert.status === 'firing' ? 0 : 2) + (alert.severity === 'critical' ? 0 : 1);
  alerts.sort((a, b) => rank(a) - rank(b));
  return { status: body.status === 'resolved' ? 'resolved' : 'firing', alerts };
}

function subjectOf({ status, alerts }) {
  const names = [...new Set(alerts.map((alert) => alert.name))];
  const shown = names.slice(0, 3).join(', ');
  const more = names.length > 3 ? ` and ${names.length - 3} more` : '';
  return `[42 Chess] ${status === 'firing' ? 'Alert' : 'Resolved'}: ${shown}${more}`;
}

function countLine(alerts) {
  const firing = alerts.filter((alert) => alert.status === 'firing').length;
  const resolved = alerts.length - firing;
  const parts = [];
  if (firing) parts.push(`${firing} firing`);
  if (resolved) parts.push(`${resolved} resolved`);
  return `Monitoring alerts on 42 Chess: ${parts.join(', ')}.`;
}

function alertLines(alert) {
  return [
    `${alert.status.toUpperCase()} · ${alert.severity} · ${alert.name}`,
    alert.summary,
    alert.description,
    alert.startsAt ? `Since: ${alert.startsAt}` : '',
    alert.endsAt ? `Resolved: ${alert.endsAt}` : '',
    alert.labels.length
      ? `Labels: ${alert.labels.map(([key, value]) => `${key}=${value}`).join(', ')}`
      : '',
  ].filter(Boolean);
}

/** Email for one Alertmanager notification (a group of alerts). */
export function alertEmail({ status, alerts, publicUrl }) {
  const dashboards = `${publicUrl}/grafana/`;
  const statusPage = `${publicUrl}/status`;
  return {
    subject: subjectOf({ status, alerts }),
    text: [
      countLine(alerts),
      '',
      ...alerts.flatMap((alert) => [...alertLines(alert), '']),
      `Dashboards and alert rules: ${dashboards}`,
      `Status page: ${statusPage}`,
    ].join('\n'),
    html: `
      <p>${escapeHtml(countLine(alerts))}</p>
      ${alerts
        .map((alert) => {
          const [title, ...rest] = alertLines(alert);
          return `<p><strong>${escapeHtml(title)}</strong><br>${rest
            .map(escapeHtml)
            .join('<br>')}</p>`;
        })
        .join('\n')}
      <p><a href="${escapeHtml(dashboards)}">Dashboards and alert rules</a> ·
         <a href="${escapeHtml(statusPage)}">Status page</a></p>
    `,
  };
}
