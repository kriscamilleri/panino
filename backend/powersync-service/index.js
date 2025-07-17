// /backend/powersync-service/index.js
import { PowerSyncPostgresConnector } from '@powersync/service-module-postgres';
import fs from 'fs';
import 'dotenv/config';

const port = Number(process.env.PORT) || 7000;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is not set.');
}

// Read the sync rules from the YAML file
const syncRules = fs.readFileSync('./sync.rules.yaml', 'utf8');

const connector = new PowerSyncPostgresConnector({
    database: {
        connectionString: databaseUrl,
    },
    syncRules: syncRules,
    port: port
});

// Start the PowerSync connector
connector.start();

console.log(`PowerSync service running on port ${port}`);