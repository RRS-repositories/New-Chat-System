import pg from 'pg';

export function createPool(config) {
  const pool = new pg.Pool({
    host: config.dbHost,
    port: config.dbPort,
    database: config.dbName,
    user: config.dbUser,
    password: config.dbPassword,
    ssl: config.dbSsl,
    max: 10,
    idleTimeoutMillis: 30000,
  });
  pool.on('connect', (client) => client.query('SET search_path TO chat, public'));
  return pool;
}
