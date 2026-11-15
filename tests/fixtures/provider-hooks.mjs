import { registerHooks } from 'node:module';
registerHooks({resolve(name, context, next) {
  if (name === 'ai' || name === '@vercel/blob') {
    return { url: new URL('./provider-mock.mjs', import.meta.url).href, shortCircuit: true };
  }
  return next(name, context);
}});
