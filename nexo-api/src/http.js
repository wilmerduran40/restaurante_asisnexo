'use strict';

// Envuelve handlers async para que Express capture los errores y los devuelva
// como 500 en vez de dejar caer el proceso con una promesa sin manejar.
function wrap(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { wrap };