// Crea (si falta) y vacía la base `e4` que usan llm-api y llm-worker en Q7.
import pg from 'pg';
import { SCHEMA } from '../src/lib/db.ts';
const admin = new pg.Client({ connectionString: 'postgres://postgres:demo@127.0.0.1:18332/shop' });
await admin.connect();
const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = 'e4'");
if (!rowCount) await admin.query('CREATE DATABASE e4');
await admin.end();
const e4 = new pg.Client({ connectionString: 'postgres://postgres:demo@127.0.0.1:18332/e4' });
await e4.connect(); await e4.query(SCHEMA); await e4.end();
console.log('base e4 lista');
