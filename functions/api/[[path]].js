// functions/api/[[path]].js
import app from '../../src/index.js';

export const onRequest = (context) => {
  return app.fetch(context.request, context.env, context);
};
