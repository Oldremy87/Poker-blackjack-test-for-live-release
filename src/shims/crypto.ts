// src/shims/crypto.ts
// @ts-ignore: crypto-browserify has no types; we wrap the pieces we need
const c = require('crypto-browserify');

export const createHash   = c.createHash as (alg: string) => any;
export const createHmac   = c.createHmac as (alg: string, key: any) => any;
export const randomBytes  = c.randomBytes as (n: number) => Uint8Array;
export const pbkdf2       = c.pbkdf2 as (...args: any[]) => void;
export const pbkdf2Sync   = c.pbkdf2Sync as (...args: any[]) => Uint8Array;

export default { createHash, createHmac, randomBytes, pbkdf2, pbkdf2Sync };