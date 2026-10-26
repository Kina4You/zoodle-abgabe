/**
 * Einstellungen für ESLint ("npm run lint").
 *
 * ESLint liest den Code, ohne ihn auszuführen, und meldet typische Fehler:
 * ungenutzte Variablen, Namen, die es nicht gibt, Code, der nie erreicht
 * wird. Bewusst nur die empfohlenen Regeln - keine Stilvorgaben.
 *
 * Nicht Teil von "npm run build": Der Build soll beim Auschecken nie an
 * einer Stilfrage scheitern, nur an echten Fehlern (Syntax, Tierdaten,
 * "!important").
 */

import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: ['node_modules/', 'Claude outputs/'],
  },

  js.configs.recommended,

  // Parameter mit "_" am Anfang sind bewusst ungenutzt. Der Fall im Projekt:
  // die Fehlerbehandlung in server.js. Express erkennt sie nur daran, dass
  // sie VIER Parameter hat - "_weiter" muss also dastehen, auch wenn sie ihn
  // nie aufruft. Mit drei Parametern wäre sie eine normale Middleware.
  {
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },

  // Der Browser-Code kennt window, document & Co. - und "io": Das legt
  // /socket.io/socket.io.js an, das index.html vor client.js lädt.
  {
    files: ['public/js/**/*.js'],
    languageOptions: {
      globals: { ...globals.browser, io: 'readonly' },
    },
  },

  // Server, Skripte, Tests und diese Datei laufen in Node.
  {
    files: ['server/**/*.js', 'scripts/**/*.js', 'tests/**/*.js', '*.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
];
