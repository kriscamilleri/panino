 docker compose -f docker-compose.dev.yml up --build
WARN[0000] The "VITE_TURNSTILE_SITE_KEY" variable is not set. Defaulting to a blank string. 
[+] Building 20.0s (45/45) FINISHED                                                                                                                   
 => [panino-signup-service internal] load build definition from Dockerfile                                                                       0.0s
 => => transferring dockerfile: 32B                                                                                                              0.0s
 => [panino-frontend internal] load build definition from Dockerfile.dev                                                                         0.0s
 => => transferring dockerfile: 35B                                                                                                              0.0s
 => [panino-image-service internal] load build definition from Dockerfile                                                                        0.0s
 => => transferring dockerfile: 31B                                                                                                              0.0s
 => [panino-powersync-service internal] load build definition from Dockerfile                                                                    0.0s
 => => transferring dockerfile: 32B                                                                                                              0.0s
 => [panino-font-service internal] load build definition from Dockerfile                                                                         0.0s
 => => transferring dockerfile: 31B                                                                                                              0.0s
 => [panino-auth-service internal] load build definition from Dockerfile                                                                         0.0s
 => => transferring dockerfile: 32B                                                                                                              0.0s
 => [panino-signup-service internal] load .dockerignore                                                                                          0.0s
 => => transferring context: 2B                                                                                                                  0.0s
 => [panino-frontend internal] load .dockerignore                                                                                                0.0s
 => => transferring context: 2B                                                                                                                  0.0s
 => [panino-image-service internal] load .dockerignore                                                                                           0.0s
 => => transferring context: 2B                                                                                                                  0.0s
 => [panino-powersync-service internal] load .dockerignore                                                                                       0.0s
 => => transferring context: 2B                                                                                                                  0.0s
 => [panino-font-service internal] load .dockerignore                                                                                            0.0s
 => => transferring context: 2B                                                                                                                  0.0s
 => [panino-auth-service internal] load .dockerignore                                                                                            0.0s
 => => transferring context: 2B                                                                                                                  0.0s
 => [panino-signup-service internal] load metadata for docker.io/library/node:16-alpine                                                          1.7s
 => [panino-frontend internal] load metadata for docker.io/library/node:20-slim                                                                  1.8s
 => [panino-auth-service internal] load metadata for docker.io/library/node:24.4.0-alpine                                                        1.7s
 => [panino-signup-service 1/5] FROM docker.io/library/node:16-alpine@sha256:a1f9d027912b58a7c75be7716c97cfbc6d3099f3a97ed84aa490be9dee20e787    0.0s
 => [panino-signup-service internal] load build context                                                                                          0.0s
 => => transferring context: 100B                                                                                                                0.0s
 => CACHED [panino-signup-service 2/5] WORKDIR /usr/src/app                                                                                      0.0s
 => CACHED [panino-signup-service 3/5] COPY package.json package-lock.json ./                                                                    0.0s
 => CACHED [panino-signup-service 4/5] RUN npm install --production                                                                              0.0s
 => CACHED [panino-signup-service 5/5] COPY index.js ./                                                                                          0.0s
 => [panino-frontend] exporting to image                                                                                                         1.7s
 => => exporting layers                                                                                                                          1.7s
 => => writing image sha256:8e3cc89a951ae4f691f65b8215f76a031e2c01f91f86f961e67b5813f5ae3900                                                     0.0s
 => => naming to docker.io/library/panino-signup-service                                                                                         0.0s
 => => writing image sha256:65bfbf1cebd92be7dab68bcafdccee05dd299b56bd3b29c8ea23780bf94ea404                                                     0.0s
 => => naming to docker.io/library/panino-image-service                                                                                          0.0s
 => => writing image sha256:f84a311c56307f0968b5c1adb776b79babe3ed153752f0b4e9128a3df1cd0de9                                                     0.0s
 => => naming to docker.io/library/panino-powersync-service                                                                                      0.0s
 => => writing image sha256:0bafa31f5492c027e1570397e7ea0a936326f6f8196542cba87f6cdb4de78ab6                                                     0.0s
 => => naming to docker.io/library/panino-font-service                                                                                           0.0s
 => => writing image sha256:bd8895261cf097af7632714683dabe6d57bcf7dec6cf986062062c266e346089                                                     0.0s
 => => naming to docker.io/library/panino-auth-service                                                                                           0.0s
 => => writing image sha256:911e64443bf25e19013b679c1d94644f4bbb000506a92deee9859fa6c0e20e77                                                     0.0s
 => => naming to docker.io/library/panino-frontend                                                                                               0.0s
 => [panino-powersync-service 1/5] FROM docker.io/library/node:24.4.0-alpine@sha256:22b3c1a1171c798c0429f36272922dbb356bbab8a6d11b3b095a143d332  0.0s
 => [panino-font-service internal] load build context                                                                                            0.0s
 => => transferring context: 161B                                                                                                                0.0s
 => [panino-image-service internal] load build context                                                                                           0.0s
 => => transferring context: 123B                                                                                                                0.0s
 => [panino-auth-service internal] load build context                                                                                            0.0s
 => => transferring context: 124B                                                                                                                0.0s
 => [panino-powersync-service internal] load build context                                                                                       0.0s
 => => transferring context: 159B                                                                                                                0.0s
 => CACHED [panino-powersync-service 2/5] WORKDIR /app                                                                                           0.0s
 => CACHED [panino-image-service 3/5] COPY package*.json ./                                                                                      0.0s
 => CACHED [panino-image-service 4/5] RUN npm install                                                                                            0.0s
 => CACHED [panino-image-service 5/5] COPY . .                                                                                                   0.0s
 => CACHED [panino-auth-service 3/5] COPY package*.json ./                                                                                       0.0s
 => CACHED [panino-auth-service 4/5] RUN npm install                                                                                             0.0s
 => CACHED [panino-auth-service 5/5] COPY . .                                                                                                    0.0s
 => CACHED [panino-font-service 3/5] COPY package*.json ./                                                                                       0.0s
 => CACHED [panino-font-service 4/5] RUN npm install                                                                                             0.0s
 => CACHED [panino-font-service 5/5] COPY . .                                                                                                    0.0s
 => CACHED [panino-powersync-service 3/5] COPY package*.json ./                                                                                  0.0s
 => CACHED [panino-powersync-service 4/5] RUN npm install                                                                                        0.0s
 => CACHED [panino-powersync-service 5/5] COPY . .                                                                                               0.0s
 => [panino-frontend internal] load build context                                                                                                0.2s
 => => transferring context: 1.15kB                                                                                                              0.2s
 => [panino-frontend 1/4] FROM docker.io/library/node:20-slim@sha256:fa43945ad45c5f8c50dbea0633d888ddeb739f7d4e06c7696a9d68b54054238a            0.0s
 => CACHED [panino-frontend 2/4] WORKDIR /app                                                                                                    0.0s
 => [panino-frontend 3/4] COPY package*.json ./                                                                                                  0.0s
 => [panino-frontend 4/4] RUN npm install                                                                                                       15.6s
[+] Running 8/8
 ⠿ Network panino_default                Created                                                                                                 0.0s
 ⠿ Container panino-font-service-1       Created                                                                                                 0.2s
 ⠿ Container panino-postgres-1           Created                                                                                                 0.1s
 ⠿ Container panino-auth-service-1       Created                                                                                                 0.3s
 ⠿ Container panino-powersync-service-1  Created                                                                                                 1.7s
 ⠿ Container panino-image-service-1      Created                                                                                                 0.2s
 ⠿ Container panino-signup-service-1     Created                                                                                                 0.0s
 ⠿ Container panino-frontend-1           Created                                                                                                 2.1s
Attaching to panino-auth-service-1, panino-font-service-1, panino-frontend-1, panino-image-service-1, panino-postgres-1, panino-powersync-service-1, panino-signup-service-1
panino-postgres-1           | 
panino-postgres-1           | PostgreSQL Database directory appears to contain a database; Skipping initialization
panino-postgres-1           | 
panino-postgres-1           | 2025-07-13 17:51:09.481 UTC [1] LOG:  starting PostgreSQL 16.9 (Debian 16.9-1.pgdg120+1) on aarch64-unknown-linux-gnu, compiled by gcc (Debian 12.2.0-14) 12.2.0, 64-bit
panino-postgres-1           | 2025-07-13 17:51:09.481 UTC [1] LOG:  listening on IPv4 address "0.0.0.0", port 5432
panino-postgres-1           | 2025-07-13 17:51:09.481 UTC [1] LOG:  listening on IPv6 address "::", port 5432
panino-postgres-1           | 2025-07-13 17:51:09.483 UTC [1] LOG:  listening on Unix socket "/var/run/postgresql/.s.PGSQL.5432"
panino-postgres-1           | 2025-07-13 17:51:09.489 UTC [28] LOG:  database system was shut down at 2025-07-13 17:39:27 UTC
panino-postgres-1           | 2025-07-13 17:51:09.497 UTC [1] LOG:  database system is ready to accept connections
panino-font-service-1       | Font service listening on port 3002
panino-auth-service-1       | Auth service listening on port 8000
panino-image-service-1      | 
panino-image-service-1      | > image-service@1.0.0 start
panino-image-service-1      | > node index.js
panino-image-service-1      | 
panino-signup-service-1     | 
panino-signup-service-1     | > signup-service@1.0.0 start
panino-signup-service-1     | > node index.js
panino-signup-service-1     | 
panino-image-service-1      | Image service listening on port 3001
panino-frontend-1           | 
panino-frontend-1           | > pn-markdown-notes@0.1.0 dev
panino-frontend-1           | > vite --host
panino-frontend-1           | 
panino-signup-service-1     | Signup service listening on port 3000
panino-frontend-1           | 
panino-frontend-1           |   VITE v6.3.4  ready in 586 ms
panino-frontend-1           | 
panino-frontend-1           |   ➜  Local:   http://localhost:5173/
panino-frontend-1           |   ➜  Network: http://172.21.0.8:5173/
panino-powersync-service-1  | file:///app/index.js:2
panino-powersync-service-1  | import { PowerSyncPostgresConnector } from '@powersync/service-module-postgres';
panino-powersync-service-1  |          ^^^^^^^^^^^^^^^^^^^^^^^^^^
panino-powersync-service-1  | SyntaxError: The requested module '@powersync/service-module-postgres' does not provide an export named 'PowerSyncPostgresConnector'
panino-powersync-service-1  |     at #_instantiate (node:internal/modules/esm/module_job:254:21)
panino-powersync-service-1  |     at async ModuleJob.run (node:internal/modules/esm/module_job:362:5)
panino-powersync-service-1  |     at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:665:26)
panino-powersync-service-1  |     at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:99:5)
panino-powersync-service-1  | 
panino-powersync-service-1  | Node.js v24.4.0
panino-powersync-service-1 exited with code 1
