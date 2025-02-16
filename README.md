# Pretty Neat Notes
A simple self-hostable markdown editor, heavily inspired by StackEdit. 

## Features
- Simple markdown editor and renderer
- Shortcuts for text formatting, table insertion, and list creation 
- Workspace synchronization using CouchDB and PouchDB
- Stackedit compatible import and export
- Multi-level folder support
- Workspace and local document search
- Print to PDF 
- Self-hostable with minimal configuration
- Supports multiple user accounts
- Embedded image upload support

## Tech Stack
### Frontend 
- Vue 3 
- Markdown-it
- PouchDB 

### Backend
- CouchDB 
- NodeJS service containers
- CouchDB initial configuration container

## Getting Started
### Prerequisites
1. Docker & Docker Compose

### Environment Variables
Create a .env file in the root directory of the project with the below properties. Don't forget to change the admin username and password.
```
COUCHDB_USER=admin
COUCHDB_PASSWORD=password
COUCHDB_URL=http://couchdb:5984
COUCHDB_HOST=couchdb
```

### Production
1. Create .env file in the root folder of the project with the above variables.
2. Spin up the database and service containers with the below command.
```
docker compose up -d

```
3. Deploy reverse proxy for each container and to serve the frontend. The setup-nginx.cjs script is an opinionated means of automating this process. See Automated Setup NGINX for more information. 
```
node setup-nginx.cjs
```

#### Automated Setup NGINX 
> Requires node 18+, NGINX and certbot to be installed on the host machine.
1. Parses command-line options (domain, email, and an SSL skip flag).
2. Builds the frontend in production mode and copies the build (the dist folder) to the server directory (e.g., /var/www/<domain>).
3. Generates a production environment file.
4. Processes an nginx configuration template by replacing placeholders with the actual domain.
5. Installs the nginx configuration (if run as root) and reloads nginx.
6. Optionally sets up an SSL certificate using certbot if SSL isn’t skipped.


### Development
1. Create .env file in the root folder of the project with the above variables.
2. Spin up the containers with the below command.
```
docker compose -f docker-compose.dev.yml up --build
```

#### Frontend Development
**OPTIONAL:** For a faster frontend development experience, comment out the frontend section of the compose and run the below commands within the /frontend folder.
> ```
> npm i
> npm run dev
> ```