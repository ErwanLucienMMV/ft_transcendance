import type { Translation } from '../../core/i18n/i18n';

export const legal: Translation['legal'] = {
  updated: 'Última actualización:',
};

export const design: Translation['design'] = {
  title: 'Así se ve 42 Chess',
  intro:
    'Cada color, estilo de texto y componente reutilizable del sitio, dibujado por el código real. Cambia el tema para comprobar los dos.',
  onThisPage: 'En esta página',
  sections: {
    colours: 'Colores',
    type: 'Tipografía',
    icons: 'Iconos',
    actions: 'Botones y campos',
    feedback: 'Mensajes',
    navigation: 'Opciones y páginas',
    chess: 'Ajedrez',
    players: 'Jugadores',
  },
  coloursNote:
    "Tokens en <code>:root</code> dentro de <code>styles.css</code>; el tema claro los redefine en <code>[data-theme='light']</code>. Los componentes solo usan tokens.",
  groups: {
    Surfaces: 'Superficies',
    Text: 'Texto',
    Accent: 'Acento',
    Feedback: 'Mensajes',
  },
  typeSamples: {
    eyebrow: 'Antetítulo · nombre de sección',
    h1: 'Título de página (h1), 28 px display',
    h2: 'Título de sección (h2), 17 px display',
    h3: 'Título de subsección (h3)',
    body: 'Texto normal, 15 px. Una partida termina por mate, abandono, tiempo o acuerdo.',
    muted: 'El texto atenuado explica o añade detalles.',
    small: 'Texto pequeño para fechas y recuentos.',
    mono: 'monoespaciado para jugadas, códigos y tokens.',
  },
  iconsNote:
    '<code>&lt;app-icon name="…" /&gt;</code>: trazos de 24 px del color del texto, ocultos a los lectores de pantalla, así que un botón conserva sus palabras o un <code>aria-label</code>.',
  buttons: {
    primary: 'Principal',
    secondary: 'Secundario',
    ghost: 'Discreto',
    danger: 'Peligro',
    small: 'Pequeño',
    disabled: 'Desactivado',
    link: 'Un enlace como botón',
  },
  switch: 'Un interruptor: un ajuste que se activa o no',
  checkbox: 'Una casilla: una aceptación en un formulario',
  alerts: 'Avisos',
  tones: {
    error: {
      heading: 'Error',
      text: 'Un mensaje de error sobre esta página.',
      name: 'error',
      toast: 'Tu jugada no se ha enviado. Inténtalo de nuevo.',
    },
    warning: {
      heading: 'Advertencia',
      text: 'Un mensaje de advertencia sobre esta página.',
      name: 'advertencia',
      toast: 'Tu conexión es inestable.',
    },
    success: {
      heading: 'Éxito',
      text: 'Un mensaje de éxito sobre esta página.',
      name: 'éxito',
      toast: 'Ajustes guardados.',
    },
    info: {
      heading: 'Información',
      text: 'Un mensaje informativo sobre esta página.',
      name: 'información',
      toast: '{{name}} ya está en línea.',
    },
  },
  toasts: 'Notificaciones',
  toastsNote:
    'Novedades de otras partes, arriba a la derecha. Los errores desaparecen cuando el jugador cambia de página.',
  show: 'Mostrar {{tone}}',
  empty: 'Vacío y carga',
  badges: 'Etiquetas',
  badgeTones: {
    neutral: 'neutro',
    accent: 'acento',
    success: 'éxito',
    warning: 'advertencia',
    danger: 'peligro',
  },
  dialog: 'Diálogo',
  removeFriend: 'Eliminar a un amigo…',
  answer: 'Respuesta: {{text}}',
  answers: {
    removed: 'eliminado',
    kept: 'conservado',
  },
  shortRemoveText: 'Cualquiera de los dos podrá enviar una nueva solicitud más adelante.',
  speed: 'Velocidad',
  examplePages: 'Páginas de ejemplo',
  boardHelp:
    'Arrastra o haz clic para mover, usa las flechas del teclado para recorrer las casillas y el clic derecho para dibujar flechas.',
};
