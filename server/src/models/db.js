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
    // Chat tables first, then the CRM's. Set as the connection opens, so it is in place before the first query.
    options: '-c search_path=chat,public',
  });
  return pool;
}
